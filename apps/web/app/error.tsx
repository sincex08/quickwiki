"use client";

import { useEffect } from "react";
import { RotateCcw, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * 路由段错误边界：渲染期异常不再白屏，给出错误摘要与恢复入口。
 * 静态导出下为纯客户端组件。
 */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("render error:", error);
  }, [error]);

  return (
    <main className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <h2 className="text-lg font-semibold">页面出错了</h2>
      <p className="max-w-md break-all text-sm leading-relaxed text-muted-foreground">
        {error.message || "发生未知错误"}
        {error.digest ? `（${error.digest}）` : ""}
      </p>
      <p className="max-w-md text-xs text-muted-foreground/80">
        本地数据不受影响；刷新通常可以恢复，持续出现时请检查网络或清除缓存。
      </p>
      <div className="mt-2 flex gap-2">
        <Button variant="outline" onClick={() => window.location.reload()}>
          <RefreshCw className="mr-1.5 h-4 w-4" />
          刷新页面
        </Button>
        <Button onClick={reset}>
          <RotateCcw className="mr-1.5 h-4 w-4" />
          重试
        </Button>
      </div>
    </main>
  );
}
