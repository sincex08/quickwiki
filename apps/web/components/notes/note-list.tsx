"use client";

import {
  Fragment,
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { Note } from "@quickwiki/shared";
import type { DropTarget } from "@/components/layout/use-note-drag";
import { NoteCard } from "./note-card";

interface NoteListProps {
  notes: Note[];
  hasMore: boolean;
  onLoadMore: () => void;
  activeNoteId: string | null;
  /** 紧凑模式：卡片只展示标题 */
  compact?: boolean;
  onSelect: (id: string) => void;
  onTogglePin: (id: string, pinned: boolean) => void;
  onRequestDelete: (note: Note) => void;
  /** 是否提供顺序调整（单容器视图才有「容器内第 n 位」的概念） */
  sortable?: boolean;
  onMoveNote?: (id: string, direction: -1 | 1) => void;
  onResetOrder?: (notebookId: string | null) => void;
  /** 长按/拖动调整顺序（复用 useNoteDrag 的 state，指示线与侧栏树同一套） */
  pressedId?: string | null;
  draggingId?: string | null;
  dropTarget?: DropTarget | null;
  onDragStart?: (e: ReactPointerEvent<HTMLElement>, note: Note) => void;
}

export function NoteList({
  notes,
  hasMore,
  onLoadMore,
  activeNoteId,
  compact = false,
  onSelect,
  onTogglePin,
  onRequestDelete,
  sortable = false,
  onMoveNote,
  onResetOrder,
  pressedId = null,
  draggingId = null,
  dropTarget = null,
  onDragStart,
}: NoteListProps) {
  // 滚动到底自动加载：哨兵进入视口（含 200px 预读）触发下一页。
  // pendingRef 保证一批数据回来前不重复触发（loadMore 是纯 setLimit，可重入）
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const pendingRef = useRef(false);

  useEffect(() => {
    pendingRef.current = false;
  }, [notes.length]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !pendingRef.current) {
          pendingRef.current = true;
          onLoadMore();
        }
      },
      { rootMargin: "200px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, onLoadMore]);

  // 拖动落点指示线：单容器视图才画（搜索结果没有「容器内第 n 位」的概念）
  const containerKey = notes[0]?.notebookId ?? "";
  const dropIndex =
    sortable && dropTarget?.containerKey === containerKey ? dropTarget.index : -1;
  const dropLineAt = (i: number) =>
    i === dropIndex ? (
      <div aria-hidden className="h-0.5 rounded-full bg-primary" />
    ) : null;

  return (
    <div className="space-y-2 p-3" data-note-list>
      {notes.map((note, index) => (
        <Fragment key={note.id}>
          {dropLineAt(index)}
          <NoteCard
            note={note}
            active={note.id === activeNoteId}
            compact={compact}
            onSelect={() => onSelect(note.id)}
            onTogglePin={() => onTogglePin(note.id, note.pinned)}
            onDelete={() => onRequestDelete(note)}
            sortable={sortable}
            canMoveUp={sortable && index > 0}
            canMoveDown={sortable && index < notes.length - 1}
            manualOrder={sortable && notes.some((n) => n.sortOrder != null)}
            onMoveUp={() => onMoveNote?.(note.id, -1)}
            onMoveDown={() => onMoveNote?.(note.id, 1)}
            onResetOrder={() => onResetOrder?.(note.notebookId ?? null)}
            dragIndex={index}
            dragging={draggingId === note.id}
            pressed={pressedId === note.id}
            onDragStart={sortable ? (e) => onDragStart?.(e, note) : undefined}
          />
        </Fragment>
      ))}
      {dropLineAt(notes.length)}
      {hasMore && <div ref={sentinelRef} aria-hidden className="h-1" />}
    </div>
  );
}
