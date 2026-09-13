"use client";

import { useEffect, useState } from "react";
import { AlignJustify, Plus, X } from "lucide-react";
import type { Note } from "@quickwiki/shared";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/notes/empty-state";
import { NoteList } from "@/components/notes/note-list";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { useNotebooks, useNotes } from "@/hooks/use-data";
import { useNoteActions } from "@/hooks/use-note-actions";
import { useUIStore } from "@/stores/use-ui-store";
import { getSearchManager } from "@/lib/search/search-manager";
import { noteRepo } from "@/lib/data/repository";
import { cn } from "@/lib/utils";

/** 列表底部「仅标题」切换：开启后卡片只显示标题，列表栏随之收窄 */
function TitleOnlyToggle() {
  const titleOnly = useUIStore((s) => s.noteListTitleOnly);
  const setTitleOnly = useUIStore((s) => s.setNoteListTitleOnly);

  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn(
        "h-6 gap-1 px-1.5 text-xs text-muted-foreground",
        titleOnly && "bg-accent text-accent-foreground"
      )}
      onClick={() => setTitleOnly(!titleOnly)}
      aria-pressed={titleOnly}
      title={titleOnly ? "当前仅显示标题，点击恢复摘要视图" : "仅显示标题（列表栏更窄）"}
    >
      <AlignJustify className="h-3.5 w-3.5" />
      仅标题
    </Button>
  );
}

/** 当前过滤条件提示（可清除） */
function FilterChips() {
  const notebookFilter = useUIStore((s) => s.notebookFilter);
  const tagFilter = useUIStore((s) => s.tagFilter);
  const setNotebookFilter = useUIStore((s) => s.setNotebookFilter);
  const setTagFilter = useUIStore((s) => s.setTagFilter);
  const { notebooks } = useNotebooks();

  const notebook = notebooks.find((n) => n.id === notebookFilter);
  const uncategorized = notebookFilter === "none";
  if (!notebook && !uncategorized && !tagFilter) return null;

  return (
    <div className="flex flex-wrap gap-1.5 px-3 pt-3">
      {(notebook || uncategorized) && (
        <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs">
          <span
            className={cn(
              "h-2 w-2 rounded-full",
              uncategorized && "border border-dashed border-muted-foreground"
            )}
            style={notebook ? { backgroundColor: notebook.color } : undefined}
          />
          {notebook ? notebook.name : "未分类"}
          <button
            type="button"
            aria-label="清除笔记本过滤"
            className="rounded-full p-0.5 hover:bg-accent"
            onClick={() => setNotebookFilter(null)}
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      )}
      {tagFilter && (
        <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs">
          #{tagFilter}
          <button
            type="button"
            aria-label="清除标签过滤"
            className="rounded-full p-0.5 hover:bg-accent"
            onClick={() => setTagFilter(null)}
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      )}
    </div>
  );
}

export function NoteListPane() {
  const searchQuery = useUIStore((s) => s.searchQuery);
  const notebookFilter = useUIStore((s) => s.notebookFilter);
  const tagFilter = useUIStore((s) => s.tagFilter);
  const activeNoteId = useUIStore((s) => s.activeNoteId);
  const openNote = useUIStore((s) => s.openNote);

  const { createNote, deleteNote, togglePin } = useNoteActions();

  const { items, loading, hasMore, loadMore, total } = useNotes({
    notebookId: notebookFilter,
    tag: tagFilter,
  });

  // ===== 搜索模式 =====
  const [searchResults, setSearchResults] = useState<Note[] | null>(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const query = searchQuery.trim();
    if (!query) {
      setSearchResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = setTimeout(async () => {
      const hits = await getSearchManager().search(query);
      const notes = await noteRepo.listByIds(hits.map((h) => h.id));
      const noteMap = new Map(notes.map((n) => [n.id, n]));
      // 保持搜索排名顺序
      setSearchResults(
        hits
          .map((h) => noteMap.get(h.id))
          .filter((n): n is Note => Boolean(n))
      );
      setSearching(false);
    }, 150);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const isSearching = searchQuery.trim().length > 0;
  const notes = isSearching ? searchResults ?? [] : items;
  const listLoading = isSearching ? searching : loading;
  const titleOnly = useUIStore((s) => s.noteListTitleOnly);

  // ===== 删除确认 =====
  const [pendingDelete, setPendingDelete] = useState<Note | null>(null);

  const confirmDelete = async () => {
    if (pendingDelete) {
      await deleteNote(pendingDelete.id);
      setPendingDelete(null);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <FilterChips />

      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* 搜索是全局的：结果可能落在当前笔记本/标签过滤之外，明示避免误解 */}
        {isSearching && !listLoading && notes.length > 0 && (
          <p className="px-3 pt-3 text-xs text-muted-foreground">
            全局搜索：结果不限于当前笔记本 / 标签过滤
          </p>
        )}
        {listLoading ? (
          <div className="space-y-2 p-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="rounded-lg border p-3">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="mt-2 h-3 w-full" />
                <Skeleton className="mt-1 h-3 w-1/2" />
              </div>
            ))}
          </div>
        ) : notes.length === 0 ? (
          isSearching ? (
            <EmptyState
              title="未找到匹配的笔记"
              description={`没有与「${searchQuery.trim()}」相关的内容`}
            />
          ) : (
            <EmptyState
              title="还没有笔记"
              description="记录你的第一个想法，支持 Markdown 快捷输入"
              actionLabel="新建笔记"
              onAction={createNote}
            />
          )
        ) : (
          <NoteList
            notes={notes}
            loading={false}
            hasMore={!isSearching && hasMore}
            onLoadMore={loadMore}
            activeNoteId={activeNoteId}
            compact={titleOnly}
            onSelect={(id) => openNote(id)}
            onTogglePin={togglePin}
            onRequestDelete={setPendingDelete}
          />
        )}
      </div>

      {/* 列表底部统计（非搜索模式）+ 仅标题切换 */}
      {!isSearching && total > 0 && (
        <div className="flex items-center justify-between border-t px-3 py-1.5 text-xs text-muted-foreground">
          <span>共 {total} 篇笔记</span>
          <TitleOnlyToggle />
        </div>
      )}

      {/* 移动端新建笔记 FAB */}
      <Button
        className="fixed bottom-24 right-4 z-40 h-[52px] w-[52px] rounded-full p-0 shadow-lg md:hidden"
        onClick={createNote}
        aria-label="新建笔记"
        title="新建笔记"
      >
        <Plus className="h-6 w-6" />
      </Button>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="删除这篇笔记？"
        description={`「${pendingDelete?.title ?? ""}」将被永久删除，此操作无法撤销。`}
        confirmLabel="删除"
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
