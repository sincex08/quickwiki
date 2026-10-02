/**
 * QuickWiki Service Worker
 * 静态导出模式下手动管理缓存（next-pwa 在 output:'export' 下不可靠）。
 *
 * 策略：
 * - 应用外壳（页面导航）：网络优先，失败时回退缓存，保证离线可用；
 * - 静态资源（_next/、图片、字体）：缓存优先 + 后台更新，加快二次加载。
 *
 * 版本号由构建时生成的 /sw-version.js 注入（prebuild 脚本写入构建时间戳）：
 * 每次部署 sw-version.js 字节变化 → 浏览器据 imported script 的差异判定
 * SW 有更新 → 装新 worker、activate 清旧缓存。此前 VERSION 硬编码不随构建
 * 变化，SW 永不更新、旧 hash chunk 在 runtime 缓存里持续泄漏膨胀。
 */

let VERSION = "dev";
try {
  // 定义 self.__BUILD_ID__；dev 直跑（public 下无该文件）时 404 走 catch
  importScripts("/sw-version.js");
  if (self.__BUILD_ID__) VERSION = self.__BUILD_ID__;
} catch {
  // 保持默认版本名：缓存仍按名字隔离，只是不做跨构建清理
}
const STATIC_CACHE = `quickwiki-static-${VERSION}`;
const RUNTIME_CACHE = `quickwiki-runtime-${VERSION}`;
/** 运行时缓存条目上限：_next chunk 随构建换名会持续累积，FIFO 淘汰最旧 */
const MAX_RUNTIME_ENTRIES = 300;

const PRECACHE_URLS = ["/", "/manifest.json", "/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("quickwiki-") && !key.includes(VERSION))
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

/** 写入运行时缓存并按 FIFO 裁剪到上限（trim 在后台执行，不阻塞响应） */
function cacheAndTrim(request, response, event) {
  const copy = response.clone();
  event.waitUntil(
    caches.open(RUNTIME_CACHE).then(async (cache) => {
      await cache.put(request, copy);
      const keys = await cache.keys();
      if (keys.length <= MAX_RUNTIME_ENTRIES) return;
      await Promise.all(
        keys.slice(0, keys.length - MAX_RUNTIME_ENTRIES).map((key) =>
          cache.delete(key)
        )
      );
    })
  );
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // 页面导航：网络优先 + 缓存兜底（离线访问已访问过的页面）
  if (request.mode === "navigate") {
    // 登录页与带 auth 回调参数的导航永不缓存：否则会返回旧的登录页外壳，
    // 或让邮箱登录链接的 code 参数被缓存页面吞掉，导致会话无法建立。
    const isAuthFlow =
      url.pathname.startsWith("/login") ||
      url.pathname.startsWith("/account") ||
      url.searchParams.has("code") ||
      url.searchParams.has("error");
    if (isAuthFlow) return; // 交给浏览器直连网络

    event.respondWith(
      fetch(request)
        .then((response) => {
          cacheAndTrim(request, response, event);
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (cached) return cached;
          // 未缓存的路径回退到应用外壳
          const shell = await caches.match("/");
          if (shell) return shell;
          return Response.error();
        })
    );
    return;
  }

  // 静态资源：缓存优先，后台刷新
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response && response.ok) {
            cacheAndTrim(request, response, event);
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
