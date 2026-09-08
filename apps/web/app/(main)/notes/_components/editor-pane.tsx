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
  PenLine,
  Pin,
  RefreshCcw,
  Trash2,
} from "lucide-react";
import { AUTOSAVE_DEBOUNCE_MS } from "@quickwiki/shared";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { MiniSwitch } from "@/components/common/mini-switch";
import { LazyEditor } from "@/components/editor/lazy-editor";
import { MarkdownSource } from "@/components/editor/markdown-source";
import { HybridPreview } from "@/components/editor/hybrid-preview";
import { TagEditor } from "@/components/notes/tag-editor";
import { useNote, useNotebooks } from "@/hooks/use-data";
import { useNoteActions } from "@/hooks/use-note-actions";
import { useUIStore, type EditorMode } from "@/stores/use-ui-store";
import { noteRepo } from "@/lib/data/repository";
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

  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [confirmOpen, setConfirmOpen] = useState(false);

  const pendingRef = useRef<{ id: string; content: string } | null>(null);

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
        pendingRef.current = null;
        noteRepo
          .update(id, { content, title: computeTitle(content) })
          .then(() => setSaveState("saved"));
      }, AUTOSAVE_DEBOUNCE_MS),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // 切换笔记或卸载时：立即落盘未保存内容并回到编辑模式
  useEffect(() => {
    return () => {
      debouncedSave.cancel();
      flushPending();
      setEditorMode("edit");
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

  // 模式切换不丢内容的关键：优先取防抖期内未落盘的最新内容
  const latestContent = pendingRef.current?.content ?? note.content;
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
      {/* 编辑器头部 */}
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          onClick={() => openNote(null)}
          aria-label="返回列表"
          title="返回列表"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>
              {format(note.updatedAt, "yyyy-MM-dd HH:mm", { locale: zhCN })}
            </span>
            {saveState === "saving" && <span className="text-primary">保存中…</span>}
            {saveState === "saved" && (
              <span className="inline-flex items-center gap-0.5 text-green-600 dark:text-green-400">
                <Check className="h-3 w-3" />
                已保存
              </span>
            )}
          </div>
        </div>

        {/* 移动到笔记本 */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-1.5 text-xs" title="移动到笔记本">
              <BookMarked className="h-3.5 w-3.5" />
              <span className="hidden max-w-24 truncate sm:inline">
                {currentNotebook?.name ?? "未分类"}
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => moveToNotebook(note.id, null)}>
              未分类
            </DropdownMenuItem>
            {notebooks.map((nb) => (
              <DropdownMenuItem key={nb.id} onClick={() => moveToNotebook(note.id, nb.id)}>
                <span
                  className="mr-1.5 inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: nb.color }}
                />
                {nb.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          variant="ghost"
          size="icon"
          onClick={() => togglePin(note.id, note.pinned)}
          aria-label={note.pinned ? "取消置顶" : "置顶"}
          title={note.pinned ? "取消置顶" : "置顶（列表优先显示）"}
        >
          <Pin className={note.pinned ? "h-4 w-4 fill-primary text-primary" : "h-4 w-4"} />
        </Button>

        {/* 三模式分段控件：编辑 / Markdown 源码 / 预览 */}
        <div className="inline-flex items-center gap-0.5 rounded-md border p-0.5">
          {modeButtons.map(({ mode, label, icon }) => (
            <Button
              key={mode}
              variant="ghost"
              size="icon"
              className={cn(
                "h-9 w-9 lg:h-7 lg:w-7",
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

        {/* 动态按钮容器：按当前模式显示上下文相关按钮 */}
        <div className="flex items-center gap-1">
          {editorMode === "preview" && (
            <>
              <span className="hidden text-xs text-muted-foreground sm:inline">
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
          className="text-destructive hover:text-destructive"
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
          <MarkdownSource value={latestContent} onChange={handleChange} />
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
    </div>
  );
}
