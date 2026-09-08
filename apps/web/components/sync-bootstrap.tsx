"use client";

import { useEffect } from "react";
import { initSync } from "@/lib/sync/sync-engine";

/** 应用启动时初始化同步引擎（幂等） */
export function SyncBootstrap() {
  useEffect(() => {
    void initSync();
  }, []);
  return null;
}
