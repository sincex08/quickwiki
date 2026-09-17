"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CircleUserRound,
  Download,
  HelpCircle,
  LogIn,
  Moon,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Sun,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FeaturesDialog } from "@/components/common/features-dialog";
import { SearchBox } from "@/components/search/search-box";
import { useTheme } from "@/components/theme-provider";
import { useUIStore } from "@/stores/use-ui-store";
import { getSearchManager } from "@/lib/search/search-manager";
import { noteRepo } from "@/lib/data/repository";
import { exportAllAsZip, exportNoteAsMarkdown } from "@/lib/export";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase/client";
import {
  getSyncState,
  subscribeSync,
  syncNow,
  type SyncState,
} from "@/lib/sync/sync-engine";
import { cn } from "@/lib/utils";

/** 云同步状态芯片：未配置隐藏；未登录显示登录入口；已登录显示同步状态 + 账号菜单 */
function SyncChip() {
  const router = useRouter();
  const [sync, setSync] = useState<SyncState>(() => getSyncState());

  useEffect(() => subscribeSync(setSync), []);

  if (!isSupabaseConfigured) return null;

  if (!sync.userId) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="gap-1.5 text-xs"
        title="登录以启用云同步"
        onClick={() => router.push("/login")}
      >
        <LogIn className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">登录同步</span>
      </Button>
    );
  }

  const statusText =
    sync.status === "syncing"
      ? "正在同步…"
      : sync.status === "error"
        ? `同步失败：${sync.error ?? "未知错误"}`
        : sync.lastSyncAt
          ? `已同步（${new Date(sync.lastSyncAt).toLocaleTimeString()}）`
          : "尚未同步";

  const signOut = async () => {
    await getSupabase()?.auth.signOut();
  };

  return (
    <div className="flex items-center gap-0.5">
      <Button
        variant="ghost"
        size="icon"
        className="relative"
        title={`${statusText} · 点击立即同步`}
        aria-label="云同步状态"
        disabled={sync.status === "syncing"}
        onClick={() => void syncNow()}
      >
        <RefreshCw
          className={cn(
            "h-4 w-4",
            sync.status === "syncing" && "animate-spin",
            sync.status === "error" && "text-destructive"
          )}
        />
        {/* 常驻错误角标：错误详情在 hover 提示与账号菜单里，不悬停也能注意到 */}
        {sync.status === "error" && (
          <span
            className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-destructive"
            aria-hidden
          />
        )}
      </Button>

      {/* 账号模块：下拉含账号管理 / 立即同步 / 退出登录 */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5"
            title={`账号：${sync.userEmail ?? ""}`}
            aria-label="账号菜单"
          >
            <CircleUserRound className="h-4 w-4" />
            <span className="hidden max-w-32 truncate lg:inline">
              {sync.userEmail}
            </span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-44">
          <DropdownMenuLabel>
            <div className="truncate">{sync.userEmail}</div>
            <div className="text-xs font-normal text-muted-foreground">
              {statusText}
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => router.push("/account")}>
            账号管理
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={sync.status === "syncing"}
            onClick={() => void syncNow()}
          >
            立即同步
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => void signOut()}>
            退出登录
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export interface HeaderProps {
  onNewNote: () => void;
  onOpenSidebar: () => void;
}

export function Header({ onNewNote, onOpenSidebar }: HeaderProps) {
  const { theme, toggleTheme } = useTheme();
  const activeNoteId = useUIStore((s) => s.activeNoteId);
  const [exporting, setExporting] = useState(false);
  const [featuresOpen, setFeaturesOpen] = useState(false);

  // 预热搜索索引，减少首次搜索等待
  useEffect(() => {
    getSearchManager().ensureReady();
  }, []);

  const handleExportMarkdown = async () => {
    if (!activeNoteId) return;
    const note = await noteRepo.findById(activeNoteId);
    if (note) await exportNoteAsMarkdown(note);
  };

  const handleExportZip = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      await exportAllAsZip();
    } finally {
      setExporting(false);
    }
  };

  return (
    <header className="flex h-14 shrink-0 items-center gap-1.5 border-b bg-background px-3 md:gap-2 md:px-4">
      {/* 移动端菜单按钮 */}
      <Button
        variant="ghost"
        size="icon"
        className="shrink-0 md:hidden"
        onClick={onOpenSidebar}
        aria-label="打开菜单"
        title="打开菜单"
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </svg>
      </Button>

      {/* 搜索框：占据剩余全部宽度（移动端优先保证可读），桌面端上限 max-w-md */}
      <div className="min-w-0 flex-1 md:max-w-md">
        <SearchBox />
      </div>

      {/* ml-auto：搜索框在桌面端有 max-w-md 封顶，不自动撑满，
          必须由按钮组吸收剩余空间，否则会停在页中部 */}
      <div className="ml-auto flex shrink-0 items-center gap-0.5 md:gap-1">
        <Button
          size="sm"
          className="hidden gap-1.5 sm:inline-flex"
          onClick={onNewNote}
        >
          <Plus className="h-4 w-4" />
          新建笔记
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="sm:hidden"
          onClick={onNewNote}
          aria-label="新建笔记"
          title="新建笔记"
        >
          <Plus className="h-5 w-5" />
        </Button>

        {/* 移动端：导出/功能说明/主题收进「…」，把宽度让给搜索框 */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              aria-label="更多"
              title="更多"
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-44">
            <DropdownMenuItem disabled={!activeNoteId} onClick={handleExportMarkdown}>
              导出当前笔记（Markdown）
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleExportZip}>
              {exporting ? "正在打包…" : "导出全部笔记（ZIP）"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setFeaturesOpen(true)}>
              功能说明与快捷键
            </DropdownMenuItem>
            <DropdownMenuItem onClick={toggleTheme}>
              {theme === "dark" ? "切换到浅色主题" : "切换到深色主题"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* 桌面端：导出 */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="hidden md:inline-flex"
              aria-label="导出数据"
              title="导出数据（单篇 Markdown / 全量 ZIP）"
              disabled={exporting}
            >
              <Download className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              disabled={!activeNoteId}
              onClick={handleExportMarkdown}
            >
              导出当前笔记（Markdown）
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleExportZip}>
              {exporting ? "正在打包…" : "导出全部笔记（ZIP）"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <SyncChip />

        <Button
          variant="ghost"
          size="icon"
          className="hidden md:inline-flex"
          onClick={() => setFeaturesOpen(true)}
          aria-label="功能说明"
          title="功能说明与 Markdown 快捷键速查"
        >
          <HelpCircle className="h-4 w-4" />
        </Button>

        <Button
          variant="ghost"
          size="icon"
          className="hidden md:inline-flex"
          onClick={toggleTheme}
          aria-label="切换主题"
          title="切换浅色 / 深色主题"
        >
          {theme === "dark" ? (
            <Sun className="h-4 w-4" />
          ) : (
            <Moon className="h-4 w-4" />
          )}
        </Button>
      </div>

      <FeaturesDialog open={featuresOpen} onOpenChange={setFeaturesOpen} />
    </header>
  );
}
