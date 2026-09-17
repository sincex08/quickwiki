"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface MarkdownSourceProps {
  /** 仅在挂载时采用；自动保存后的数据库回读不会重置输入与光标 */
  value: string;
  onChange: (markdown: string) => void;
  className?: string;
}

/** 大纲跳转事件：按 0 起行号把光标移动到目标行并滚入视野 */
const GOTO_LINE_EVENT = "quickwiki:goto-line";

export function gotoSourceLine(line: number): void {
  window.dispatchEvent(new CustomEvent(GOTO_LINE_EVENT, { detail: { line } }));
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
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const onGoto = (e: Event) => {
      const el = ref.current;
      if (!el) return;
      const line = Math.max(
        0,
        (e as CustomEvent<{ line: number }>).detail?.line ?? 0
      );
      const lines = el.value.split("\n");
      const index =
        lines.slice(0, Math.min(line, lines.length)).join("\n").length +
        (line > 0 ? 1 : 0);
      el.focus();
      el.setSelectionRange(index, index);
      // 选区设置后浏览器不会自动滚动，用行高估算滚到目标行
      const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 21;
      el.scrollTop = Math.max(0, line * lineHeight - el.clientHeight / 2);
    };
    window.addEventListener(GOTO_LINE_EVENT, onGoto);
    return () => window.removeEventListener(GOTO_LINE_EVENT, onGoto);
  }, []);

  return (
    <textarea
      ref={ref}
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
        "h-full w-full resize-none bg-background p-4 font-mono text-sm leading-relaxed outline-none placeholder:text-muted-foreground md:px-6 lg:px-8",
        className
      )}
    />
  );
}
