"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  AlignJustify,
  ChevronLeft,
  FileText,
  Folder,
  Plus,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Note } from "@quickwiki/shared";
import { NOTEBOOK_COLORS } from "@quickwiki/shared";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/notes/empty-state";
import { NoteList } from "@/components/notes/note-list";
import { NotebookCard } from "@/components/notebooks/notebook-card";
import { NotebookDialog } from "@/components/notebooks/notebook-dialog";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { useNoteDrag } from "@/components/layout/use-note-drag";
import { useNotebooks, useNotes, useNotesIndex } from "@/hooks/use-data";
import { useNoteActions } from "@/hooks/use-note-actions";
import { useUIStore, requestNewNoteConfirm } from "@/stores/use-ui-store";
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

/** 区块小标题：手机列表里「子笔记本」与「笔记」两块并存时用。
 *  两块连成一片时，缩进与卡片质感都不足以说明「哪些是容器、哪些是内容」。 */
function SectionLabel({
  icon: Icon,
  children,
}: {
  icon: LucideIcon;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-1.5 px-3 pb-2 pt-3 text-[11px] font-medium text-muted-foreground">
      <Icon aria-hidden className="h-3 w-3" />
      {children}
    </div>
  );
}

/** 当前作用域展示。
 *  笔记本为当前「位置」而非临时筛选：左侧返回箭头回父级（顶层/未分类回
 *  笔记首页），选中笔记本时右侧提供「子笔记本」新建入口；
 *  标签是叠加的临时筛选，保留 chip + 可清除。 */
