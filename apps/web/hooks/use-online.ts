"use client";

import { useEffect, useState } from "react";

/**
 * 网络在线状态：online/offline 事件驱动。
 * 「本地优先」应用断网后仍可正常读写，但用户需要一个可见的区分
 * （离线写入本地 / 服务器故障 / 登录过期），否则同步失败只有红色角标。
 */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine
  );

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  return online;
}
