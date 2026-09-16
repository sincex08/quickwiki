"use client";

import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useRouter } from "next/navigation";
import { formatDistanceToNowStrict } from "date-fns";
import { zhCN } from "date-fns/locale";
import {
  ArrowDown,
  ArrowUp,
  Book,
  ChevronRight,
  FileText,
  MoreHorizontal,
  Pencil,
  Pin,
  Plus,
  RotateCcw,
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
  noteRowDragProps,
  useNoteDrag,
  type DropTarget,
} from "@/components/layout/use-note-drag";
import {
  useNotebooks,
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
/** 树最左起始内边距（根级「全部笔记 / 未分类 / 顶层笔记本」共用，左边缘对齐） */
const TREE_PAD = 6;
/** 每层缩进（px）：拉开层级差，让「笔记本 / 子笔记本 / 笔记」一眼可辨 */
const DEPTH_INDENT = 18;
/** 某一层的内容起点 */
const indentOf = (level: number) => TREE_PAD + level * DEPTH_INDENT;
/** 某一层引导线的 x：压在折叠箭头（h-5 w-5）的中心线上 */
const guideX = (level: number) => indentOf(level) + 10;

/**
 * 层级引导线：为每一层祖先画一条细竖线，连续贯穿整棵子树。
 * 只靠缩进时，深层条目容易被看成同级；竖线让「这条挂在谁下面」不用数像素。
 */
function TreeGuides({ levels }: { levels: number }) {
  if (levels <= 0) return null;
  return (
    <>
      {Array.from({ length: levels }, (_, level) => (
        <span
          key={level}
          aria-hidden
          className="pointer-events-none absolute inset-y-0 w-px bg-muted-foreground/30"
          style={{ left: guideX(level) - 0.5 }}
        />
      ))}
    </>
  );
}

/** 笔记行共用的回调（由 SidebarContent 统一提供） */
interface NoteRowActions {
  activeNoteId: string | null;
  onOpenNote: (id: string) => void;
  onTogglePin: (id: string, pinned: boolean) => void;
  onDeleteNote: (note: NoteIndexItem) => void;
  /** 上移 / 下移一位（菜单微调；手机与键盘用户的主路径） */
  onMoveNote: (id: string, direction: -1 | 1) => void;
  /** 恢复该容器的默认顺序（置顶 + 更新时间倒序） */
  onResetOrder: (notebookId: string | null) => void;
  /** 拖拽：正在被拖的笔记 id 与当前落点（用于半透明与插入指示线） */
  draggingId: string | null;
  dropTarget: DropTarget | null;
  onDragStart: (
    e: ReactPointerEvent<HTMLElement>,
    note: NoteIndexItem
  ) => void;
}

/**
 * 树内笔记行：图标 + 标题 + 相对时间 + 悬浮操作。
 *
 * 顺序调整有三条路径，都落在这行上：
 * - 桌面：按住行主体拖动（useNoteDrag，落点由 data-* 属性描述）
 * - 菜单「上移 / 下移」：手机与键盘用户的主路径
 * - 菜单「恢复默认顺序」：仅在该容器已手动排序过时出现
 */
function NoteRow({
  note,
  depth,
  index = 0,
  canMoveUp = false,
  canMoveDown = false,
  manualOrder = false,
  sortable = true,
  actions,
}: {
  note: NoteIndexItem;
  depth: number;
  /** 该笔记在其容器内的下标（拖拽落点计算用） */
  index?: number;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  /** 所在容器是否已进入手动顺序（决定是否显示「恢复默认顺序」） */
  manualOrder?: boolean;
  /**
   * 是否可调顺序。混合视图（「全部笔记」展开后的列表）里没有「容器内第 n 位」
   * 这个概念，拖拽与上移下移都会落到错误的容器位置，故整体关闭。
   */
  sortable?: boolean;
  actions: NoteRowActions;
}) {
  const active = note.id === actions.activeNoteId;
  const dragging = actions.draggingId === note.id;
  return (
    <div
      {...(sortable ? noteRowDragProps(note, index) : {})}
      onPointerDown={sortable ? (e) => actions.onDragStart(e, note) : undefined}
      className={cn(
        "group relative flex w-full items-center rounded-md pr-1.5 text-sm transition-colors hover:bg-accent [-webkit-touch-callout:none]",
        active && "bg-accent text-accent-foreground",
        dragging && "opacity-40"
      )}
      style={{ paddingLeft: indentOf(depth) }}
    >
      <TreeGuides levels={depth} />
      <button
        type="button"
        onClick={() => actions.onOpenNote(note.id)}
        className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden py-1.5 text-left"
        title={note.title}
      >
        {/* 小文件图标：与笔记本的色点区分「这一行是笔记」，也让笔记块自成一段 */}
        <FileText
          className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70"
          aria-hidden
        />
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
            data-no-drag
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
            disabled={!canMoveUp}
            onClick={() => actions.onMoveNote(note.id, -1)}
          >
            <ArrowUp className="mr-2 h-4 w-4" />
            上移
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!canMoveDown}
            onClick={() => actions.onMoveNote(note.id, 1)}
          >
            <ArrowDown className="mr-2 h-4 w-4" />
            下移
          </DropdownMenuItem>
          {manualOrder && (
            <DropdownMenuItem
              onClick={() => actions.onResetOrder(note.notebookId ?? null)}
            >
              <RotateCcw className="mr-2 h-4 w-4" />
              恢复默认顺序
            </DropdownMenuItem>
          )}
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

/** 某节点下的笔记行列表：分页渲染 + 滚动到底自动加载 + 拖拽落点指示线 */
function TreeNoteRows({
  notes,
  depth,
  notebookId,
  mixed = false,
  actions,
}: {
  notes: NoteIndexItem[];
  depth: number;
  /** 该块所属容器（null = 未分类）：落点匹配与手动顺序判定都依赖它 */
  notebookId: string | null;
  /** 混合视图（跨容器的「全部笔记」列表）：关闭全部顺序调整入口 */
  mixed?: boolean;
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

  // 该容器已手动排序过 → 菜单里出现「恢复默认顺序」（混合视图不提供）
  const sortable = !mixed;
  const manualOrder = sortable && notes.some((n) => n.sortOrder != null);
  const containerKey = notebookId ?? "";
  const dropIndex =
    sortable && actions.dropTarget?.containerKey === containerKey
      ? actions.dropTarget.index
      : -1;

  /** 插入指示线：画在拖拽目标位置上（与笔记行同缩进） */
  const dropLine = (i: number) =>
    i === dropIndex ? (
      <div
        aria-hidden
        className="my-0.5 h-0.5 rounded-full bg-primary"
        style={{ marginLeft: indentOf(depth + 1) + 4 }}
      />
    ) : null;

  if (notes.length === 0) {
    return (
      <>
        {dropLine(0)}
        <div
          className="py-1 pr-2 text-xs text-muted-foreground"
          style={{ paddingLeft: indentOf(depth + 1) }}
        >
          暂无笔记
        </div>
      </>
    );
  }

  return (
    <div>
      {visible.map((n, i) => (
        <Fragment key={n.id}>
          {dropLine(i)}
          <NoteRow
            note={n}
            depth={depth + 1}
            index={i}
            canMoveUp={sortable && i > 0}
            canMoveDown={sortable && i < notes.length - 1}
            manualOrder={manualOrder}
            sortable={sortable}
            actions={actions}
          />
        </Fragment>
      ))}
      {dropLine(visible.length)}
      {hasMore && <div ref={sentinelRef} aria-hidden className="h-1" />}
    </div>
  );
}

/** 笔记本节点递归渲染所需的共享数据与回调 */
interface TreeBundle {
  childNotebooksOf: Map<string | null, Notebook[]>;
  notesByNotebook: Map<string, NoteIndexItem[]>;
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
          "group relative flex w-full items-center gap-0.5 rounded-md pr-1.5 text-sm transition-colors hover:bg-accent",
          selected && "bg-accent text-accent-foreground"
        )}
        style={{ paddingLeft: indentOf(depth) }}
        // 拖笔记到这个笔记本行上 = 移入该笔记本（置于最前）
        data-note-drop-container={notebook.id}
      >
        <TreeGuides levels={depth} />
        {hasChildren ? (
          <button
            type="button"
            aria-label={expanded ? `收起「${notebook.name}」` : `展开「${notebook.name}」`}
            aria-expanded={expanded}
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
          {/* 笔记本名加粗一档：与笔记行的常规字重区分，形成「文件夹 / 文件」的层级感 */}
          <span className="truncate font-medium">{notebook.name}</span>
          {/* 角标与展开后的笔记列表同源（都来自 childNotes），
              不会再出现「数字与条目数对不上」或新增后不跳动 */}
          <span className="ml-auto shrink-0 pl-2 text-xs text-muted-foreground">
            {childNotes.length}
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
        <div className="pb-1">
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
            <div
              className={cn(
                // 同时有子笔记本与笔记时：一条细横线把「笔记本块」与「笔记块」分开，
                // 否则两类条目连成一片，看不出笔记是从这里开始的一组
                childNotes.length > 0 &&
                  childNotebooks.length > 0 &&
                  "mt-1.5 border-t border-border/60 pt-1"
              )}
              style={
                childNotes.length > 0 && childNotebooks.length > 0
                  ? { marginLeft: indentOf(depth + 1) }
                  : undefined
              }
            >
              <TreeNoteRows
                notes={childNotes}
                depth={depth}
                notebookId={notebook.id}
                actions={actions}
              />
            </div>
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

  const {
    createNote,
    deleteNote,
    togglePin,
    moveNote,
    moveNoteToPosition,
    resetOrder,
  } = useNoteActions();
  // 桌面拖拽：落点提交为「放到目标容器第 n 位」（跨容器即同时改分类）
  const { draggingId, dropTarget, startDrag } = useNoteDrag(
    (id, notebookId, index) => void moveNoteToPosition(id, notebookId, index)
  );
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

  // 按笔记本分组；索引本身已按「置顶优先 + 更新时间倒序」排好，分组保持顺序。
  // 节点的笔记角标直接取这些分组数组的长度：角标与树下实际列出的条目
  // 永远同源同帧，不会出现「数字对不上」或新增/删除后不跳动。
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
    onTogglePin: (id, pinned) => void togglePin(id, pinned),
    onDeleteNote: setPendingDeleteNote,
    onMoveNote: (id, direction) => void moveNote(id, direction),
    onResetOrder: (notebookId) => void resetOrder(notebookId),
    draggingId,
    dropTarget,
    onDragStart: startDrag,
  };

  const bundle: TreeBundle = {
    childNotebooksOf,
    notesByNotebook,
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

      {/* 拖拽排序时的滚动容器（useNoteDrag 靠它做靠近边缘自动滚动） */}
      <div
        className="min-h-0 flex-1 overflow-y-auto p-3"
        data-note-drag-scroll
      >
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
                {/* 搜索结果是 Note（缺索引行的 sortOrder），补齐后再复用行组件 */}
                {(searchResults ?? []).map((n) => (
                  <NoteRow
                    key={n.id}
                    note={{ ...n, sortOrder: n.sortOrder ?? null }}
                    depth={0}
                    sortable={false}
                    actions={actions}
                  />
                ))}
              </>
            )}
          </div>
        ) : (
          <>
            {/* ===== 全部笔记（可展开列出全部） ===== */}
            <div
              className={cn(
                "group relative flex w-full items-center gap-0.5 rounded-md pr-1.5 text-sm transition-colors hover:bg-accent",
                notebookFilter === null &&
                  !tagFilter &&
                  "bg-accent text-accent-foreground"
              )}
              style={{ paddingLeft: indentOf(0) }}
            >
              {filteredIndex.length > 0 ? (
                <button
                  type="button"
                  aria-label={treeExpandedAll ? "收起全部笔记" : "展开全部笔记"}
                  aria-expanded={treeExpandedAll}
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
                {/* 角标与树同源：直接取当前树下可见的条数（标签过滤时随之收窄） */}
                <span className="ml-auto shrink-0 pl-2 text-xs text-muted-foreground">
                  {filteredIndex.length}
                </span>
              </button>
              {/* 与笔记本行的操作按钮等宽占位，保证各计数右对齐 */}
              <span aria-hidden className="w-6 shrink-0" />
            </div>
            {treeExpandedAll && (
              <TreeNoteRows
                notes={filteredIndex}
                depth={0}
                notebookId={null}
                mixed
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
                  "group relative flex w-full items-center gap-0.5 rounded-md pr-1.5 text-sm transition-colors hover:bg-accent",
                  notebookFilter === "none" && "bg-accent text-accent-foreground"
                )}
                style={{ paddingLeft: indentOf(0) }}
                title="不属于任何笔记本的笔记"
                // 拖笔记到这里 = 移入未分类（置于最前）
                data-note-drop-container=""
              >
                {uncategorizedNotes.length > 0 ? (
                  <button
                    type="button"
                    aria-label={expandedSet.has("none") ? "收起未分类" : "展开未分类"}
                    aria-expanded={expandedSet.has("none")}
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
                    {uncategorizedNotes.length}
                  </span>
                </button>
                <span aria-hidden className="w-6 shrink-0" />
              </div>
              {expandedSet.has("none") && (
                <TreeNoteRows
                  notes={uncategorizedNotes}
                  depth={0}
                  notebookId={null}
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