function FilterChips({
  onCreateChild,
}: {
  onCreateChild: () => void;
}) {
  const notebookFilter = useUIStore((s) => s.notebookFilter);
  const tagFilter = useUIStore((s) => s.tagFilter);
  const setTagFilter = useUIStore((s) => s.setTagFilter);
  const setNotebookFilter = useUIStore((s) => s.setNotebookFilter);
  const { notebooks } = useNotebooks();

  const notebook = notebooks.find((n) => n.id === notebookFilter);
  const uncategorized = notebookFilter === "none";
  if (!notebook && !uncategorized && !tagFilter) return null;

  // 返回上一级：父笔记本；未分类 / 顶层笔记本 → null（笔记首页）
  const parent = notebook?.parentId ?? null;
  const parentName = parent
    ? (notebooks.find((n) => n.id === parent)?.name ?? "上一级")
    : null;

  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 border-b px-3 py-2">
      {(notebook || uncategorized) && (
        <>
          <button
            type="button"
            aria-label={parentName ? `返回「${parentName}」` : "返回上一级"}
            title={parentName ? `返回「${parentName}」` : "返回上一级"}
            onClick={() => setNotebookFilter(parent)}
            className="-ml-1 shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div className="flex min-w-0 items-center gap-2">
            <span
              className={cn(
                "h-2.5 w-2.5 shrink-0 rounded-full",
                uncategorized && "border border-dashed border-muted-foreground"
              )}
              style={notebook ? { backgroundColor: notebook.color } : undefined}
            />
            <span className="truncate text-sm font-semibold">
              {notebook ? notebook.name : "未分类"}
            </span>
          </div>
        </>
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
      {notebook && (
        <button
          type="button"
          onClick={onCreateChild}
          className="ml-auto inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          title={`在「${notebook.name}」下新建子笔记本`}
        >
          <Plus className="h-3.5 w-3.5" />
          子笔记本
        </button>
      )}
    </div>
  );
}

export function NoteListPane() {
  const notebookFilter = useUIStore((s) => s.notebookFilter);
  const tagFilter = useUIStore((s) => s.tagFilter);
  const setTagFilter = useUIStore((s) => s.setTagFilter);
  const activeNoteId = useUIStore((s) => s.activeNoteId);
  const openNote = useUIStore((s) => s.openNote);
  const setNotebookFilter = useUIStore((s) => s.setNotebookFilter);

  const {
    deleteNote,
    togglePin,
    moveNote,
    moveNoteToPosition,
    resetOrder,
  } = useNoteActions();
  // 手机主列表的长按拖动：与侧栏树共用同一套拖拽逻辑（落点/指示线都靠同一份 state）
  const { draggingId, pressedId, dropTarget, startDrag } = useNoteDrag(
    (id, notebookId, index) => void moveNoteToPosition(id, notebookId, index)
  );

  const { items, loading, hasMore, loadMore, total } = useNotes({
    notebookId: notebookFilter,
    tag: tagFilter,
  });

  // ===== 子笔记本：当前笔记本的直接子级，与笔记同屏展示 =====
  // 此前这里只列直属笔记，子笔记本只能回左栏找——「当前笔记本里还有什么」
  // 需要两处切换才能看全（2026-09-19）。
  const { notebooks } = useNotebooks();
  const { items: noteIndex } = useNotesIndex();
  const childNotebooks = useMemo(() => {
    if (!notebookFilter || notebookFilter === "none") return [];
    return notebooks.filter((nb) => nb.parentId === notebookFilter);
  }, [notebooks, notebookFilter]);
  /** 子笔记本的笔记数：与侧栏角标同源（listIndex），两处数字永远一致 */
  const childNoteCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const n of noteIndex) {
      if (n.notebookId == null) continue;
      counts.set(n.notebookId, (counts.get(n.notebookId) ?? 0) + 1);
    }
    return counts;
  }, [noteIndex]);
  const hasChildNotebooks = childNotebooks.length > 0;

  // ===== 搜索已移出列表栏 =====
  // 搜索改为顶部搜索框的悬浮结果面板（components/search），结果不回写列表。
  // 因此这里永远是「当前笔记本（或未分类）的单一容器视图」：
  // 排序、拖拽、分页口径统一，不再有「搜索态下禁用排序」这类分支。
  const titleOnly = useUIStore((s) => s.noteListTitleOnly);

  // ===== 删除确认 =====
  const [pendingDelete, setPendingDelete] = useState<Note | null>(null);

  const confirmDelete = async () => {
    if (pendingDelete) {
      await deleteNote(pendingDelete.id);
      setPendingDelete(null);
    }
  };

  // ===== 在当前作用域下新建子笔记本（与侧栏共用同一对话框组件） =====
  const [childDialogOpen, setChildDialogOpen] = useState(false);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <FilterChips onCreateChild={() => setChildDialogOpen(true)} />

      {/* 拖动时靠它做靠近边缘自动滚动 */}
      <div className="min-h-0 flex-1 overflow-y-auto" data-note-drag-scroll>
        {/* 子笔记本区块：容器条目，点进去即切换「当前位置」 */}
        {hasChildNotebooks && (
          <div className="border-b pb-2">
            <SectionLabel icon={Folder}>子笔记本</SectionLabel>
            <div className="space-y-1.5 px-3">
              {childNotebooks.map((nb) => (
                <NotebookCard
                  key={nb.id}
                  notebook={nb}
                  noteCount={childNoteCounts.get(nb.id) ?? 0}
                  onSelect={() => setNotebookFilter(nb.id)}
                />
              ))}
            </div>
          </div>
        )}

        {loading ? (
          <div className="space-y-2 p-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="rounded-lg border p-3">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="mt-2 h-3 w-full" />
                <Skeleton className="mt-1 h-3 w-1/2" />
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          // 有子笔记本时不再喊「还没有笔记」：容器非空，只是自己没有直属笔记；
          // 标签过滤态下新建会落进推断的笔记本（不受标签约束），文案不再引导创建
          hasChildNotebooks ? (
            <div className="px-3 py-6 text-center text-xs text-muted-foreground">
              该笔记本下暂无直属笔记
            </div>
          ) : tagFilter ? (
            <div className="px-3 py-6 text-center text-xs text-muted-foreground">
              没有打过「#{tagFilter}」标签的笔记，
              <button
                type="button"
                className="text-primary hover:underline"
                onClick={() => setTagFilter(null)}
              >
                清除标签过滤
              </button>
              查看全部
            </div>
          ) : (
            <EmptyState
              title="还没有笔记"
              description="记录你的第一个想法，支持 Markdown 快捷输入"
              actionLabel="新建笔记"
              onAction={requestNewNoteConfirm}
            />
          )
        ) : (
          <>
            {/* 两类条目并存时才给笔记块一个标题，避免与上方容器混成一片 */}
            {hasChildNotebooks && <SectionLabel icon={FileText}>笔记</SectionLabel>}
            <NoteList
              notes={items}
              hasMore={hasMore}
              onLoadMore={loadMore}
              activeNoteId={activeNoteId}
              compact={titleOnly}
              onSelect={(id) => openNote(id)}
              onTogglePin={togglePin}
              onRequestDelete={setPendingDelete}
              sortable
              pressedId={pressedId}
              draggingId={draggingId}
              dropTarget={dropTarget}
              onDragStart={startDrag}
              onMoveNote={(id, direction) => void moveNote(id, direction)}
              onResetOrder={(notebookId) => void resetOrder(notebookId)}
            />
          </>
        )}
      </div>

      {/* 列表底部统计 + 仅标题切换（底部让位全面屏 Home 指示条） */}
      {total > 0 && (
        <div className="flex items-center justify-between border-t px-3 pt-1.5 pb-[calc(0.375rem+env(safe-area-inset-bottom))] text-xs text-muted-foreground">
          <span>共 {total} 篇笔记</span>
          <TitleOnlyToggle />
        </div>
      )}

      {/* 移动端新建笔记 FAB。
          抬高到统计栏（含「仅标题」）之上：此前 bottom-6 正好压在统计栏右侧，
          把「仅标题」盖住且抢走它的点击（2026-09-19 实测）；
          右/下再叠加安全区，避免贴住 Home 指示条与横屏刘海。
          落点确认与顶部按钮/Ctrl+N 走同一事件流程（三入口行为一致）。 */}
      <Button
        className="fixed bottom-[calc(4rem+env(safe-area-inset-bottom))] right-[calc(1rem+env(safe-area-inset-right))] z-40 h-[52px] w-[52px] rounded-full p-0 shadow-lg md:hidden"
        onClick={requestNewNoteConfirm}
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

      {/* 新建子笔记本：默认挂在当前作用域下（FilterChips 的「+ 子笔记本」入口） */}
      <NotebookDialog
        open={childDialogOpen}
        onOpenChange={setChildDialogOpen}
        editingId={null}
        initialName=""
        initialColor={NOTEBOOK_COLORS[0]}
        initialParentId={
          notebookFilter && notebookFilter !== "none" ? notebookFilter : null
        }
      />
    </div>
  );
}
