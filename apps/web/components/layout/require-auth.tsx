"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { getSyncState, subscribeSync, type SyncState } from "@/lib/sync/sync-engine";

/**
 * 登录门禁：未登录统一跳转 /login，主应用不可见。
 * status === "disabled" 且已配置时为初始化中（等待会话恢复）。
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [sync, setSync] = useState<SyncState>(() => getSyncState());

  useEffect(() => subscribeSync(setSync), []);

  const initializing =
    isSupabaseConfigured &&
    sync.status === "disabled" &&
    sync.userId === null;

  useEffect(() => {
    if (!isSupabaseConfigured || (!initializing && !sync.userId)) {
      router.replace("/login");
    }
  }, [initializing, sync.userId, router]);

  if (!isSupabaseConfigured || !sync.userId) {
    return (
      <div className="flex h-full items-center justify-center">
        {initializing ? (
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        ) : null}
      </div>
    );
  }

  return <>{children}</>;
}
