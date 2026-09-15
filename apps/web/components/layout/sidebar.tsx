"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatDistanceToNowStrict } from "date-fns";
import { zhCN } from "date-fns/locale";
import {
  Book,
  ChevronRight,
  FileText,
  MoreHorizontal,
  Pencil,
  Pin,
  Plus,
  Tag as TagIcon,
  Trash2,
} from "lucide-react";
import type { Notebook } from "@quickwiki/shared";
import { NOTEBOOK_COLORS } from "@quickwiki/shared";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { NotebookDialog } from "@/components/notebooks/notebook-dialog";
import {
  useNotebooks,
  useNoteCounts,
  useNotesIndex,
  useTags,
} from "@/hooks/use-data";
import { useSearchResults } from "@/hooks/use-search";
import { useNoteActions } from "@/hooks/use-note-actions";
import { useUIStore } from "@/stores/use-ui-store";
import { notebookRepo } from "@/lib/data/repository";
import type { NoteIndexItem } from "@/lib/data/repository";

/** 每个展开节点初始渲染的笔记行数，滚到底自动追加 */
const TREE_PAGE_SIZE = 50;
/** 树节点每层缩进（px） */
const DEPTH_INDENT = 14;

/** 笔记行共用的回调（由 SidebarContent 统一提供） */
interface NoteRowActions {
  activeNoteId: string | null;
  onOpenNote: (id: string) => void;
  onTogglePin: (id: string, pinned: boolean) => void;
  onDeleteNote: (note: NoteIndexItem) => void;
}

