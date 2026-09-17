"use client";

import { SearchX } from "lucide-react";
import type { SearchPanelItem } from "@/hooks/use-search";
import { splitHighlight } from "@/lib/search/snippet";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** 关键字高亮：把命中片段包成 <mark>，未命中的原样输出 */
function Highlight({ text, query }: { text: string; query: string }) {
  return (
    <>
      {splitHighlight(text, query).map((part, i) =>
        part.match ? (
          <mark
            key={i}
            className="rounded-[3px] bg-primary/20 px-0.5 text-foreground"
          >
            {part.text}
          </mark>
        ) : (
          <span key={i}>{part.text}</span>
        )
      )}
    </>
  );
}

/** 笔记本归属：色点 + 名称（嵌套时是「父 / 子」路径） */
function NotebookTag({ item }: { item: SearchPanelItem }) {
  return (
    <span className="ml-auto flex max-w-[45%] shrink-0 items-center gap-1 text-[11px] font-normal text-muted-foreground">
      <span
        className={cn(
          "h-1.5 w-1.5 shrink-0 rounded-full",
          item.notebookColor === null &&
            "border border-dashed border-muted-foreground"
        )}
        style={
          item.notebookColor ? { backgroundColor: item.notebookColor } : undefined
        }
        aria-hidden
      />
      <span className="truncate">{item.notebookLabel}</span>
    </span>
  );
}

export interface SearchResultsPanelProps {
  /** listbox 的 id（输入框用 aria-controls 指向它） */
  listId: string;
  query: string;
  items: SearchPanelItem[];
  loading: boolean;
  activeIndex: number;
  onHover: (index: number) => void;
  onSelect: (item: SearchPanelItem) => void;
}

/**
 * 悬浮搜索结果面板。
 *
 * 刻意**不改动左栏树**：搜索是叠加在界面之上的一层，结果里已带笔记本归属，
 * 关掉面板界面就回到原样（此前是把结果灌进侧栏树，展开状态会被打散）。
 *
 * 定位分两段（实测依据：手机 390px 时输入框只有 148px、Pad 834px 时只有 186px，
 * 跟着输入框宽度走的话摘要读不了）：
 * - `lg` 以下：`fixed` 贴视口（左右各留 12px）展开成整条，从头部正下方弹出；
 * - `lg` 及以上：输入框已接近 `max-w-md`（≈448px），改回 `absolute` 与输入框左右对齐。
 * 祖先链上没有 transform / filter，`fixed` 的包含块就是视口（别给 header 加这些属性）。
 */
export function SearchResultsPanel({
  listId,
  query,
  items,
  loading,
  activeIndex,
  onHover,
  onSelect,
}: SearchResultsPanelProps) {
  return (
    <div
      id={listId}
      role="listbox"
      aria-label="搜索结果"
      className="fixed left-3 right-3 top-[3.75rem] z-50 max-h-[70vh] overflow-y-auto overscroll-contain rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg lg:absolute lg:left-0 lg:right-0 lg:top-full lg:mt-1"
    >
      {loading ? (
        <div className="space-y-1 p-1">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-1.5 px-1 py-1.5">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-full" />
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center gap-1.5 px-3 py-6 text-center">
          <SearchX
            className="h-5 w-5 text-muted-foreground/70"
            aria-hidden
          />
          <p className="text-xs text-muted-foreground">
            未找到与「{query.trim()}」相关的笔记
          </p>
          <p className="text-[11px] text-muted-foreground/80">
            搜索覆盖全部笔记本的标题与正文
          </p>
        </div>
      ) : (
        <>
          <p className="px-2 pb-1 pt-1.5 text-[11px] text-muted-foreground">
            共 {items.length} 条结果 · 全局搜索，不限当前笔记本
          </p>
          {items.map((item, index) => (
            <button
              key={item.note.id}
              type="button"
              id={`${listId}-opt-${index}`}
              role="option"
              aria-selected={index === activeIndex}
              // 不让点击抢走输入框焦点，鼠标点完之后还能继续打字
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => onHover(index)}
              onClick={() => onSelect(item)}
              className={cn(
                "flex w-full flex-col gap-1 rounded-md px-2 py-1.5 text-left transition-colors",
                index === activeIndex
                  ? "bg-accent text-accent-foreground"
                  : "hover:bg-accent/60"
              )}
            >
              <span className="flex w-full min-w-0 items-baseline gap-2">
                <span className="truncate text-sm font-medium">
                  <Highlight text={item.note.title} query={query} />
                </span>
                <NotebookTag item={item} />
              </span>
              {item.snippet && (
                <span className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                  <Highlight text={item.snippet} query={query} />
                </span>
              )}
            </button>
          ))}
        </>
      )}
    </div>
  );
}
