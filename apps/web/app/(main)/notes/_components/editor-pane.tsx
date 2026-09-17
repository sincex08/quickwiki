"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import { zhCN } from "date-fns/locale";
import {
  ArrowLeft,
  BookMarked,
  Check,
  Eye,
  FileCode2,
  Images,
  MoreHorizontal,
  PenLine,
  Pin,
  RefreshCcw,
  Tag,
  Trash2,
} from "lucide-react";
import { AUTOSAVE_DEBOUNCE_MS } from "@quickwiki/shared";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { MiniSwitch } from "@/components/common/mini-switch";
import { LazyEditor, prefetchEditor } from "@/components/editor/lazy-editor";
import { MarkdownSource } from "@/components/editor/markdown-source";
import { HybridPreview } from "@/components/editor/hybrid-preview";
import { TagEditor } from "@/components/notes/tag-editor";
import { AttachmentDrawer } from "@/components/attachments/attachment-drawer";
import { useNote, useNotebooks } from "@/hooks/use-data";
import { useNoteActions } from "@/hooks/use-note-actions";
import { useUIStore, type EditorMode } from "@/stores/use-ui-store";
import { useToastStore } from "@/stores/use-toast-store";
import { noteRepo } from "@/lib/data/repository";
import { releaseAllObjectUrls } from "@/lib/attachments/resolve";
import { cn, debounce, extractTitle } from "@/lib/utils";

/**
 * 编辑区统一水平内边距：头部 / 标题 / 标签 / 正文共用同一条左边缘。
 * 之前正文只有 px-1、标题行 px-3，正文看起来贴边且与标题不对齐。
 */
const PANE_PX = "px-4 md:px-6 lg:px-8";