/** 树内笔记行：标题 + 相对时间 + 悬浮操作 */
function NoteRow({
  note,
  depth,
  actions,
}: {
  note: NoteIndexItem;
  depth: number;
  actions: NoteRowActions;
}) {
  const active = note.id === actions.activeNoteId;
  return (
    <div
      className={cn(
        "group flex w-full items-center rounded-md pr-1.5 text-sm transition-colors hover:bg-accent",
        active && "bg-accent text-accent-foreground"
      )}
      style={{ paddingLeft: 8 + depth * DEPTH_INDENT }}
    >
      <button
        type="button"
        onClick={() => actions.onOpenNote(note.id)}
        className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden py-1.5 text-left"
        title={note.title}
      >
        {note.pinned && (
          <Pin className="h-3 w-3 shrink-0 fill-primary text-primary" />
        )}
        <span className="truncate">{note.title}</span>
        <span className="ml-auto shrink-0 pl-2 text-[11px] text-muted-foreground">
          {formatDistanceToNowStrict(note.updatedAt, {
            locale: zhCN,
            addSuffix: true,
          })}
        </span>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`笔记「${note.title}」操作`}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-opacity hover:bg-background hover:text-foreground lg:opacity-0 lg:group-hover:opacity-100 lg:focus:opacity-100"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => actions.onTogglePin(note.id, note.pinned)}>
            <Pin
              className={cn(
                "mr-2 h-4 w-4",
                note.pinned && "fill-primary text-primary"
              )}
            />
            {note.pinned ? "取消置顶" : "置顶"}
          </DropdownMenuItem>
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onClick={() => actions.onDeleteNote(note)}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            删除
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** 某节点下的笔记行列表：分页渲染 + 滚动到底自动加载 */
function TreeNoteRows({
  notes,
  depth,
  actions,
}: {
  notes: NoteIndexItem[];
  depth: number;
  actions: NoteRowActions;
}) {
  const [limit, setLimit] = useState(TREE_PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const pendingRef = useRef(false);

  const visible = notes.slice(0, limit);
  const hasMore = limit < notes.length;

  // 一批数据回来前不重复触发（与 note-list 的哨兵逻辑一致）
  useEffect(() => {
    pendingRef.current = false;
  }, [visible.length]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !pendingRef.current) {
          pendingRef.current = true;
          setLimit((l) => l + TREE_PAGE_SIZE);
        }
      },
      { rootMargin: "200px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore]);

  if (notes.length === 0) {
    return (
      <div
        className="py-1 pr-2 text-xs text-muted-foreground"
        style={{ paddingLeft: 8 + (depth + 1) * DEPTH_INDENT }}
      >
        暂无笔记
      </div>
    );
  }

  return (
    <div>
      {visible.map((n) => (
        <NoteRow key={n.id} note={n} depth={depth + 1} actions={actions} />
      ))}
      {hasMore && <div ref={sentinelRef} aria-hidden className="h-1" />}
    </div>
  );
}

/** 笔记本节点递归渲染所需的共享数据与回调 */
interface TreeBundle {
  childNotebooksOf: Map<string | null, Notebook[]>;
  notesByNotebook: Map<string, NoteIndexItem[]>;
  countsByNotebook: Record<string, number>;
  expandedSet: Set<string>;
  selectedId: string | null;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
  onCreateNote: (id: string) => void;
  onRename: (id: string) => void;
  onRequestDelete: (id: string) => void;
  actions: NoteRowActions;
}

/** 笔记本树节点：折叠箭头 + 色点 + 名称 + 数量；展开后先列子笔记本再列笔记 */
function NotebookNode({
  notebook,
  depth,
  bundle,
}: {
  notebook: Notebook;
  depth: number;
  bundle: TreeBundle;
}) {
  const {
    childNotebooksOf,
    notesByNotebook,
    countsByNotebook,
    expandedSet,
    selectedId,
    onToggle,
    onSelect,
    onCreateNote,
    onRename,
    onRequestDelete,
    actions,
  } = bundle;

  const childNotebooks = childNotebooksOf.get(notebook.id) ?? [];
  const childNotes = notesByNotebook.get(notebook.id) ?? [];
  const expanded = expandedSet.has(notebook.id);
  const hasChildren = childNotebooks.length > 0 || childNotes.length > 0;
  const selected = selectedId === notebook.id;

  return (
    <div>
      <div
        className={cn(
          "group flex w-full items-center gap-0.5 rounded-md pr-1.5 text-sm transition-colors hover:bg-accent",
          selected && "bg-accent text-accent-foreground"
        )}
        style={{ paddingLeft: 4 + depth * DEPTH_INDENT }}
      >
        {hasChildren ? (
          <button
            type="button"
            aria-label={expanded ? `收起「${notebook.name}」` : `展开「${notebook.name}」`}
            onClick={() => onToggle(notebook.id)}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded hover:bg-background"
          >
            <ChevronRight
              className={cn(
                "h-3.5 w-3.5 text-muted-foreground transition-transform",
                expanded && "rotate-90"
              )}
            />
          </button>
        ) : (
          <span aria-hidden className="w-5 shrink-0" />
        )}
        <button
          type="button"
          onClick={() => {
            if (hasChildren) onToggle(notebook.id);
            onSelect(notebook.id);
          }}
          className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden py-1.5 text-left"
          title={notebook.name}
        >
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: notebook.color }}
          />
          <span className="truncate">{notebook.name}</span>
          <span className="ml-auto shrink-0 pl-2 text-xs text-muted-foreground">
            {countsByNotebook[notebook.id] ?? 0}
          </span>
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`笔记本 ${notebook.name} 操作`}
              title={`笔记本「${notebook.name}」：新建笔记 / 重命名 / 删除`}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-opacity hover:bg-background hover:text-foreground lg:opacity-0 lg:group-hover:opacity-100 lg:focus:opacity-100"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onCreateNote(notebook.id)}>
              <Plus className="mr-2 h-4 w-4" />
              新建笔记
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onRename(notebook.id)}>
              <Pencil className="mr-2 h-4 w-4" />
              重命名 / 移动
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => onRequestDelete(notebook.id)}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              删除
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {expanded && (
        <div>
          {childNotebooks.map((child) => (
            <NotebookNode
              key={child.id}
              notebook={child}
              depth={depth + 1}
              bundle={bundle}
            />
          ))}
          {/* 纯容器（只有子笔记本、没有笔记）不再额外占一行「暂无笔记」 */}
          {(childNotes.length > 0 || childNotebooks.length === 0) && (
            <TreeNoteRows notes={childNotes} depth={depth} actions={actions} />
          )}
        </div>
      )}
    </div>
  );
}

