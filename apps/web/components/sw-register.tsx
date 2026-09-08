"use client";

import { useEffect } from "react";

/** 仅在生产环境注册 Service Worker（开发时使用 dev server 自身资源） */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (
      process.env.NODE_ENV === "production" &&
      typeof window !== "undefined" &&
      "serviceWorker" in navigator
    ) {
      navigator.serviceWorker
        .register("/sw.js")
        .catch((err) => console.error("SW registration failed:", err));
    }
  }, []);

  return null;
}
