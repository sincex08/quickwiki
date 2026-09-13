/**
 * QuickWiki Service Worker
 * 静态导出模式下手动管理缓存（next-pwa 在 output:'export' 下不可靠）。
 *
 * 策略：
 * - 应用外壳（页面导航）：网络优先，失败时回退缓存，保证离线可用；
 * - 静态资源（_next/、图片、字体）：缓存优先 + 后台更新，加快二次加载。
 */

const VERSION = "v2";
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
    // 或让 Magic Link / OAuth 的 code 参数被缓存页面吞掉，导致会话无法建立。
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
