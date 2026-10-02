"use client";

import { useEffect } from "react";
import { useToastStore } from "@/stores/use-toast-store";

/** 检查 SW 更新的最小间隔：恢复可见时也节流，避免频繁 update() 请求 */
const UPDATE_CHECK_MIN_INTERVAL_MS = 60_000;

/**
 * 仅在生产环境注册 Service Worker（开发时使用 dev server 自身资源）。
 *
 * 同时负责「新版本可用」提示：长驻会话（已安装 PWA / 一直开着的标签页）
 * 没有导航发生，浏览器不会主动检查 sw.js；这里监听 updatefound，并在页面
 * 恢复可见时主动 reg.update()（节流）。新 worker 装好后 toast 引导刷新——
 * skipWaiting + clients.claim 已让新 SW 立即接管，reload 后即用新资源。
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (
      process.env.NODE_ENV !== "production" ||
      typeof window === "undefined" ||
      !("serviceWorker" in navigator)
    ) {
      return;
    }

    const notifyUpdate = () => {
      useToastStore.getState().show("新版本可用", "success", {
        action: { label: "刷新", onClick: () => window.location.reload() },
      });
    };

    let registration: ServiceWorkerRegistration | null = null;
    let lastCheckAt = 0;

    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => {
        registration = reg;
        // 上次会话已装好但页面还没刷新的 waiting worker（本会话开场即提示）
        if (reg.waiting && navigator.serviceWorker.controller) {
          notifyUpdate();
        }
        reg.addEventListener("updatefound", () => {
          const installing = reg.installing;
          installing?.addEventListener("statechange", () => {
            if (
              installing.state === "installed" &&
              navigator.serviceWorker.controller
            ) {
              notifyUpdate();
            }
          });
        });
      })
      .catch((err) => console.error("SW registration failed:", err));

    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastCheckAt < UPDATE_CHECK_MIN_INTERVAL_MS) return;
      lastCheckAt = now;
      void registration?.update().catch(() => {
        // 检查失败（离线等）静默：下次恢复可见再试
      });
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  return null;
}
