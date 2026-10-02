"use client";

import { useEffect, useRef } from "react";
import { Header } from "@/components/layout/header";
import { RequireAuth } from "@/components/layout/require-auth";
import { SidebarContent } from "@/components/layout/sidebar";
import { Toaster } from "@/components/common/toaster";
import { CommandPalette } from "@/components/command-palette";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useNoteActions } from "@/hooks/use-note-actions";
import { useHotkeys } from "@/hooks/use-hotkeys";
import { useOnline } from "@/hooks/use-online";
import { useUIStore, REQUEST_NEW_NOTE_EVENT } from "@/stores/use-ui-store";

/**
 * 主应用外壳：
 * - 强制登录（RequireAuth）：未登录跳 /login
 * - Desktop (≥md)：作用域侧栏 + 主区（启动页 / 卡片列表 / 编辑器三态）
 * - Mobile (<md)：抽屉式侧边栏（同一套作用域内容）+ 主区三态
 */
export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const sidebarOpen = useUIStore((s) => s.sidebarOpen);
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen);
  const online = useOnline();
  const { createNote } = useNoteActions();
  // 全局快捷键（桌面端）：Ctrl+K/N/F/S/E、Ctrl+/
  useHotkeys();

  /**
   * 新建笔记：直接创建，落点按「打开的笔记所属笔记本 > 当前位置 > 未分类」
   * 推断（useNoteActions 内解析）。作用域侧栏模型下落点恒为可见的当前位置
   * （面包屑 / 列表标题 / 编辑器头部的笔记本名），不再需要确认弹窗
   * （2026-09-19 的二次确认是为「落点不可见」设计的，前提已消失）。
   */
  const requestNewNote = () => {
    void createNote();
  };

  // FAB / Ctrl+N 经同一事件接入此流程，三入口行为一致
  const requestNewNoteRef = useRef(requestNewNote);
  requestNewNoteRef.current = requestNewNote;
  useEffect(() => {
    const onRequest = () => requestNewNoteRef.current();
    window.addEventListener(REQUEST_NEW_NOTE_EVENT, onRequest);
    return () =>
      window.removeEventListener(REQUEST_NEW_NOTE_EVENT, onRequest);
  }, []);

  return (
    <RequireAuth>
      <div className="flex h-full">
        {/* 桌面端固定侧边栏（作用域导航：启动页态=笔记本索引+最近编辑；
            进入笔记本后=该笔记本的子笔记本与笔记树） */}
        <aside className="hidden w-72 shrink-0 border-r md:block lg:w-80">
          <SidebarContent />
        </aside>

        {/* 移动端抽屉侧边栏（内容同桌面） */}
        <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
          <SheetContent side="left" className="w-72 p-0">
            <SheetTitle className="sr-only">导航菜单</SheetTitle>
            <SidebarContent />
          </SheetContent>
        </Sheet>

        <div className="flex min-w-0 flex-1 flex-col">
          <Header onOpenSidebar={() => setSidebarOpen(true)} />
          {/* 离线指示条：断网期间明确「改动保存在本机」，与同步故障区分 */}
          {!online && (
            <div
              role="status"
              className="shrink-0 border-b bg-amber-500/10 px-3 py-1.5 text-center text-xs text-amber-600 dark:text-amber-400"
            >
              离线中 · 改动保存在本机，联网后自动同步
            </div>
          )}
          <main className="min-h-0 flex-1">{children}</main>
        </div>

        <Toaster />
        <CommandPalette />
      </div>
    </RequireAuth>
  );
}
