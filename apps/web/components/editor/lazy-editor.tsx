"use client";

import { lazy, Suspense, useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import type { TipTapEditorProps } from "./tiptap-editor";

// 代码分割：Tiptap 体积较大，单独 chunk 按需加载，减小首屏负担
const loadEditor = () => import("./tiptap-editor");
const TipTapEditor = lazy(loadEditor);

/**
 * 空闲时预热编辑器 chunk（幂等，模块级缓存）。
 * 不预热的话，本次会话第一次打开笔记要等 chunk 下载 + 解析完才出内容，
 * 期间一直显示骨架屏 —— 观感上就是「首次打开笔记闪一下」。
 */
export function prefetchEditor(): void {
  if (typeof window === "undefined") return;
  const run = () => void loadEditor();
  const ric = (
    window as Window & {
      requestIdleCallback?: (
        cb: () => void,
        opts?: { timeout: number }
      ) => number;
    }
  ).requestIdleCallback;
  if (typeof ric === "function") ric(run, { timeout: 2000 });
  else window.setTimeout(run, 300);
}

function EditorSkeleton() {
  return (
    <div className="space-y-3 p-4" aria-hidden>
      <Skeleton className="h-8 w-1/2" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-5/6" />
      <Skeleton className="h-4 w-2/3" />
    </div>
  );
}

/**
 * SSR 安全的懒加载编辑器：
 * 静态导出会对页面做预渲染，React.lazy 不能在服务端执行，
 * 因此挂载前渲染骨架屏，仅在浏览器中加载编辑器模块。
 */
export function LazyEditor(props: TipTapEditorProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <EditorSkeleton />;
  }

  return (
    <Suspense fallback={<EditorSkeleton />}>
      <TipTapEditor {...props} />
    </Suspense>
  );
}
