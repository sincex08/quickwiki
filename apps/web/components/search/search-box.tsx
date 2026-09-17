"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import type { Notebook } from "@quickwiki/shared";
import { SearchResultsPanel } from "@/components/search/search-results-panel";
import { useSearchPanel, type SearchPanelItem } from "@/hooks/use-search";
import { useNotebooks } from "@/hooks/use-data";
import { notebookAncestors } from "@/lib/data/notebook-tree";
import { useUIStore } from "@/stores/use-ui-store";

const LIST_ID = "global-search-results";

/** 目标笔记本及其全部祖先的 id（跳转后把侧栏树展开到它）；未分类用 "none" */
function notebookChainIds(notebooks: Notebook[], id: string | null): string[] {
  if (!id) return ["none"];
  const chain = notebookAncestors(notebooks, id).map((nb) => nb.id);
  return chain.length > 0 ? chain : ["none"];
}

/**
 * 顶部搜索框 + 悬浮结果面板。
 *
 * 搜索状态是**组件局部**的：此前搜索词存在全局 store 里、由侧栏树与移动端列表
 * 各自消费，结果是「搜索会把左栏换掉」；现在结果只出现在这个面板里，
 * 左栏树、当前笔记本、列表都保持原样，关掉面板界面即回到原状。
 */
export function SearchBox() {
  const router = useRouter();
  const openNote = useUIStore((s) => s.openNote);
  const setNotebookFilter = useUIStore((s) => s.setNotebookFilter);
  const expandTreeIds = useUIStore((s) => s.expandTreeIds);
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen);
  const { notebooks } = useNotebooks();

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const boxRef = useRef<HTMLDivElement | null>(null);

  const { items, searching, isSearching } = useSearchPanel(query);

  // 关键词变化 → 高亮项回到首条（否则下标可能越界）
  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  // 点击面板外部收起（用 pointerdown：早于 click，避免与结果点击竞争）
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const closePanel = () => {
    setOpen(false);
    setQuery("");
  };

  const handleSelect = (item: SearchPanelItem) => {
    const { note } = item;
    // 打开笔记，并把「当前位置」切到它所属的笔记本：编辑器内容与侧栏高亮保持一致
    openNote(note.id);
    setNotebookFilter(note.notebookId ?? "none");
    expandTreeIds(notebookChainIds(notebooks, note.notebookId));
    closePanel();
    if (typeof window !== "undefined" && window.location.pathname !== "/notes") {
      router.push("/notes");
    }
    // 移动端：抽屉里的树也一并收起，直接看笔记
    setSidebarOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      if (query || open) closePanel();
      else e.currentTarget.blur();
      return;
    }
    if (!isSearching) return;

    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      if (items.length === 0) return;
      setActiveIndex((i) => {
        const next = e.key === "ArrowDown" ? i + 1 : i - 1;
        if (next < 0) return 0;
        if (next > items.length - 1) return items.length - 1;
        return next;
      });
      return;
    }

    if (e.key === "Enter" && open) {
      const item = items[activeIndex];
      if (item) {
        e.preventDefault();
        handleSelect(item);
      }
    }
  };

  return (
    <div ref={boxRef} className="relative w-full min-w-0 max-w-md">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => {
          if (query) setOpen(true);
        }}
        onKeyDown={handleKeyDown}
        placeholder="搜索笔记…"
        aria-label="搜索笔记"
        role="combobox"
        aria-expanded={open && isSearching}
        aria-controls={LIST_ID}
        aria-autocomplete="list"
        aria-activedescendant={
          open && items[activeIndex] ? `${LIST_ID}-opt-${activeIndex}` : undefined
        }
        className="h-9 w-full min-w-0 rounded-md border border-input bg-background pl-8 pr-8 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:text-sm"
      />
      {query && (
        <button
          type="button"
          aria-label="清除搜索"
          title="清除搜索"
          onClick={closePanel}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      )}

      {open && isSearching && (
        <SearchResultsPanel
          listId={LIST_ID}
          query={query}
          items={items}
          loading={searching}
          activeIndex={activeIndex}
          onHover={setActiveIndex}
          onSelect={handleSelect}
        />
      )}
    </div>
  );
}
