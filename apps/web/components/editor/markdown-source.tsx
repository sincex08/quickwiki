"use client";

import { cn } from "@/lib/utils";

export interface MarkdownSourceProps {
  value: string;
  onChange: (markdown: string) => void;
  className?: string;
}

/** Markdown 源码编辑视图：等宽字体 textarea，Tab 插入两个空格 */
export function MarkdownSource({
  value,
  onChange,
  className,
}: MarkdownSourceProps) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Tab") {
          e.preventDefault();
          const el = e.currentTarget;
          const { selectionStart, selectionEnd } = el;
          const next = `${value.slice(0, selectionStart)}  ${value.slice(selectionEnd)}`;
          onChange(next);
          // 恢复光标位置（受控组件渲染后）
          requestAnimationFrame(() => {
            el.selectionStart = el.selectionEnd = selectionStart + 2;
          });
        }
      }}
      spellCheck={false}
      aria-label="Markdown 源码"
      placeholder="直接书写 Markdown…"
      className={cn(
        "h-full w-full resize-none bg-background p-4 font-mono text-sm leading-relaxed outline-none placeholder:text-muted-foreground",
        className
      )}
    />
  );
}
