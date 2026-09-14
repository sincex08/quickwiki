"use client";

import { useEffect, useRef } from "react";
import type { Note } from "@quickwiki/shared";
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

  return (
    <div className="space-y-2 p-3">
      {notes.map((note) => (
        <NoteCard
          key={note.id}
          note={note}
          active={note.id === activeNoteId}
          compact={compact}
          onSelect={() => onSelect(note.id)}
          onTogglePin={() => onTogglePin(note.id, note.pinned)}
          onDelete={() => onRequestDelete(note)}
        />
      ))}
      {hasMore && <div ref={sentinelRef} aria-hidden className="h-1" />}
    </div>
  );
}