export function EditorPane() {
  const activeNoteId = useUIStore((s) => s.activeNoteId);
  const openNote = useUIStore((s) => s.openNote);
  const editorMode = useUIStore((s) => s.editorMode);
  const setEditorMode = useUIStore((s) => s.setEditorMode);
  const hybridEditing = useUIStore((s) => s.hybridEditing);
  const setHybridEditing = useUIStore((s) => s.setHybridEditing);
  const { note, loaded } = useNote(activeNoteId);
  const { notebooks } = useNotebooks();
  const { deleteNote, togglePin, moveToNotebook } = useNoteActions();
  const attachmentsDrawerOpen = useUIStore((s) => s.attachmentsDrawerOpen);
  const setAttachmentsDrawerOpen = useUIStore((s) => s.setAttachmentsDrawerOpen);
  const sourceNonce = useUIStore((s) => s.sourceNonce);
  const bumpSourceNonce = useUIStore((s) => s.bumpSourceNonce);

  /** 当前打开的笔记 id 快照：防抖回调执行时校验目标，防止切换后迟到的回调串写 */
  const activeNoteIdRef = useRef<string | null>(activeNoteId);

  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [confirmOpen, setConfirmOpen] = useState(false);
  /** 标签区展开态：无标签时折叠为入口按钮，展开（或已有标签）才渲染编辑行 */
  const [tagsOpen, setTagsOpen] = useState(false);

  // 「已保存」短暂展示后淡出，避免状态文字常驻头部
  useEffect(() => {
    if (saveState !== "saved") return;
    const timer = setTimeout(() => setSaveState("idle"), 2000);
    return () => clearTimeout(timer);
  }, [saveState]);

  // 切换笔记时收起标签编辑区，并同步当前打开的笔记 id（防抖回调据此校验目标）
  useEffect(() => {
    activeNoteIdRef.current = activeNoteId;
    setTagsOpen(false);
  }, [activeNoteId]);

  // 空闲时预热编辑器 chunk：让本次会话首次打开笔记不必等 chunk 下载
  useEffect(() => {
    prefetchEditor();
  }, []);

  const pendingRef = useRef<{ id: string; content: string } | null>(null);
  /**
   * 外部改写正文（附件抽屉追加/移除引用）后的临时内容。
   * note.content 的回读（Dexie 读 + 事件）滞后于写入，而 MarkdownSource
   * 只在挂载时读 value —— 不先接管内容就重挂，源码视图会用旧内容初始化。
   */
  const contentOverrideRef = useRef<string | null>(null);

  // 笔记确认不存在（已删除/无效深链）时自动清除选中，避免移动端白屏且无法返回
  useEffect(() => {
    if (activeNoteId && loaded && !note) {
      openNote(null);
    }
  }, [activeNoteId, loaded, note, openNote]);

  const flushPending = () => {
    if (pendingRef.current) {
      const { id, content } = pendingRef.current;
      pendingRef.current = null;
      noteRepo
        .update(id, { content, title: computeTitle(content) })
        .catch(() => {
          useToastStore.getState().show("保存失败");
        });
    }
  };

  const debouncedSave = useMemo(
    () =>
      debounce((id: string, content: string) => {
        // 防串写：回调携带发起时的 id，若已不是当前打开的笔记则丢弃
        if (id !== activeNoteIdRef.current) return;
        noteRepo
          .update(id, { content, title: computeTitle(content) })
          .then(() => {
            // 落盘完成后才清除暂存：若落盘前清除，事件回读期间 latestContent
            // 会回退到旧值，导致源码视图光标被重置到文末
            if (
              pendingRef.current?.id === id &&
              pendingRef.current?.content === content
            ) {
              pendingRef.current = null;
            }
            setSaveState("saved");
          })
          .catch(() => {
            // 保存失败：提示用户并保持 dirty（pendingRef 不清除），下次编辑自然重试
            useToastStore.getState().show("保存失败");
            setSaveState("idle");
          });
      }, AUTOSAVE_DEBOUNCE_MS),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // 切换笔记或卸载时：立即落盘未保存的内容与标题草稿、回到编辑模式、释放附件 objectURL
  useEffect(() => {
    return () => {
      debouncedSave.cancel();
      flushPending();
      // 标题防抖同样取消并按发起时的 id flush：既不丢失最后一笔，也不等迟到回调
      debouncedTitleSave.cancel();
      flushTitlePending();
      setEditorMode("edit");
      releaseAllObjectUrls();
      contentOverrideRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeNoteId]);

  const handleChange = (markdown: string) => {
    // 写入目标以 note 自身 id 为准，避免 useNote 未跟随时用旧 activeNoteId 串写
    const id = note?.id ?? activeNoteId;
    if (!id) return;
    pendingRef.current = { id, content: markdown };
    latestContentRef.current = markdown;
    setSaveState("saving");
    debouncedSave(id, markdown);
  };

  // ===== 自定义标题 =====
  const titleManualRef = useRef<string | null>(null);
  /** 待落盘的标题草稿（发起时的 id + 输入值）：切换/卸载时 flush，防抖失败时保留 */
  const pendingTitleRef = useRef<{ id: string; value: string } | null>(null);
  const latestContentRef = useRef("");
  const titleFocused = useRef(false);
  const [titleDraft, setTitleDraft] = useState("");

  useEffect(() => {
    titleManualRef.current = note?.titleManual ?? null;
    latestContentRef.current = note?.content ?? "";
  }, [note?.titleManual, note?.content]);

  // 未在编辑标题时跟随笔记标题（自动标题随正文变化）
  useEffect(() => {
    if (!titleFocused.current) setTitleDraft(note?.title ?? "");
  }, [note?.title, note?.id]);

  const computeTitle = (content: string) =>
    titleManualRef.current && titleManualRef.current.trim() !== ""
      ? titleManualRef.current
      : extractTitle(content);

  // 仓库内容追平外部写入后撤销临时覆盖（此后以 note.content 为准）
  useEffect(() => {
    const override = contentOverrideRef.current;
    if (override !== null && note?.content === override) {
      contentOverrideRef.current = null;
    }
  }, [note?.content]);

  /**
   * 外部组件（附件抽屉）改写正文的唯一入口。顺序很重要：
   * 先取消本端待落盘内容（否则防抖回调会用旧内容覆盖外部写入），
   * 再在同一次渲染内接管内容并重挂源码视图（MarkdownSource 只在挂载时读 value），
   * 最后才异步落盘。
   */
  const applyExternalContent = (markdown: string) => {
    const id = note?.id ?? activeNoteId;
    if (!id) return;
    debouncedSave.cancel();
    pendingRef.current = null;
    contentOverrideRef.current = markdown;
    bumpSourceNonce();
    noteRepo
      .update(id, { content: markdown, title: computeTitle(markdown) })
      .catch(() => {
        useToastStore.getState().show("保存失败");
      });
  };

  /**
   * 立即按发起时的 id 落盘标题（防抖回调与切换/卸载 flush 共用）。
   * 成功后才清除 pendingTitleRef；失败时 toast 提示并保持 dirty，下次编辑自然重试。
   */
  const saveTitleNow = (id: string, value: string) => {
    const manual = value.trim() === "" ? null : value;
    titleManualRef.current = manual;
    const title =
      manual !== null ? manual : extractTitle(latestContentRef.current);
    noteRepo
      .update(id, { titleManual: manual, title })
      .then(() => {
        if (
          pendingTitleRef.current?.id === id &&
          pendingTitleRef.current?.value === value
        ) {
          pendingTitleRef.current = null;
        }
        setSaveState("saved");
      })
      .catch(() => {
        useToastStore.getState().show("保存失败");
        setSaveState("idle");
      });
  };

  const debouncedTitleSave = useMemo(
    () =>
      debounce((id: string, value: string) => {
        // 防串写：回调携带发起时的 id，若已不是当前打开的笔记则丢弃
        if (id !== activeNoteIdRef.current) return;
        saveTitleNow(id, value);
      }, AUTOSAVE_DEBOUNCE_MS),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  /** 切换笔记/卸载时落盘标题草稿：flush 而非丢弃（cleanup 中已先 cancel 防抖） */
  const flushTitlePending = () => {
    const pending = pendingTitleRef.current;
    if (!pending) return;
    pendingTitleRef.current = null;
    saveTitleNow(pending.id, pending.value);
  };

  const handleTitleChange = (value: string) => {
    const id = note?.id ?? activeNoteId;
    if (!id) return;
    setTitleDraft(value);
    setSaveState("saving");
    pendingTitleRef.current = { id, value };
    debouncedTitleSave(id, value);
  };

  const resetTitleToAuto = () => {
    const id = note?.id ?? activeNoteId;
    if (!id) return;
    // 先取消待执行的手动标题保存：否则旧回调稍后执行会把手动标题写回
    debouncedTitleSave.cancel();
    pendingTitleRef.current = null;
    titleManualRef.current = null;
    const title = extractTitle(latestContentRef.current);
    setTitleDraft(title);
    noteRepo
      .update(id, { titleManual: null, title })
      .then(() => setSaveState("saved"))
      .catch(() => {
        useToastStore.getState().show("保存失败");
        setSaveState("idle");
      });
  };

  if (!activeNoteId || (loaded && !note)) {
    return (
      <div className="hidden h-full flex-col items-center justify-center gap-2 text-center text-muted-foreground md:flex">
        <PenLine className="h-10 w-10" />
        <p className="text-sm">选择或新建一篇笔记开始写作</p>
      </div>
    );
  }

  if (!note) {
    // 仍在加载中（loaded=false）
    return <div className="h-full" />;
  }

  // 模式切换不丢内容的关键：优先取防抖期内未落盘的最新内容，
  // 其次是外部改写后尚未回读到位的内容
  const latestContent =
    pendingRef.current?.content ?? contentOverrideRef.current ?? note.content;
  const currentNotebook = notebooks.find((n) => n.id === note.notebookId);

  const modeButtons: Array<{
    mode: EditorMode;
    label: string;
    icon: React.ReactNode;
  }> = [
    { mode: "edit", label: "编辑", icon: <PenLine className="h-4 w-4" /> },
    { mode: "source", label: "Markdown 源码", icon: <FileCode2 className="h-4 w-4" /> },
    { mode: "preview", label: "预览", icon: <Eye className="h-4 w-4" /> },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 编辑器头部：移动端仅保留「返回 + 状态 + 主操作」，其余收进「…」菜单 */}
      <div className={cn("flex shrink-0 items-center gap-1.5 border-b py-2 md:gap-2", PANE_PX)}>
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0 md:hidden"
          onClick={() => openNote(null)}
          aria-label="返回列表"
          title="返回列表"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>

        <div className="min-w-0 flex-1 overflow-hidden">
          <div className="flex items-center gap-2 whitespace-nowrap text-xs text-muted-foreground">
            {/* 移动端只显示时间（时:分）；桌面端显示完整日期 */}
            <span className="md:hidden">
              {format(note.updatedAt, "MM-dd HH:mm", { locale: zhCN })}
            </span>
            <span className="hidden md:inline">
              {format(note.updatedAt, "yyyy-MM-dd HH:mm", { locale: zhCN })}
            </span>
            {saveState === "saving" && (
              <span className="shrink-0 text-primary">保存中…</span>
            )}
            {saveState === "saved" && (
              <span className="inline-flex shrink-0 items-center gap-0.5 text-green-600 dark:text-green-400">
                <Check className="h-3 w-3" />
                已保存
              </span>
            )}
          </div>
        </div>

        {/* ===== 移动端：唯一入口「…」，避免按钮过密与状态文字重合 ===== */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0 md:hidden"
              aria-label="更多操作"
              title="更多操作"
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-48">
            <DropdownMenuItem onClick={() => setAttachmentsDrawerOpen(!attachmentsDrawerOpen)}>
              <Images className="mr-2 h-4 w-4" />
              本页附件
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => togglePin(note.id, note.pinned)}>
              <Pin className={note.pinned ? "mr-2 h-4 w-4 fill-primary text-primary" : "mr-2 h-4 w-4"} />
              {note.pinned ? "取消置顶" : "置顶"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
              移动到笔记本
            </DropdownMenuLabel>
            <DropdownMenuItem onClick={() => moveToNotebook(note.id, null)}>
              <span className="mr-1.5 inline-block h-2 w-2 rounded-full border border-dashed border-muted-foreground" />
              未分类
              {note.notebookId == null && (
                <Check className="ml-auto h-3.5 w-3.5" />
              )}
            </DropdownMenuItem>
            {notebooks.map((nb) => (
              <DropdownMenuItem key={nb.id} onClick={() => moveToNotebook(note.id, nb.id)}>
                <span
                  className="mr-1.5 inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: nb.color }}
                />
                {nb.name}
                {note.notebookId === nb.id && (
                  <Check className="ml-auto h-3.5 w-3.5" />
                )}
              </DropdownMenuItem>
            ))}
            {editorMode === "preview" && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuCheckboxItem
                  checked={hybridEditing}
                  onCheckedChange={setHybridEditing}
                >
                  预览点击编辑
                </DropdownMenuCheckboxItem>
              </>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => setConfirmOpen(true)}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              删除笔记
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* ===== 桌面端：内联全部操作 ===== */}
        {/* 移动到笔记本 */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="inline-flex gap-1.5 text-xs"
              title="移动到笔记本"
            >
              <BookMarked className="h-3.5 w-3.5" />
              <span className="hidden max-w-24 truncate lg:inline">
                {currentNotebook?.name ?? "未分类"}
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => moveToNotebook(note.id, null)}>
              <span className="mr-1.5 inline-block h-2 w-2 rounded-full border border-dashed border-muted-foreground" />
              未分类
              {note.notebookId == null && (
                <Check className="ml-auto h-3.5 w-3.5" />
              )}
            </DropdownMenuItem>
            {notebooks.map((nb) => (
              <DropdownMenuItem key={nb.id} onClick={() => moveToNotebook(note.id, nb.id)}>
                <span
                  className="mr-1.5 inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: nb.color }}
                />
                {nb.name}
                {note.notebookId === nb.id && (
                  <Check className="ml-auto h-3.5 w-3.5" />
                )}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* 附件抽屉入口（三模式共享） */}
        <Button
          variant="ghost"
          size="icon"
          className="hidden md:inline-flex"
          onClick={() => setAttachmentsDrawerOpen(!attachmentsDrawerOpen)}
          aria-label="附件"
          title="本页附件"
        >
          <Images className="h-4 w-4" />
        </Button>

        <Button
          variant="ghost"
          size="icon"
          className="hidden md:inline-flex"
          onClick={() => togglePin(note.id, note.pinned)}
          aria-label={note.pinned ? "取消置顶" : "置顶"}
          title={note.pinned ? "取消置顶" : "置顶（列表优先显示）"}
        >
          <Pin className={note.pinned ? "h-4 w-4 fill-primary text-primary" : "h-4 w-4"} />
        </Button>

        {/* 三模式分段控件：编辑 / Markdown 源码 / 预览 */}
        <div className="inline-flex shrink-0 items-center gap-0.5 rounded-md border p-0.5">
          {modeButtons.map(({ mode, label, icon }) => (
            <Button
              key={mode}
              variant="ghost"
              size="icon"
              className={cn(
                "h-8 w-8 lg:h-7 lg:w-7",
                editorMode === mode && "bg-accent text-accent-foreground"
              )}
              onClick={() => setEditorMode(mode)}
              aria-label={label}
              title={label}
            >
              {icon}
            </Button>
          ))}
        </div>

        {/* 动态按钮容器：按当前模式显示上下文相关按钮（仅桌面端） */}
        <div className="hidden items-center gap-1 md:flex">
          {editorMode === "preview" && (
            <>
              <span className="hidden text-xs text-muted-foreground lg:inline">
                点击编辑
              </span>
              <MiniSwitch
                checked={hybridEditing}
                onCheckedChange={setHybridEditing}
                label="预览点击编辑开关"
              />
            </>
          )}
        </div>

        <Button
          variant="ghost"
          size="icon"
          className="hidden text-destructive hover:text-destructive md:inline-flex"
          onClick={() => setConfirmOpen(true)}
          aria-label="删除笔记"
          title="删除笔记"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      {/* 标题行：可编辑；留空回退自动提取 */}
      <div className={cn("flex shrink-0 items-center gap-2 border-b py-1.5", PANE_PX)}>
        <input
          value={titleDraft}
          onChange={(e) => handleTitleChange(e.target.value)}
          onFocus={() => {
            titleFocused.current = true;
          }}
          onBlur={() => {
            titleFocused.current = false;
          }}
          placeholder="无标题"
          aria-label="笔记标题"
          className="min-w-0 flex-1 bg-transparent text-lg font-semibold outline-none placeholder:text-muted-foreground"
        />
        {note.titleManual !== null && (
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0 gap-1 text-xs text-muted-foreground"
            onClick={resetTitleToAuto}
            title="恢复为自动提取标题"
          >
            <RefreshCcw className="h-3 w-3" />
            自动
          </Button>
        )}
      </div>

      {/* 标签：无标签时折叠为入口按钮，避免常驻空行占位 */}
      {note.tags.length > 0 || tagsOpen ? (
        <div className={cn("flex shrink-0 items-center border-b py-1.5", PANE_PX)}>
          <TagEditor
            tags={note.tags}
            onChange={(tags) => void noteRepo.update(note.id, { tags })}
            autoFocus
          />
        </div>
      ) : (
        <div className={cn("flex shrink-0 items-center border-b py-1", PANE_PX)}>
          <button
            type="button"
            onClick={() => setTagsOpen(true)}
            className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
            aria-label="添加标签"
          >
            <Tag className="h-3 w-3" />
            添加标签
          </button>
        </div>
      )}

      {/* 编辑 / 源码 / 预览（块级混合编辑） */}
      {editorMode === "preview" ? (
        // key 与另两个模式对齐：切换笔记时重挂，blocks 重新初始化（内部块草稿不跨笔记残留）
        <HybridPreview
          key={note.id}
          content={latestContent}
          onChange={handleChange}
          editable={hybridEditing}
        />
      ) : editorMode === "source" ? (
        <div className="min-h-0 flex-1">
          {/* key 确保切换笔记时重挂载；sourceNonce 供抽屉等外部改写后刷新内容 */}
          <MarkdownSource
            key={`${note.id}:${sourceNonce}`}
            value={latestContent}
            onChange={handleChange}
          />
        </div>
      ) : (
        <LazyEditor
          key={note.id}
          content={latestContent}
          onChange={handleChange}
          showToolbar
          autofocus
        />
      )}

      <ConfirmDialog
        open={confirmOpen}
        title="删除这篇笔记？"
        description={`「${note.title}」将被永久删除，此操作无法撤销。`}
        confirmLabel="删除"
        onConfirm={async () => {
          setConfirmOpen(false);
          await deleteNote(note.id);
        }}
        onCancel={() => setConfirmOpen(false)}
      />

      {/* 附件抽屉（本页图片管理） */}
      <AttachmentDrawer
        note={note}
        content={latestContent}
        onExternalContentChange={applyExternalContent}
      />
    </div>
  );
}
