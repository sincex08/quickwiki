/**
 * QuickWiki Service Worker
 * 静态导出模式下手动管理缓存（next-pwa 在 output:'export' 下不可靠）。
 *
 * 策略：
 * - 应用外壳（页面导航）：网络优先，失败时回退缓存，保证离线可用；
 * - 静态资源（_next/、图片、字体）：缓存优先 + 后台更新，加快二次加载。
 */

const VERSION = "v1";
const STATIC_CACHE = `quickwiki-static-${VERSION}`;
const RUNTIME_CACHE = `quickwiki-runtime-${VERSION}`;

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

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // 页面导航：网络优先 + 缓存兜底（离线访问已访问过的页面）
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, copy));
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
            const copy = response.clone();
            caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
