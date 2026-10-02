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
  ChevronLeft,
  ChevronRight,
  FileText,
  Folder,
  FolderPlus,
  History,
  MoreHorizontal,
  Pencil,
  Pin,
  Plus,
  RotateCcw,
  Tag as TagIcon,
  Trash2,
} from "lucide-react";
import type { Notebook, NotebookFilter } from "@quickwiki/shared";
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
import { useNotesIndex, useNotebooks, useTags } from "@/hooks/use-data";
import { useNoteActions } from "@/hooks/use-note-actions";
import { useUIStore } from "@/stores/use-ui-store";
import { notebookRepo } from "@/lib/data/repository";
import type { NoteIndexItem } from "@/lib/data/repository";
import { notebookAncestors } from "@/lib/data/notebook-tree";

/** 每个展开节点初始渲染的笔记行数，滚到底自动追加 */
const TREE_PAGE_SIZE = 50;
/** 树最左起始内边距（根级条目共用，左边缘对齐） */
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
          className="pointer-events-none absolute inset-y-0 w-px bg-border"
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
  /** 恢复该容器的默认顺序（置顶 + 创建时间升序，早创建的在前） */
  onResetOrder: (notebookId: string | null) => void;
  /** 已按下、等待进入拖动的笔记（按压反馈） */
  pressedId: string | null;
  /** 正在被拖的笔记 id 与当前落点（用于「拿起」样式与插入指示线） */
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
  const pressed = actions.pressedId === note.id;
  const rowRef = useRef<HTMLDivElement | null>(null);

  // 打开笔记后把该行滚进侧栏视野：长列表下「你在哪」不用翻找
  useEffect(() => {
    if (active) rowRef.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <div
      ref={rowRef}
      {...(sortable ? noteRowDragProps(note, index) : {})}
      onPointerDown={sortable ? (e) => actions.onDragStart(e, note) : undefined}
      className={cn(
        "tree-row group relative flex h-8 w-full items-center rounded-md pr-1.5 text-[13px] transition-colors hover:bg-accent/50 [-webkit-touch-callout:none]",
        active && "bg-accent/60 font-medium",
        // 已按下（鼠标等位移 / 触摸等长按）：先给一层按压反馈，
        // 让人知道「按住生效了」，不用猜什么时候可以拖
        pressed && !dragging && "bg-accent/70 ring-1 ring-primary/30",
        // 拿起中：明显区别于按住态，配合插入指示线表示「现在松手即落位」
        dragging && "bg-accent opacity-70 shadow-md ring-2 ring-primary/50"
      )}
      style={{ paddingLeft: indentOf(depth) }}
    >
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-y-1.5 left-0 w-[3px] rounded-r-full bg-primary transition-opacity",
          active ? "opacity-100" : "opacity-0"
        )}
      />
      <TreeGuides levels={depth} />
      <button
        type="button"
        onClick={() => actions.onOpenNote(note.id)}
        className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden text-left"
        title={note.title}
      >
        {/* 置顶小标常显：排序本就把置顶排最前，图标是它唯一的可辨识标记，
            隐藏会造成「平时不显示但占位」的幻影缩进。
            琥珀色与选中态的主色分离，扫视时不会误读为「当前打开」 */}
        {note.pinned && (
          <Pin
            className="h-3 w-3 shrink-0 fill-amber-500 text-amber-500 dark:fill-amber-400 dark:text-amber-400"
            aria-hidden
          />
        )}
        {/* 笔记类型图标：与笔记本行的「色点」成对——色点 = 容器，文件图标 = 笔记。
            嵌套较深时只靠缩进分不清两类条目（2026-09-19 用户反馈） */}
        <FileText
          aria-hidden
          className={cn(
            "h-3.5 w-3.5 shrink-0",
            active ? "text-primary" : "text-muted-foreground/70"
          )}
        />
        <span className={cn("truncate", !active && "text-foreground/90")}>
          {note.title}
        </span>
        <span
          className={cn(
            "ml-auto hidden shrink-0 pl-2 text-[11px] text-muted-foreground/80 md:inline",
            !active && "hover-hide"
          )}
        >
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
            className="hover-hide flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-background hover:text-foreground"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => actions.onTogglePin(note.id, note.pinned)}>
            <Pin
              className={cn(
                "mr-2 h-4 w-4",
                note.pinned &&
                  "fill-amber-500 text-amber-500 dark:fill-amber-400 dark:text-amber-400"
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
  actions,
}: {
  notes: NoteIndexItem[];
  depth: number;
  /** 该块所属容器（null = 未分类）：落点匹配与手动顺序判定都依赖它 */
  notebookId: string | null;
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

  // 该容器已手动排序过 → 菜单里出现「恢复默认顺序」
  const manualOrder = notes.some((n) => n.sortOrder != null);
  const containerKey = notebookId ?? "";
  const dropIndex =
    actions.dropTarget?.containerKey === containerKey
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
            canMoveUp={i > 0}
            canMoveDown={i < notes.length - 1}
            manualOrder={manualOrder}
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
  /** 折叠箭头：就地展开/收起（偷看子级内容，不切换位置） */
  onToggle: (id: string) => void;
  /** 点笔记本名：切换作用域（左侧树重新以它为根） */
  onSelect: (id: NotebookFilter) => void;
  /** 在该笔记本下新建笔记（同时把作用域切过去，新建后回来就是它） */
  onCreateNote: (id: string) => void;
  /** 在该笔记本下新建子笔记本（当作文件夹分组） */
  onCreateChild: (id: string) => void;
  onRename: (id: string) => void;
  onRequestDelete: (id: string) => void;
  actions: NoteRowActions;
}

/** 笔记本行的「⋯」操作菜单（作用域树与启动页列表共用） */
function NotebookMenu({
  notebook,
  onCreateNote,
  onCreateChild,
  onRename,
  onRequestDelete,
}: {
  notebook: Notebook;
  onCreateNote: (id: string) => void;
  onCreateChild: (id: string) => void;
  onRename: (id: string) => void;
  onRequestDelete: (id: string) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`笔记本 ${notebook.name} 操作`}
          title={`笔记本「${notebook.name}」：新建笔记 / 重命名 / 删除`}
          className="hover-hide flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-background hover:text-foreground"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => onCreateNote(notebook.id)}>
          <Plus className="mr-2 h-4 w-4" />
          新建笔记
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onCreateChild(notebook.id)}>
          <FolderPlus className="mr-2 h-4 w-4" />
          新建子笔记本
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
  );
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
    onCreateChild,
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
          "tree-row group relative flex h-8 w-full items-center gap-0.5 rounded-md pr-1.5 text-[13px] transition-colors hover:bg-accent/50",
          selected && "bg-accent/60"
        )}
        style={{ paddingLeft: indentOf(depth) }}
        // 拖笔记到这个笔记本行上 = 移入该笔记本（置于最前）
        data-note-drop-container={notebook.id}
      >
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-y-1.5 left-0 w-[3px] rounded-r-full bg-primary transition-opacity",
            selected ? "opacity-100" : "opacity-0"
          )}
        />
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
          onClick={() => onSelect(notebook.id)}
          className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden text-left"
          title={`进入「${notebook.name}」`}
        >
          <span
            className="h-2 w-2 shrink-0 rounded-full ring-1 ring-inset ring-black/10 dark:ring-white/15"
            style={{ backgroundColor: notebook.color }}
          />
          {/* 笔记本名加粗一档：与笔记行的常规字重区分，形成「文件夹 / 文件」的层级感 */}
          <span className="truncate font-medium">{notebook.name}</span>
          {/* 角标与展开后的笔记列表同源（都来自 childNotes），
              不会再出现「数字与条目数对不上」或新增后不跳动 */}
          <span className="ml-auto shrink-0 pl-2 text-[11px] text-muted-foreground/70">
            {childNotes.length}
          </span>
        </button>
        <NotebookMenu
          notebook={notebook}
          onCreateNote={onCreateNote}
          onCreateChild={onCreateChild}
          onRename={onRename}
          onRequestDelete={onRequestDelete}
        />
      </div>
      {expanded && (
        <div className="pb-1">
          {/* 两类条目并存时才加小标题：只靠缩进时，「子笔记本」与「本层的笔记」
              看起来是同一类东西，一片条目扫下来没有分组感（2026-09-19） */}
          {childNotebooks.length > 0 && childNotes.length > 0 && (
            <div
              className="mb-0.5 flex items-center gap-1 text-[11px] text-muted-foreground/70"
              style={{ paddingLeft: indentOf(depth + 1) }}
            >
              <Folder aria-hidden className="h-3 w-3" />
              子笔记本
            </div>
          )}
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
                // 同时有子笔记本与笔记时：分隔线与小标题一起，把「笔记本块」
                // 与「本层的笔记」明确切开，而不是两类条目连成一片
                childNotes.length > 0 &&
                  childNotebooks.length > 0 &&
                  "mt-2 border-t border-border/60 pt-1.5"
              )}
              style={
                childNotes.length > 0 && childNotebooks.length > 0
                  ? { marginLeft: indentOf(depth + 1) }
                  : undefined
              }
            >
              {childNotes.length > 0 && childNotebooks.length > 0 && (
                <div className="mb-0.5 flex items-center gap-1 text-[11px] text-muted-foreground/70">
                  <FileText aria-hidden className="h-3 w-3" />
                  笔记
                </div>
              )}
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
 * 启动页态的笔记本行：色点 + 名称 + 直属笔记数 + 操作菜单。
 * 点击即进入该笔记本（切换作用域），不展开笔记行——
 * 全部笔记的浏览交给启动页主区的卡片网格，这里只做轻量索引。
 */
