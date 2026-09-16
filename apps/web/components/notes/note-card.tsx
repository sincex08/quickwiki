"use client";

import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { formatDistanceToNowStrict } from "date-fns";
import { zhCN } from "date-fns/locale";
import { ArrowDown, ArrowUp, MoreHorizontal, Pin, RotateCcw, Trash2 } from "lucide-react";
import type { Note } from "@quickwiki/shared";
import { cn, markdownToText } from "@/lib/utils";
import { TagBadge } from "@/components/common/tag-badge";
import { noteRowDragProps } from "@/components/layout/use-note-drag";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface NoteCardProps {
  note: Note;
  active: boolean;
  /** 紧凑模式：只展示标题（列表栏收窄时使用） */
  compact?: boolean;
  onSelect: () => void;
  onTogglePin: () => void;
  onDelete: () => void;
  /** 顺序调整（手机端没有拖拽，这里是唯一入口）；混合视图下 sortable=false */
  sortable?: boolean;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  /** 所在容器已手动排序 → 菜单出现「恢复默认顺序」 */
  manualOrder?: boolean;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onResetOrder?: () => void;
  /** 长按拖动（手机主列表）：下标用于落点换算，dragging 时卡片半透明且让位给拖拽 */
  dragIndex?: number;
  dragging?: boolean;
  onDragStart?: (e: ReactPointerEvent<HTMLElement>) => void;
}

/** 移动端左滑露出操作按钮的最大位移 */
const SWIPE_REVEAL = 96;

export function NoteCard({
  note,
  active,
  compact = false,
  onSelect,
  onTogglePin,
  onDelete,
  sortable = false,
  canMoveUp = false,
  canMoveDown = false,
  manualOrder = false,
  onMoveUp,
  onMoveDown,
  onResetOrder,
  dragIndex = 0,
  dragging = false,
  onDragStart,
}: NoteCardProps) {
  const [offset, setOffset] = useState(0);
  const startX = useRef(0);
  const startY = useRef(0);
  /** 左滑手势进行中（与长按拖动互斥，故不叫 dragging） */
  const swiping = useRef(false);
  const moved = useRef(false);

  const snippet = useMemo(
    () => (compact ? "" : markdownToText(note.content).slice(0, 100)),
    [compact, note.content]
  );

  const handleTouchStart = (e: React.TouchEvent) => {
    // 长按拖动已激活：不要进入左滑（两个手势共用 touch，必须互斥）
    if (dragging) return;
    startX.current = e.touches[0].clientX;
    startY.current = e.touches[0].clientY;
    swiping.current = true;
    moved.current = false;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (dragging || !swiping.current) return;
    const dx = e.touches[0].clientX - startX.current;
    const dy = e.touches[0].clientY - startY.current;
    // 纵向滑动为主时不拦截
    if (Math.abs(dy) > Math.abs(dx)) return;
    if (Math.abs(dx) > 8) moved.current = true;
    setOffset(Math.max(-SWIPE_REVEAL, Math.min(0, dx)));
  };

  const handleTouchEnd = () => {
    swiping.current = false;
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
        {...(onDragStart ? noteRowDragProps(note, dragIndex) : {})}
        onPointerDown={onDragStart}
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
          "group relative cursor-pointer select-none rounded-lg border bg-card p-3 text-left transition-[transform,border-color,box-shadow] hover:border-primary/40 [-webkit-touch-callout:none]",
          compact && "px-3 py-2",
          active && "border-primary ring-1 ring-primary/30",
          dragging && "opacity-40"
        )}
        style={{
          transform: `translateX(${offset}px)`,
          transition: swiping.current ? "none" : "transform 0.2s ease",
        }}
      >
        {/* 操作菜单：桌面悬浮出现；移动端常驻（左滑区只放高频的置顶 / 删除，
            顺序调整放这里，避免滑出区挤成一片） */}
        <div className="absolute right-1 top-1 opacity-100 transition-opacity focus-within:opacity-100 group-hover:opacity-100 md:opacity-0 md:focus-within:opacity-100 md:group-hover:opacity-100">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                data-no-drag
                aria-label={`笔记 ${note.title} 操作`}
                title="更多操作"
                // 阻止冒泡到卡片本身的 onClick，避免打开笔记
                onClick={(e) => e.stopPropagation()}
                className="rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground"
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onTogglePin}>
                <Pin className={cn("mr-2 h-4 w-4", note.pinned && "fill-primary text-primary")} />
                {note.pinned ? "取消置顶" : "置顶"}
              </DropdownMenuItem>
              {sortable && (
                <>
                  <DropdownMenuItem disabled={!canMoveUp} onClick={onMoveUp}>
                    <ArrowUp className="mr-2 h-4 w-4" />
                    上移
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled={!canMoveDown} onClick={onMoveDown}>
                    <ArrowDown className="mr-2 h-4 w-4" />
                    下移
                  </DropdownMenuItem>
                  {manualOrder && (
                    <DropdownMenuItem onClick={onResetOrder}>
                      <RotateCcw className="mr-2 h-4 w-4" />
                      恢复默认顺序
                    </DropdownMenuItem>
                  )}
                </>
              )}
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={onDelete}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                删除
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
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
        {!compact && (
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
        )}
      </div>
    </div>
  );
}
