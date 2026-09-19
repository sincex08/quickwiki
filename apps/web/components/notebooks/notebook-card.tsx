"use client";

import { ChevronRight } from "lucide-react";
import type { Notebook } from "@quickwiki/shared";

interface NotebookCardProps {
  notebook: Notebook;
  /** 该子笔记本「直属」的笔记数（与侧栏角标同源，口径一致） */
  noteCount: number;
  onSelect: () => void;
}

/**
 * 移动端主列表里的子笔记本行。
 *
 * 与笔记卡片刻意同宽不同「质感」：更矮、无摘要、右侧带进入箭头，
 * 让人一眼区分「点进去是容器」与「点开是笔记」。
 * 刻意不带 `data-note-id` / `data-note-container`：它不参与笔记的
 * 拖动排序（落点容器与序号只描述笔记），带上会污染拖拽落点与列表断言。
 */
export function NotebookCard({
  notebook,
  noteCount,
  onSelect,
}: NotebookCardProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      title={`进入「${notebook.name}」`}
      className="flex w-full items-center gap-2 rounded-lg border bg-card px-3 py-2 text-left transition-colors hover:border-primary/40 focus-visible:border-primary/40 focus-visible:outline-none"
    >
      <span
        aria-hidden
        className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-inset ring-black/10 dark:ring-white/15"
        style={{ backgroundColor: notebook.color }}
      />
      <span className="min-w-0 flex-1 truncate text-sm font-medium">
        {notebook.name}
      </span>
      <span className="shrink-0 text-[11px] text-muted-foreground">
        {noteCount} 篇
      </span>
      <ChevronRight
        aria-hidden
        className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
      />
    </button>
  );
}