function NotebookListRow({
  notebook,
  noteCount,
  bundle,
}: {
  notebook: Notebook;
  noteCount: number;
  bundle: TreeBundle;
}) {
  return (
    <div
      className="tree-row group relative flex h-8 w-full items-center rounded-md pr-1.5 text-[13px] transition-colors hover:bg-accent/50"
      style={{ paddingLeft: indentOf(0) }}
    >
      <button
        type="button"
        onClick={() => bundle.onSelect(notebook.id)}
        className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden text-left"
        title={`进入「${notebook.name}」`}
      >
        <span
          className="h-2 w-2 shrink-0 rounded-full ring-1 ring-inset ring-black/10 dark:ring-white/15"
          style={{ backgroundColor: notebook.color }}
        />
        <span className="truncate font-medium">{notebook.name}</span>
        <span className="ml-auto shrink-0 pl-2 text-[11px] text-muted-foreground/70">
          {noteCount}
        </span>
      </button>
      <NotebookMenu
        notebook={notebook}
        onCreateNote={bundle.onCreateNote}
        onCreateChild={bundle.onCreateChild}
        onRename={bundle.onRename}
        onRequestDelete={bundle.onRequestDelete}
      />
    </div>
  );
}

/** 启动页态的「最近编辑」行：标题 + 归属 + 相对时间，点击直达 */
function RecentNoteRow({
  note,
  notebookName,
  onOpen,
}: {
  note: NoteIndexItem;
  notebookName: string;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="tree-row flex h-8 w-full items-center gap-1.5 rounded-md pr-1.5 text-[13px] transition-colors hover:bg-accent/50"
      title={note.title}
    >
      <FileText
        aria-hidden
        className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70"
      />
      <span className="min-w-0 flex-1 truncate text-left text-foreground/90">
        {note.title}
      </span>
      <span className="hidden max-w-20 shrink-0 truncate text-[11px] text-muted-foreground/70 lg:inline">
        {notebookName}
      </span>
      <span className="shrink-0 pl-2 text-[11px] text-muted-foreground/80">
        {formatDistanceToNowStrict(note.updatedAt, {
          locale: zhCN,
          addSuffix: true,
        })}
      </span>
    </button>
  );
}

