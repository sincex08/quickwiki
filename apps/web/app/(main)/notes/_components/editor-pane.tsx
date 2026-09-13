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
import { LazyEditor } from "@/components/editor/lazy-editor";
import { MarkdownSource } from "@/components/editor/markdown-source";
import { HybridPreview } from "@/components/editor/hybrid-preview";
import { TagEditor } from "@/components/notes/tag-editor";
import { AttachmentDrawer } from "@/components/attachments/attachment-drawer";
import { useNote, useNotebooks } from "@/hooks/use-data";
import { useNoteActions } from "@/hooks/use-note-actions";
import { useUIStore, type EditorMode } from "@/stores/use-ui-store";
import { noteRepo } from "@/lib/data/repository";
import { releaseAllObjectUrls } from "@/lib/attachments/resolve";
import { cn, debounce, extractTitle } from "@/lib/utils";

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

  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [confirmOpen, setConfirmOpen] = useState(false);

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
      void noteRepo.update(id, { content, title: computeTitle(content) });
    }
  };

  const debouncedSave = useMemo(
    () =>
      debounce((id: string, content: string) => {
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
          });
      }, AUTOSAVE_DEBOUNCE_MS),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // 切换笔记或卸载时：立即落盘未保存内容、回到编辑模式、释放附件 objectURL
  useEffect(() => {
    return () => {
      debouncedSave.cancel();
      flushPending();
      setEditorMode("edit");
      releaseAllObjectUrls();
      contentOverrideRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeNoteId]);

  const handleChange = (markdown: string) => {
    if (!activeNoteId) return;
    pendingRef.current = { id: activeNoteId, content: markdown };
    latestContentRef.current = markdown;
    setSaveState("saving");
    debouncedSave(activeNoteId, markdown);
  };

  // ===== 自定义标题 =====
  const titleManualRef = useRef<string | null>(null);
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
    if (!activeNoteId) return;
    debouncedSave.cancel();
    pendingRef.current = null;
    contentOverrideRef.current = markdown;
    bumpSourceNonce();
    void noteRepo.update(activeNoteId, {
      content: markdown,
      title: computeTitle(markdown),
    });
  };

  const debouncedTitleSave = useMemo(
    () =>
      debounce((id: string, value: string) => {
        const manual = value.trim() === "" ? null : value;
        titleManualRef.current = manual;
        const title =
          manual !== null ? manual : extractTitle(latestContentRef.current);
        noteRepo
          .update(id, { titleManual: manual, title })
          .then(() => setSaveState("saved"));
      }, AUTOSAVE_DEBOUNCE_MS),
    []
  );

  const handleTitleChange = (value: string) => {
    if (!activeNoteId) return;
    setTitleDraft(value);
    setSaveState("saving");
    debouncedTitleSave(activeNoteId, value);
  };

  const resetTitleToAuto = () => {
    if (!activeNoteId) return;
    titleManualRef.current = null;
    const title = extractTitle(latestContentRef.current);
    setTitleDraft(title);
    void noteRepo
      .update(activeNoteId, { titleManual: null, title })
      .then(() => setSaveState("saved"));
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
      <div className="flex shrink-0 items-center gap-1.5 border-b px-3 py-2 md:gap-2">
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
              className="hidden gap-1.5 text-xs md:inline-flex"
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
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-1.5">
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

      {/* 标签 */}
      <div className="flex shrink-0 items-center border-b px-3 py-1.5">
        <TagEditor
          tags={note.tags}
          onChange={(tags) => void noteRepo.update(note.id, { tags })}
        />
      </div>

      {/* 编辑 / 源码 / 预览（块级混合编辑） */}
      {editorMode === "preview" ? (
        <HybridPreview
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
