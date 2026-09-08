"use client";

import { useRef, useState } from "react";
import { formatDistanceToNowStrict } from "date-fns";
import { zhCN } from "date-fns/locale";
import { Pin, Trash2 } from "lucide-react";
import type { Note } from "@quickwiki/shared";
import { cn, markdownToText } from "@/lib/utils";
import { TagBadge } from "@/components/common/tag-badge";

interface NoteCardProps {
  note: Note;
  active: boolean;
  onSelect: () => void;
  onTogglePin: () => void;
  onDelete: () => void;
}

/** 移动端左滑露出操作按钮的最大位移 */
const SWIPE_REVEAL = 96;

export function NoteCard({
  note,
  active,
  onSelect,
  onTogglePin,
  onDelete,
}: NoteCardProps) {
  const [offset, setOffset] = useState(0);
  const startX = useRef(0);
  const startY = useRef(0);
  const dragging = useRef(false);
  const moved = useRef(false);

  const snippet = markdownToText(note.content).slice(0, 100);

  const handleTouchStart = (e: React.TouchEvent) => {
    startX.current = e.touches[0].clientX;
    startY.current = e.touches[0].clientY;
    dragging.current = true;
    moved.current = false;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!dragging.current) return;
    const dx = e.touches[0].clientX - startX.current;
    const dy = e.touches[0].clientY - startY.current;
    // 纵向滑动为主时不拦截
    if (Math.abs(dy) > Math.abs(dx)) return;
    if (Math.abs(dx) > 8) moved.current = true;
    setOffset(Math.max(-SWIPE_REVEAL, Math.min(0, dx)));
  };

  const handleTouchEnd = () => {
    dragging.current = false;
    // 超过一半则保持展开，否则回弹
    setOffset((o) => (o < -SWIPE_REVEAL / 2 ? -SWIPE_REVEAL : 0));
  };

  return (
    <div className="relative overflow-hidden rounded-lg">
      {/* 滑出的操作区 */}
      <div
        className="absolute inset-y-0 right-0 flex items-stretch"
        style={{ width: SWIPE_REVEAL }}
        aria-hidden={offset === 0}
      >
        <button
          type="button"
          aria-label={note.pinned ? "取消置顶" : "置顶"}
          title={note.pinned ? "取消置顶" : "置顶"}
          onClick={onTogglePin}
          className="flex flex-1 items-center justify-center bg-secondary text-secondary-foreground"
        >
          <Pin className={cn("h-4 w-4", note.pinned && "fill-current")} />
        </button>
        <button
          type="button"
          aria-label="删除笔记"
          title="删除笔记"
          onClick={onDelete}
          className="flex flex-1 items-center justify-center bg-destructive text-destructive-foreground"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <div
        role="button"
        tabIndex={0}
        onClick={() => {
          if (moved.current) {
            moved.current = false;
            return;
          }
          if (offset !== 0) {
            setOffset(0);
            return;
          }
          onSelect();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect();
          }
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        className={cn(
          "relative cursor-pointer select-none rounded-lg border bg-card p-3 text-left transition-all hover:border-primary/40",
          active && "border-primary ring-1 ring-primary/30"
        )}
        style={{
          transform: `translateX(${offset}px)`,
          transition: dragging.current ? "none" : "transform 0.2s ease",
        }}
      >
        <div className="flex items-start gap-1.5">
          {note.pinned && (
            <Pin className="mt-1 h-3.5 w-3.5 shrink-0 fill-primary text-primary" />
          )}
          <h3 className="line-clamp-1 flex-1 text-sm font-medium">
            {note.title}
          </h3>
        </div>
        {snippet && (
          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
            {snippet}
          </p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <time className="text-[11px] text-muted-foreground">
            {formatDistanceToNowStrict(note.updatedAt, {
              locale: zhCN,
              addSuffix: true,
            })}
          </time>
          {note.tags.slice(0, 3).map((tag) => (
            <TagBadge key={tag} tag={tag} />
          ))}
        </div>
      </div>
    </div>
  );
}
