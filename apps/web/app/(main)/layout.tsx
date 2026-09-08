"use client";

import { Header } from "@/components/layout/header";
import { MobileNav } from "@/components/layout/mobile-nav";
import { SidebarContent } from "@/components/layout/sidebar";
import { Toaster } from "@/components/common/toaster";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useNoteActions } from "@/hooks/use-note-actions";
import { useUIStore } from "@/stores/use-ui-store";

/**
 * 主应用外壳：
 * - Desktop (≥md)：固定侧边栏 + 内容区
 * - Mobile (<md)：抽屉式侧边栏 + 底部导航
 */
export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const sidebarOpen = useUIStore((s) => s.sidebarOpen);
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen);
  const { createNote } = useNoteActions();

  return (
    <div className="flex h-full">
      {/* 桌面端固定侧边栏 */}
      <aside className="hidden w-60 shrink-0 border-r md:block lg:w-64">
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
        <Header onNewNote={createNote} onOpenSidebar={() => setSidebarOpen(true)} />
        <main className="min-h-0 flex-1">{children}</main>
        <MobileNav />
      </div>

      <Toaster />
    </div>
  );
}
