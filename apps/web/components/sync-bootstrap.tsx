"use client";

import { useEffect } from "react";
import { initSync } from "@/lib/sync/sync-engine";

/** 应用启动时初始化同步引擎（幂等） */
export function SyncBootstrap() {
  useEffect(() => {
    // 本地优先应用申请持久存储：非持久的 IndexedDB 在磁盘压力下可能被
    // 浏览器整库清除（数据级风险）。被拒绝也不影响功能，只是优先级回退。
    try {
      void navigator.storage?.persist?.();
    } catch {
      // 不支持/隐私模式：忽略
    }
    void initSync();
  }, []);
  return null;
}