/**
 * 侧边栏（作用域模型）：
 * - 启动页态（未进入任何笔记本）：新建笔记本 + 顶层笔记本索引 + 最近编辑；
 * - 作用域态（已进入某笔记本 / 未分类）：面包屑（‹ 全部笔记本 / 父 / 当前）
 *   + 该笔记本的子笔记本与直属笔记树 + 底部标签筛选。
 * 桌面端常驻左栏；移动端复用于抽屉。
 */
export function SidebarContent() {
  const router = useRouter();
  const { notebooks, loading: notebooksLoading } = useNotebooks();
  const { tags } = useTags();
  const { items: noteIndex, loading: indexLoading } = useNotesIndex();
  const notebookFilter = useUIStore((s) => s.notebookFilter);
  const tagFilter = useUIStore((s) => s.tagFilter);
  const setNotebookFilter = useUIStore((s) => s.setNotebookFilter);
  const setTagFilter = useUIStore((s) => s.setTagFilter);
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen);
  const openNote = useUIStore((s) => s.openNote);
  const activeNoteId = useUIStore((s) => s.activeNoteId);
  const treeExpandedIds = useUIStore((s) => s.treeExpandedIds);
  const toggleTreeExpandedId = useUIStore((s) => s.toggleTreeExpandedId);

  const {
    createNote,
    deleteNote,
    togglePin,
    moveNote,
    moveNoteToPosition,
    resetOrder,
  } = useNoteActions();
  // 拖拽：落点提交为「放到目标容器第 n 位」（跨容器即同时改分类）
  const { draggingId, pressedId, dropTarget, startDrag } = useNoteDrag(
    (id, notebookId, index) => void moveNoteToPosition(id, notebookId, index)
  );

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  /** 新建子笔记本时预设的父级（null = 顶层新建） */
  const [newChildOf, setNewChildOf] = useState<string | null>(null);
  /** 对话框「创建」成功后是否切入新笔记本：仅启动页顶部「新建笔记本」为 true，
      菜单里的「新建子笔记本」创建后仍留在当前作用域 */
  const enterAfterCreateRef = useRef(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [pendingDeleteNote, setPendingDeleteNote] =
    useState<NoteIndexItem | null>(null);

  const expandedSet = useMemo(
    () => new Set(treeExpandedIds),
    [treeExpandedIds]
  );

  // 标签过滤叠加在作用域树上（与主区列表行为一致）
  const filteredIndex = useMemo(
    () =>
      tagFilter
        ? noteIndex.filter((n) => n.tags.includes(tagFilter))
        : noteIndex,
    [noteIndex, tagFilter]
  );

  // 按笔记本分组；索引本身已按「置顶优先 + 创建时间升序」排好，分组保持顺序。
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

  /** 当前作用域的笔记本对象（"none" 或找不到 id 时为 null） */
  const currentNotebook =
    notebookFilter && notebookFilter !== "none"
      ? notebooks.find((nb) => nb.id === notebookFilter) ?? null
      : null;
  /**
   * 作用域态判定。filter 指向已不存在的笔记本（远端删除先到、清理 effect
   * 还没跑）时按启动页态渲染，避免面包屑短暂显示错误的「未分类」。
   */
  const scoped =
    notebookFilter !== null &&
    (notebookFilter === "none" || currentNotebook !== null);
  /** 根 → 当前的祖先链（含当前），用于面包屑逐级返回 */
  const scopeChain = useMemo(
    () =>
      currentNotebook
        ? notebookAncestors(notebooks, currentNotebook.id)
        : [],
    [notebooks, currentNotebook]
  );

  /** 作用域树的子笔记本与直属笔记 */
  const scopedChildren = currentNotebook
    ? childNotebooksOf.get(currentNotebook.id) ?? []
    : [];
  const scopedNotes = currentNotebook
    ? notesByNotebook.get(currentNotebook.id) ?? []
    : notebookFilter === "none"
      ? uncategorizedNotes
      : [];

  /** 启动页态：最近编辑（noteIndex 已含全部笔记的轻量索引） */
  const recentNotes = useMemo(
    () =>
      [...noteIndex].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 8),
    [noteIndex]
  );
  const notebookNameById = useMemo(
    () => new Map(notebooks.map((nb) => [nb.id, nb.name])),
    [notebooks]
  );

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

  /** 切换作用域：进入某个笔记本（或未分类）。
   *  作用域模型下没有「再点一次取消选中」——回全局统一走面包屑的「‹ 全部笔记本」。 */
  const goScope = (id: NotebookFilter) => {
    setNotebookFilter(id);
    goNotes();
  };

  /** 面包屑返回：清空位置与打开的笔记（EditorPane 卸载时会 flush 未落盘内容），回启动页 */
  const backToLauncher = () => {
    setNotebookFilter(null);
    openNote(null);
    goNotes();
  };

  /** 打开最近编辑的笔记：位置跟随它所属的笔记本（与搜索跳转同规则） */
  const openRecentNote = (note: NoteIndexItem) => {
    openNote(note.id);
    setNotebookFilter(note.notebookId ?? "none");
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
    pressedId,
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
    onSelect: goScope,
    // 在哪个笔记本新建，就把作用域切过去：新建后按返回键看到的就是它的列表
    onCreateNote: (id) => {
      setNotebookFilter(id);
      void createNote({ notebookId: id });
      goNotes();
    },
    onCreateChild: (id) => {
      // 以该笔记本为父级打开新建对话框（父级已预填，写个名字即可）
      enterAfterCreateRef.current = false;
      setEditingId(null);
      setNewChildOf(id);
      setDialogOpen(true);
    },
    onRename: (id) => {
      setEditingId(id);
      setNewChildOf(null);
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

      {scoped ? (
        <>
          {/* 面包屑：全局逃生舱 + 当前位置路径链（祖先可点，逐级返回） */}
          <div className="shrink-0 border-b px-3 py-2">
            <button
              type="button"
              onClick={backToLauncher}
              className="-ml-1 flex items-center gap-0.5 rounded px-1 py-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
              aria-label="回到全部笔记本"
              title="回到全部笔记本（启动页）"
            >
              <ChevronLeft aria-hidden className="h-3.5 w-3.5" />
              全部笔记本
            </button>
            <div className="mt-0.5 flex items-center gap-1 px-0.5 text-sm">
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1 gap-y-0.5">
                {scopeChain.slice(0, -1).map((nb) => (
                  <Fragment key={nb.id}>
                    <button
                      type="button"
                      onClick={() => goScope(nb.id)}
                      title={`进入「${nb.name}」`}
                      className="max-w-24 truncate text-muted-foreground transition-colors hover:text-foreground hover:underline"
                    >
                      {nb.name}
                    </button>
                    <ChevronRight
                      aria-hidden
                      className="h-3 w-3 shrink-0 text-muted-foreground/50"
                    />
                  </Fragment>
                ))}
                <span className="flex min-w-0 items-center gap-1.5 font-semibold">
                  <span
                    aria-hidden
                    className={cn(
                      "h-2 w-2 shrink-0 rounded-full",
                      !currentNotebook &&
                        "border border-dashed border-muted-foreground"
                    )}
                    style={
                      currentNotebook
                        ? { backgroundColor: currentNotebook.color }
                        : undefined
                    }
                  />
                  <span className="truncate">
                    {currentNotebook ? currentNotebook.name : "未分类"}
                  </span>
                </span>
              </div>
              {/* 当前笔记本的操作：作用域树里不渲染它的行，入口收在面包屑右侧
                  （未分类是虚拟位置，无菜单） */}
              {currentNotebook && (
                <NotebookMenu
                  notebook={currentNotebook}
                  onCreateNote={bundle.onCreateNote}
                  onCreateChild={bundle.onCreateChild}
                  onRename={bundle.onRename}
                  onRequestDelete={bundle.onRequestDelete}
                />
              )}
            </div>
          </div>

          {/* 当前作用域内新建笔记（落点=当前笔记本，肉眼可见） */}
          <div className="shrink-0 px-3 pt-3">
            <Button
              size="sm"
              className="w-full justify-start gap-2"
              onClick={() => {
                void createNote();
                goNotes();
              }}
            >
              <Plus className="h-4 w-4" />
              新建笔记
            </Button>
          </div>

          {/* 作用域树：当前笔记本的子笔记本 + 直属笔记 */}
          <div
            className="min-h-0 flex-1 overflow-y-auto p-3"
            data-note-drag-scroll
          >
            {indexLoading && (
              <div className="space-y-2 p-1">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-6 w-full" />
                ))}
              </div>
            )}
            {!indexLoading && scopedChildren.length === 0 && scopedNotes.length === 0 && (
              <div className="px-2 py-1 text-xs text-muted-foreground">
                {tagFilter ? "该笔记本下没有打过此标签的笔记" : "暂无笔记"}
              </div>
            )}
            {/* 子笔记本块：点名称进入（切换作用域），点箭头就地展开偷看 */}
            {scopedChildren.length > 0 && scopedNotes.length > 0 && (
              <div
                className="mb-0.5 flex items-center gap-1 text-[11px] text-muted-foreground/70"
                style={{ paddingLeft: indentOf(0) }}
              >
                <Folder aria-hidden className="h-3 w-3" />
                子笔记本
              </div>
            )}
            {scopedChildren.map((child) => (
              <NotebookNode
                key={child.id}
                notebook={child}
                depth={0}
                bundle={bundle}
              />
            ))}
            {/* 直属笔记块：与子笔记本并存时加小标题 + 分隔线 */}
            {scopedNotes.length > 0 && scopedChildren.length > 0 && (
              <div
                className="mb-0.5 mt-2 flex items-center gap-1 border-t border-border/60 pt-1.5 text-[11px] text-muted-foreground/70"
                style={{ paddingLeft: indentOf(0) }}
              >
                <FileText aria-hidden className="h-3 w-3" />
                笔记
              </div>
            )}
            {scopedNotes.length > 0 && (
              <TreeNoteRows
                notes={scopedNotes}
                depth={0}
                notebookId={currentNotebook?.id ?? null}
                actions={actions}
              />
            )}
          </div>

          {/* 标签：作用域内的叠加筛选。固定底部（自带滚动），不被长树推出视口 */}
          {tags.length > 0 && (
            <div className="max-h-40 shrink-0 overflow-y-auto border-t px-3 py-2">
              <div className="mb-1 flex items-center gap-1 text-xs font-medium text-muted-foreground">
                <TagIcon className="h-3 w-3" />
                标签
              </div>
              <div className="flex flex-wrap gap-1.5">
                {tags.map((tag) => (
                  <button
                    key={tag.name}
                    type="button"
                    onClick={() =>
                      setTagFilter(tagFilter === tag.name ? null : tag.name)
                    }
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
        </>
      ) : (
        <>
          {/* 启动页态：新建笔记本 */}
          <div className="shrink-0 px-3 pt-3">
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start gap-2"
              onClick={() => {
                enterAfterCreateRef.current = true;
                setEditingId(null);
                setNewChildOf(null);
                setDialogOpen(true);
              }}
            >
              <Plus className="h-4 w-4" />
              新建笔记本
            </Button>
          </div>

          {/* 顶层笔记本索引 + 最近编辑 */}
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <div className="mb-1 px-2">
              <span className="text-xs font-medium text-muted-foreground">
                笔记本
              </span>
            </div>
            {indexLoading && (
              <div className="space-y-2 p-1">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-6 w-full" />
                ))}
              </div>
            )}
            {!indexLoading &&
              !notebooksLoading &&
              rootNotebooks.length === 0 &&
              uncategorizedNotes.length === 0 && (
                <div className="px-2 py-1 text-xs text-muted-foreground">
                  还没有笔记本，点上方按钮创建一个
                </div>
              )}
            {rootNotebooks.map((nb) => (
              <NotebookListRow
                key={nb.id}
                notebook={nb}
                noteCount={notesByNotebook.get(nb.id)?.length ?? 0}
                bundle={bundle}
              />
            ))}
            {/* 未分类：不属于任何笔记本的笔记（有内容才出现，避免空行噪音） */}
            {uncategorizedNotes.length > 0 && (
              <div
                className="tree-row group relative flex h-8 w-full items-center rounded-md pr-1.5 text-[13px] transition-colors hover:bg-accent/50"
                style={{ paddingLeft: indentOf(0) }}
                title="不属于任何笔记本的笔记"
              >
                <button
                  type="button"
                  onClick={() => goScope("none")}
                  className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden text-left"
                >
                  <span
                    aria-hidden
                    className="h-2 w-2 shrink-0 rounded-full border border-dashed border-muted-foreground"
                  />
                  <span className="truncate font-medium">未分类</span>
                  <span className="ml-auto shrink-0 pl-2 text-[11px] text-muted-foreground/70">
                    {uncategorizedNotes.length}
                  </span>
                </button>
                <span aria-hidden className="w-6 shrink-0" />
              </div>
            )}

            {/* 最近编辑：启动页侧栏的主要内容（主区是笔记本卡片网格） */}
            {!indexLoading && recentNotes.length > 0 && (
              <div className="mt-4">
                <div className="mb-1 flex items-center gap-1 px-2 text-xs font-medium text-muted-foreground">
                  <History className="h-3 w-3" />
                  最近编辑
                </div>
                {recentNotes.map((note) => (
                  <RecentNoteRow
                    key={note.id}
                    note={note}
                    notebookName={
                      note.notebookId
                        ? notebookNameById.get(note.notebookId) ?? ""
                        : "未分类"
                    }
                    onOpen={() => openRecentNote(note)}
                  />
                ))}
              </div>
            )}
          </div>
        </>
      )}

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
            : newChildOf
        }
        onCreated={(id) => {
          if (enterAfterCreateRef.current) goScope(id);
        }}
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
              笔记本将被删除，其中的笔记会保留并移到「未分类」。此操作无法撤销。
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
