"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Eye,
  FileCode2,
  FileDown,
  FilePlus2,
  FolderArchive,
  HelpCircle,
  Moon,
  PenLine,
  RefreshCw,
  Sun,
  UserRound,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useUIStore, type EditorMode } from "@/stores/use-ui-store";
import { useNoteActions } from "@/hooks/use-note-actions";
import { useSearchPanel } from "@/hooks/use-search";
import { useTheme } from "@/components/theme-provider";
import { syncNow } from "@/lib/sync/sync-engine";
import {
  exportAllAsZip,
  exportNoteAsMarkdown,
} from "@/lib/export";
import { noteRepo } from "@/lib/data/repository";
import { useToastStore } from "@/stores/use-toast-store";
import { cn } from "@/lib/utils";

interface PaletteCommand {
  id: string;
  title: string;
  shortcut?: string;
  icon: LucideIcon;
  run: () => void | Promise<void>;
}

type PaletteRow =
  | { kind: "command"; command: PaletteCommand }
  | { kind: "note"; item: ReturnType<typeof useSearchPanel>["items"][number] };

/**
 * 命令面板（Ctrl/Cmd+K）：上半区命令、下半区笔记全文命中（复用搜索索引）。
 * ↑↓ 跨区移动、Enter 执行/打开、Esc 关闭。
 */
