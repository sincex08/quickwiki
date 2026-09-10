"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

export interface MarkdownSourceProps {
  /** 仅在挂载时采用；自动保存后的数据库回读不会重置输入与光标 */
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
  // 内部持有文本：若直接用受控 value，自动保存触发的事件回读刷新 props 时
  // 会重写 textarea，光标被强制移到文档末尾
  const [text, setText] = useState(value);

  return (
    <textarea
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        onChange(e.target.value);
      }}
      onKeyDown={(e) => {
        if (e.key === "Tab") {
          e.preventDefault();
          const el = e.currentTarget;
          const { selectionStart, selectionEnd } = el;
          const next = `${text.slice(0, selectionStart)}  ${text.slice(selectionEnd)}`;
          setText(next);
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
