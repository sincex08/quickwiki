"use client";

import { useMemo } from "react";
import { formatDistanceToNowStrict } from "date-fns";
import { zhCN } from "date-fns/locale";
import { FileText, History, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { NotebookCard } from "@/components/notebooks/notebook-card";
import { useNotebooks, useNotesIndex } from "@/hooks/use-data";
import { useNoteActions } from "@/hooks/use-note-actions";
import { useUIStore } from "@/stores/use-ui-store";
import { notebookPathLabel } from "@/lib/data/notebook-tree";
import type { NoteIndexItem } from "@/lib/data/repository";

/**
 * 启动页（未进入任何笔记本且未打开笔记时的主区）。
 *
 * 作用域侧栏模型的全局层：笔记本卡片网格 + 最近编辑。
 * 位置从这里选；进入笔记本后左侧栏只装当前笔记本的树，
 * 主区切换为卡片列表 / 编辑器（见 notes/page.tsx 的三态）。
 */
export function WorkspaceHome() {
  const setNotebookFilter = useUIStore((s) => s.setNotebookFilter);
  const openNote = useUIStore((s) => s.openNote);
  const { notebooks, loading } = useNotebooks();
  const { items: noteIndex, loading: indexLoading } = useNotesIndex();
  const { createNote } = useNoteActions();

  /** 顶层笔记本（父级缺失的按根级处理，与侧栏口径一致） */
  const rootNotebooks = useMemo(() => {
    const ids = new Set(notebooks.map((nb) => nb.id));
    return notebooks.filter((nb) => !nb.parentId || !ids.has(nb.parentId));
  }, [notebooks]);

  /** 各笔记本直属笔记数 + 未分类数（与侧栏角标同源 listIndex） */
  const { noteCounts, uncategorizedCount } = useMemo(() => {
    const counts = new Map<string, number>();
    let uncategorized = 0;
    for (const n of noteIndex) {
      if (n.notebookId == null) uncategorized += 1;
      else counts.set(n.notebookId, (counts.get(n.notebookId) ?? 0) + 1);
    }
    return { noteCounts: counts, uncategorizedCount: uncategorized };
  }, [noteIndex]);

  const recentNotes = useMemo(
    () =>
      [...noteIndex].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 8),
    [noteIndex]
  );

  /** 打开最近编辑的笔记：位置跟随它所属的笔记本（与搜索跳转同规则） */
  const openRecentNote = (note: NoteIndexItem) => {
    openNote(note.id);
    setNotebookFilter(note.notebookId ?? "none");
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-4xl px-4 py-6 md:px-8 md:py-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold">笔记本</h1>
            <p className="mt-0.5 text-xs text-muted-foreground">
              选一个进入；新笔记会存到「未分类」，可随时在编辑器里移动
            </p>
          </div>
          <Button
            size="sm"
            className="gap-1.5"
            onClick={() => void createNote()}
            title="在「未分类」下创建新笔记"
          >
            <Plus className="h-4 w-4" />
            新建笔记
          </Button>
        </div>

        {loading || indexLoading ? (
          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-11 w-full" />
            ))}
          </div>
        ) : (
          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {rootNotebooks.map((nb) => (
              <NotebookCard
                key={nb.id}
                notebook={nb}
                noteCount={noteCounts.get(nb.id) ?? 0}
                onSelect={() => setNotebookFilter(nb.id)}
              />
            ))}
            {/* 未分类：不属于任何笔记本的笔记（常驻入口，数量为 0 也可进入） */}
            <button
              type="button"
              onClick={() => setNotebookFilter("none")}
              title="不属于任何笔记本的笔记"
              className="flex w-full items-center gap-2 rounded-lg border bg-card px-3 py-2 text-left transition-colors hover:border-primary/40 focus-visible:border-primary/40 focus-visible:outline-none"
            >
              <span
                aria-hidden
                className="h-2.5 w-2.5 shrink-0 rounded-full border border-dashed border-muted-foreground"
              />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                未分类
              </span>
              <span className="shrink-0 text-[11px] text-muted-foreground">
                {uncategorizedCount} 篇
              </span>
            </button>
          </div>
        )}

        {/* 最近编辑：接着写的一击入口 */}
        {!indexLoading && recentNotes.length > 0 && (
          <section className="mt-8">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold">
              <History aria-hidden className="h-4 w-4 text-muted-foreground" />
              最近编辑
            </h2>
            <div className="mt-2 divide-y rounded-lg border bg-card">
              {recentNotes.map((note) => (
                <button
                  key={note.id}
                  type="button"
                  onClick={() => openRecentNote(note)}
                  className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-accent/50"
                  title={note.title}
                >
                  <FileText
                    aria-hidden
                    className="h-4 w-4 shrink-0 text-muted-foreground/70"
                  />
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {note.title}
                  </span>
                  <span className="hidden max-w-36 shrink-0 truncate text-xs text-muted-foreground sm:inline">
                    {notebookPathLabel(notebooks, note.notebookId) || "未分类"}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatDistanceToNowStrict(note.updatedAt, {
                      locale: zhCN,
                      addSuffix: true,
                    })}
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