export function CommandPalette() {
  const router = useRouter();
  const open = useUIStore((s) => s.commandPaletteOpen);
  const setOpen = useUIStore((s) => s.setCommandPaletteOpen);
  const setHelpOpen = useUIStore((s) => s.setHelpOpen);
  const setEditorMode = useUIStore((s) => s.setEditorMode);
  const openNote = useUIStore((s) => s.openNote);
  const setNotebookFilter = useUIStore((s) => s.setNotebookFilter);
  const expandTreeIds = useUIStore((s) => s.expandTreeIds);
  const activeNoteId = useUIStore((s) => s.activeNoteId);
  const { theme, toggleTheme } = useTheme();
  const { createNote } = useNoteActions();

  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const { items: noteItems } = useSearchPanel(query);

  const runSafely = async (fn: () => void | Promise<void>) => {
    try {
      await fn();
    } catch (err) {
      useToastStore
        .getState()
        .show(err instanceof Error ? err.message : "操作失败");
    }
  };

  const commands = useMemo<PaletteCommand[]>(() => {
    const modeCommands: Array<{ mode: EditorMode; label: string; icon: LucideIcon }> = [
      { mode: "edit", label: "编辑", icon: PenLine },
      { mode: "source", label: "Markdown 源码", icon: FileCode2 },
      { mode: "preview", label: "预览", icon: Eye },
    ];
    return [
      {
        id: "new-note",
        title: "新建笔记",
        shortcut: "Ctrl+N",
        icon: FilePlus2,
        run: () => createNote(),
      },
      ...modeCommands.map(({ mode, label, icon }) => ({
        id: `mode-${mode}`,
        title: `切换到「${label}」模式`,
        icon,
        run: () => setEditorMode(mode),
      })),
      {
        id: "sync",
        title: "立即同步",
        icon: RefreshCw,
        run: () => syncNow(),
      },
      {
        id: "theme",
        title: theme === "dark" ? "切换到浅色主题" : "切换到深色主题",
        icon: theme === "dark" ? Sun : Moon,
        run: () => toggleTheme(),
      },
      {
        id: "export-note",
        title: "导出当前笔记（Markdown）",
        shortcut: "需先打开笔记",
        icon: FileDown,
        run: async () => {
          if (!activeNoteId) throw new Error("当前没有打开的笔记");
          const note = await noteRepo.findById(activeNoteId);
          if (!note) throw new Error("当前笔记不存在");
          await exportNoteAsMarkdown(note);
        },
      },
      {
        id: "export-all",
        title: "导出全部笔记（ZIP）",
        icon: FolderArchive,
        run: async () => {
          const count = await exportAllAsZip();
          useToastStore.getState().show(`已导出 ${count} 篇笔记`, "success");
        },
      },
      {
        id: "account",
        title: "账号管理",
        icon: UserRound,
        run: () => router.push("/account"),
      },
      {
        id: "help",
        title: "功能说明与快捷键",
        shortcut: "Ctrl+/",
        icon: HelpCircle,
        run: () => setHelpOpen(true),
      },
    ];
  }, [theme, toggleTheme, createNote, setEditorMode, router, setHelpOpen, activeNoteId]);

  const q = query.trim().toLowerCase();
  const filteredCommands = useMemo(
    () =>
      q
        ? commands.filter((c) => c.title.toLowerCase().includes(q))
        : commands,
    [commands, q]
  );
  const limitedNotes = useMemo(
    () => (q ? noteItems.slice(0, 8) : []),
    [noteItems, q]
  );

  const rows = useMemo<PaletteRow[]>(
    () => [
      ...filteredCommands.map((command) => ({ kind: "command" as const, command })),
      ...limitedNotes.map((item) => ({ kind: "note" as const, item })),
    ],
    [filteredCommands, limitedNotes]
  );

  // 打开清空状态；结果变化时光标回首个
  useEffect(() => {
    if (open) {
      setQuery("");
      setCursor(0);
    }
  }, [open]);
  useEffect(() => {
    setCursor(0);
  }, [query]);

  useEffect(() => {
    listRef.current
      ?.querySelector("[data-active='true']")
      ?.scrollIntoView({ block: "nearest" });
  }, [cursor, rows.length]);

  const selectNote = (noteId: string, notebookId: string | null) => {
    openNote(noteId);
    setNotebookFilter(notebookId ?? "none");
    expandTreeIds(
      notebookId
        ? [notebookId]
        : ["none"]
    );
    setOpen(false);
    if (window.location.pathname !== "/notes") router.push("/notes");
  };

  const activate = (row: PaletteRow | undefined) => {
    if (!row) return;
    setOpen(false);
    if (row.kind === "command") void runSafely(row.command.run);
    else selectNote(row.item.note.id, row.item.note.notebookId);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="top-[15%] max-w-xl translate-y-0 gap-0 p-0">
        <DialogTitle className="sr-only">命令面板</DialogTitle>
        <div className="border-b">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="输入命令或搜索笔记…"
            aria-label="命令与笔记搜索"
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setCursor((c) => Math.min(c + 1, rows.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setCursor((c) => Math.max(c - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                activate(rows[cursor]);
              }
            }}
            className="h-12 w-full bg-transparent px-4 text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div ref={listRef} className="max-h-80 overflow-y-auto p-1.5">
          {rows.length === 0 && (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              没有匹配的命令或笔记
            </p>
          )}
          {filteredCommands.length > 0 && (
            <p className="px-2 pb-1 pt-1.5 text-[11px] font-medium text-muted-foreground">
              命令
            </p>
          )}
          {filteredCommands.map((command) => {
            const index = rows.findIndex(
              (r) => r.kind === "command" && r.command.id === command.id
            );
            return (
              <button
                key={command.id}
                type="button"
                data-active={cursor === index}
                onClick={() => activate({ kind: "command", command })}
                onMouseEnter={() => setCursor(index)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm",
                  cursor === index && "bg-accent"
                )}
              >
                <command.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{command.title}</span>
                {command.shortcut && (
                  <span className="shrink-0 text-[11px] text-muted-foreground/70">
                    {command.shortcut}
                  </span>
                )}
              </button>
            );
          })}
          {limitedNotes.length > 0 && (
            <p className="px-2 pb-1 pt-2 text-[11px] font-medium text-muted-foreground">
              笔记
            </p>
          )}
          {limitedNotes.map((item) => {
            const index = rows.findIndex(
              (r) => r.kind === "note" && r.item.note.id === item.note.id
            );
            return (
              <button
                key={item.note.id}
                type="button"
                data-active={cursor === index}
                onClick={() => activate({ kind: "note", item })}
                onMouseEnter={() => setCursor(index)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm",
                  cursor === index && "bg-accent"
                )}
              >
                {item.notebookColor && (
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: item.notebookColor }}
                  />
                )}
                <span className="min-w-0 flex-1 truncate">{item.note.title}</span>
                <span className="shrink-0 text-[11px] text-muted-foreground/70">
                  {item.notebookLabel}
                </span>
              </button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
