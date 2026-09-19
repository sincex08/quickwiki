"use client";

import { useState } from "react";
import { Header } from "@/components/layout/header";
import { RequireAuth } from "@/components/layout/require-auth";
import { SidebarContent } from "@/components/layout/sidebar";
import { Toaster } from "@/components/common/toaster";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { CommandPalette } from "@/components/command-palette";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useNotebooks } from "@/hooks/use-data";
import { useNoteActions } from "@/hooks/use-note-actions";
import { useHotkeys } from "@/hooks/use-hotkeys";
import { buildNotebookPaths } from "@/lib/notebook-path";
import { useUIStore } from "@/stores/use-ui-store";

/**
 * 主应用外壳：
 * - 强制登录（RequireAuth）：未登录跳 /login
 * - Desktop (≥md)：固定侧边栏 + 内容区
 * - Mobile (<md)：抽屉式侧边栏（原底部导航已随「笔记本管理页」一并移除）
 */
export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const sidebarOpen = useUIStore((s) => s.sidebarOpen);
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen);
  const { createNote, resolveNewNoteTarget } = useNoteActions();
  const { notebooks } = useNotebooks();
  // 全局快捷键（桌面端）：Ctrl+K/N/F/S/E、Ctrl+/
  useHotkeys();

  /**
   * 顶部「新建笔记」的待确认落点。
   * 顶部按钮的归属是推断出来的（打开的笔记 > 侧栏选中 > 未分类），用户看不见，
   * 误落到别的笔记本正是最难发现的那种错 —— 先确认落点再创建（2026-09-19）。
   */
  const [pendingNewNote, setPendingNewNote] = useState<{
    notebookId: string | null;
  } | null>(null);

  const requestNewNote = async () => {
    const notebookId = await resolveNewNoteTarget();
    setPendingNewNote({ notebookId });
  };

  const confirmNewNote = () => {
    const target = pendingNewNote;
    setPendingNewNote(null);
    // 用弹窗里展示过的那个 id 显式创建：不再二次推断，避免「看到的落点」
    // 与「实际落点」不一致
    if (target) void createNote({ notebookId: target.notebookId });
  };

  const pendingTargetLabel = pendingNewNote
    ? pendingNewNote.notebookId
      ? buildNotebookPaths(notebooks).get(pendingNewNote.notebookId) ??
        "未知笔记本"
      : "未分类"
    : "";

  return (
    <RequireAuth>
      <div className="flex h-full">
        {/* 桌面端固定侧边栏（树状导航：笔记本 → 笔记，已并入原列表栏职责） */}
        <aside className="hidden w-72 shrink-0 border-r md:block lg:w-80">
          <SidebarContent />
        </aside>

        {/* 移动端抽屉侧边栏 */}
        <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
          <SheetContent side="left" className="w-72 p-0">
            <SheetTitle className="sr-only">导航菜单</SheetTitle>
            <SidebarContent />
          </SheetContent>
        </Sheet>

        <div className="flex min-w-0 flex-1 flex-col">
          <Header
            onNewNote={() => void requestNewNote()}
            onOpenSidebar={() => setSidebarOpen(true)}
          />
          <main className="min-h-0 flex-1">{children}</main>
        </div>

        {/* 顶部「新建笔记」的落点确认：明确写出会建到哪个笔记本（含完整路径） */}
        <ConfirmDialog
          open={pendingNewNote !== null}
          title="新建笔记"
          description={`将在「${pendingTargetLabel}」下创建新笔记，创建后直接进入编辑。`}
          confirmLabel="创建"
          destructive={false}
          onConfirm={confirmNewNote}
          onCancel={() => setPendingNewNote(null)}
        />

        <Toaster />
        <CommandPalette />
      </div>
    </RequireAuth>
  );
}
