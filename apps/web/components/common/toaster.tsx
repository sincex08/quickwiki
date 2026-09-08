"use client";

import { X } from "lucide-react";
import { useToastStore } from "@/stores/use-toast-store";
import { cn } from "@/lib/utils";

/** 全局 toast 容器：底部居中堆叠，3s 自动消失（store 内计时） */
export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-20 left-1/2 z-[100] flex w-full max-w-sm -translate-x-1/2 flex-col items-center gap-2 px-4 md:bottom-8">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className={cn(
            "pointer-events-auto flex w-full items-start gap-2 rounded-lg border px-3 py-2 text-sm shadow-lg",
            t.variant === "error"
              ? "border-destructive/40 bg-destructive text-destructive-foreground"
              : "border-border bg-background text-foreground"
          )}
        >
          <span className="flex-1 break-all">{t.message}</span>
          <button
            type="button"
            aria-label="关闭提示"
            title="关闭提示"
            className="shrink-0 opacity-70 hover:opacity-100"
            onClick={() => dismiss(t.id)}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