/**
 * 侧边栏主体：树状导航（笔记本 → 笔记）+ 标签。
 * 桌面端作为唯一导航栏（中间列表栏已并入此树）；移动端复用于抽屉。
 */
export function SidebarContent() {
  const router = useRouter();
  const { notebooks } = useNotebooks();
  const counts = useNoteCounts();
  const { tags } = useTags();
  const { items: noteIndex, loading: indexLoading } = useNotesIndex();
  const searchQuery = useUIStore((s) => s.searchQuery);
  const notebookFilter = useUIStore((s) => s.notebookFilter);
  const tagFilter = useUIStore((s) => s.tagFilter);
  const setNotebookFilter = useUIStore((s) => s.setNotebookFilter);
  const setTagFilter = useUIStore((s) => s.setTagFilter);
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen);
  const openNote = useUIStore((s) => s.openNote);
  const activeNoteId = useUIStore((s) => s.activeNoteId);
  const treeExpandedAll = useUIStore((s) => s.treeExpandedAll);
  const treeExpandedIds = useUIStore((s) => s.treeExpandedIds);
  const toggleTreeExpandedAll = useUIStore((s) => s.toggleTreeExpandedAll);
  const toggleTreeExpandedId = useUIStore((s) => s.toggleTreeExpandedId);

  const { createNote, deleteNote, togglePin } = useNoteActions();
  const { results: searchResults, searching, isSearching } =
    useSearchResults(searchQuery);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [pendingDeleteNote, setPendingDeleteNote] =
    useState<NoteIndexItem | null>(null);

  const expandedSet = useMemo(
    () => new Set(treeExpandedIds),
    [treeExpandedIds]
  );

  // 标签过滤叠加在树内所有分组上（与列表栏行为一致）
  const filteredIndex = useMemo(
    () =>
      tagFilter
        ? noteIndex.filter((n) => n.tags.includes(tagFilter))
        : noteIndex,
    [noteIndex, tagFilter]
  );

  // 按笔记本分组；索引本身已按「置顶优先 + 更新时间倒序」排好，分组保持顺序
  const { notesByNotebook, uncategorizedNotes } = useMemo(() => {
    const byNb = new Map<string, NoteIndexItem[]>();
    const uncategorized: NoteIndexItem[] = [];
    for (const n of filteredIndex) {
      if (n.notebookId == null) {
        uncategorized.push(n);
      } else {
        const arr = byNb.get(n.notebookId);
        if (arr) arr.push(n);
        else byNb.set(n.notebookId, [n]);
      }
    }
    return { notesByNotebook: byNb, uncategorizedNotes: uncategorized };
  }, [filteredIndex]);

  // 笔记本父子关系（parentId 为空，或父级已不存在——如远端删除先同步过来——
  // 都按根级处理，保证节点可达）
  const childNotebooksOf = useMemo(() => {
    const ids = new Set(notebooks.map((nb) => nb.id));
    const map = new Map<string | null, Notebook[]>();
    for (const nb of notebooks) {
      const key = nb.parentId && ids.has(nb.parentId) ? nb.parentId : null;
      const arr = map.get(key);
      if (arr) arr.push(nb);
      else map.set(key, [nb]);
    }
    return map;
  }, [notebooks]);

  const goNotes = () => {
    setSidebarOpen(false);
    if (
      typeof window !== "undefined" &&
      window.location.pathname !== "/notes"
    ) {
      router.push("/notes");
    }
  };

  const handleOpenNote = (id: string) => {
    openNote(id);
    goNotes();
  };

  const selectNotebook = (id: string | null) => {
    // 选中是单选状态：重复点击已选项不取消，只能通过切换其它项更换
    setNotebookFilter(id);
    goNotes();
  };

  const confirmDeleteNotebook = async () => {
    if (deleteId) {
      if (notebookFilter === deleteId) setNotebookFilter(null);
      await notebookRepo.delete(deleteId);
    }
    setDeleteId(null);
  };

  const confirmDeleteNote = async () => {
    if (pendingDeleteNote) {
      await deleteNote(pendingDeleteNote.id);
      setPendingDeleteNote(null);
    }
  };

  const actions: NoteRowActions = {
    activeNoteId,
    onOpenNote: handleOpenNote,
    onTogglePin: togglePin,
    onDeleteNote: setPendingDeleteNote,
  };

  const bundle: TreeBundle = {
    childNotebooksOf,
    notesByNotebook,
    countsByNotebook: counts.byNotebook,
    expandedSet,
    selectedId: notebookFilter,
    onToggle: toggleTreeExpandedId,
    onSelect: (id) => selectNotebook(id),
    onCreateNote: (id) => {
      void createNote({ notebookId: id });
      goNotes();
    },
    onRename: (id) => {
      setEditingId(id);
      setDialogOpen(true);
    },
    onRequestDelete: setDeleteId,
    actions,
  };

  const rootNotebooks = childNotebooksOf.get(null) ?? [];

  return (
    <div className="flex h-full flex-col">
      {/* 品牌区 */}
      <div className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Book className="h-4 w-4" />
        </div>
        <span className="font-semibold">QuickWiki</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {/* 新建笔记本 */}
        <Button
          variant="outline"
          size="sm"
          className="mb-4 w-full justify-start gap-2"
          onClick={() => {
            setEditingId(null);
            setDialogOpen(true);
          }}
        >
          <Plus className="h-4 w-4" />
          新建笔记本
        </Button>

        {isSearching ? (
          /* ===== 搜索态：结果替换树区（全局搜索，与过滤器无关） ===== */
          <div>
            {searching ? (
              <div className="space-y-2 p-1">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-6 w-full" />
                ))}
              </div>
            ) : (searchResults?.length ?? 0) === 0 ? (
              <div className="px-2 py-4 text-xs text-muted-foreground">
                未找到与「{searchQuery.trim()}」相关的笔记
              </div>
            ) : (
              <>
                <p className="px-2 pb-1 pt-1 text-xs text-muted-foreground">
                  找到 {searchResults?.length} 条结果 ·
                  全局搜索，不限当前笔记本 / 标签
                </p>
                {(searchResults ?? []).map((n) => (
                  <NoteRow key={n.id} note={n} depth={0} actions={actions} />
                ))}
              </>
            )}
          </div>
        ) : (
          <>
            {/* ===== 全部笔记（可展开列出全部） ===== */}
            <div
              className={cn(
                "group flex w-full items-center gap-0.5 rounded-md pr-1.5 text-sm transition-colors hover:bg-accent",
                notebookFilter === null &&
                  !tagFilter &&
                  "bg-accent text-accent-foreground"
              )}
            >
              {filteredIndex.length > 0 ? (
                <button
                  type="button"
                  aria-label={treeExpandedAll ? "收起全部笔记" : "展开全部笔记"}
                  onClick={toggleTreeExpandedAll}
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded hover:bg-background"
                >
                  <ChevronRight
                    className={cn(
                      "h-3.5 w-3.5 text-muted-foreground transition-transform",
                      treeExpandedAll && "rotate-90"
                    )}
                  />
                </button>
              ) : (
                <span aria-hidden className="w-5 shrink-0" />
              )}
              <button
                type="button"
                onClick={() => {
                  if (filteredIndex.length > 0) toggleTreeExpandedAll();
                  selectNotebook(null);
                }}
                className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left"
              >
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="truncate">全部笔记</span>
                <span className="ml-auto shrink-0 pl-2 text-xs text-muted-foreground">
                  {counts.all}
                </span>
              </button>
              {/* 与笔记本行的操作按钮等宽占位，保证各计数右对齐 */}
              <span aria-hidden className="w-6 shrink-0" />
            </div>
            {treeExpandedAll && (
              <TreeNoteRows
                notes={filteredIndex}
                depth={0}
                actions={actions}
              />
            )}

            {/* ===== 笔记本树 ===== */}
            <div className="mt-4">
              <div className="mb-1 flex items-center justify-between px-2">
                <span className="text-xs font-medium text-muted-foreground">
                  笔记本
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setSidebarOpen(false);
                    router.push("/notebooks");
                  }}
                  className="text-xs text-muted-foreground transition-colors hover:text-foreground"
                >
                  管理
                </button>
              </div>
              {indexLoading && (
                <div className="space-y-2 p-1">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-6 w-full" />
                  ))}
                </div>
              )}
              {rootNotebooks.length === 0 && !indexLoading && (
                <div className="px-2 py-1 text-xs text-muted-foreground">
                  暂无笔记本
                </div>
              )}
              {rootNotebooks.map((nb) => (
                <NotebookNode
                  key={nb.id}
                  notebook={nb}
                  depth={0}
                  bundle={bundle}
                />
              ))}

              {/* 未分类：不属于任何笔记本的笔记，同样可展开 */}
              <div
                className={cn(
                  "group flex w-full items-center gap-0.5 rounded-md pr-1.5 text-sm transition-colors hover:bg-accent",
                  notebookFilter === "none" && "bg-accent text-accent-foreground"
                )}
                title="不属于任何笔记本的笔记"
              >
                {uncategorizedNotes.length > 0 ? (
                  <button
                    type="button"
                    aria-label={expandedSet.has("none") ? "收起未分类" : "展开未分类"}
                    onClick={() => toggleTreeExpandedId("none")}
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded hover:bg-background"
                  >
                    <ChevronRight
                      className={cn(
                        "h-3.5 w-3.5 text-muted-foreground transition-transform",
                        expandedSet.has("none") && "rotate-90"
                      )}
                    />
                  </button>
                ) : (
                  <span aria-hidden className="w-5 shrink-0" />
                )}
                <button
                  type="button"
                  onClick={() => {
                    if (uncategorizedNotes.length > 0)
                      toggleTreeExpandedId("none");
                    selectNotebook("none");
                  }}
                  className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left"
                >
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full border border-dashed border-muted-foreground" />
                  <span className="truncate">未分类</span>
                  <span className="ml-auto shrink-0 pl-2 text-xs text-muted-foreground">
                    {counts.uncategorized}
                  </span>
                </button>
                <span aria-hidden className="w-6 shrink-0" />
              </div>
              {expandedSet.has("none") && (
                <TreeNoteRows
                  notes={uncategorizedNotes}
                  depth={0}
                  actions={actions}
                />
              )}
            </div>
          </>
        )}

        {/* 标签 */}
        {tags.length > 0 && (
          <div className="mt-4">
            <div className="mb-1 flex items-center gap-1 px-2 text-xs font-medium text-muted-foreground">
              <TagIcon className="h-3 w-3" />
              标签
            </div>
            <div className="flex flex-wrap gap-1.5 px-2">
              {tags.map((tag) => (
                <button
                  key={tag.name}
                  type="button"
                  onClick={() => setTagFilter(tagFilter === tag.name ? null : tag.name)}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors hover:bg-accent",
                    tagFilter === tag.name
                      ? "border-primary bg-primary text-primary-foreground"
                      : "text-muted-foreground"
                  )}
                >
                  {tag.name}
                  <span className="opacity-70">{tag.count}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <NotebookDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editingId={editingId}
        initialName={
          editingId ? notebooks.find((n) => n.id === editingId)?.name ?? "" : ""
        }
        initialColor={
          editingId
            ? notebooks.find((n) => n.id === editingId)?.color ??
              NOTEBOOK_COLORS[0]
            : NOTEBOOK_COLORS[0]
        }
        initialParentId={
          editingId
            ? notebooks.find((n) => n.id === editingId)?.parentId ?? null
            : null
        }
      />

      <ConfirmDialog
        open={pendingDeleteNote !== null}
        title="删除这篇笔记？"
        description={`「${pendingDeleteNote?.title ?? ""}」将被永久删除，此操作无法撤销。`}
        confirmLabel="删除"
        onConfirm={confirmDeleteNote}
        onCancel={() => setPendingDeleteNote(null)}
      />

      <AlertDialog
        open={deleteId !== null}
        onOpenChange={(o) => !o && setDeleteId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除笔记本？</AlertDialogTitle>
            <AlertDialogDescription>
              笔记本将被删除，其中的笔记会保留并移动到「全部笔记」。此操作无法撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={confirmDeleteNotebook}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
