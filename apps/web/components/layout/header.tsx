"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Download,
  HelpCircle,
  LogIn,
  LogOut,
  Moon,
  Plus,
  RefreshCw,
  Search,
  Sun,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FeaturesDialog } from "@/components/common/features-dialog";
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

/** 搜索输入框（防抖后写入全局搜索状态） */
function SearchBox() {
  const searchQuery = useUIStore((s) => s.searchQuery);
  const setSearchQuery = useUIStore((s) => s.setSearchQuery);
  const setTagFilter = useUIStore((s) => s.setTagFilter);
  const openNote = useUIStore((s) => s.openNote);
  const [local, setLocal] = useState(searchQuery);

  useEffect(() => {
    setLocal(searchQuery);
  }, [searchQuery]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (local !== searchQuery) {
        setSearchQuery(local);
        // 搜索时清除标签过滤，避免叠加造成困惑
        if (local) {
          setTagFilter(null);
          // 移动端列表栏在打开笔记时隐藏，搜索时退回列表以展示结果
          if (typeof window !== "undefined" && window.innerWidth < 768) {
            openNote(null);
          }
        }
      }
    }, 200);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local]);

  return (
    <div className="relative w-full max-w-md">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <input
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        placeholder="搜索笔记…"
        aria-label="搜索笔记"
        className="h-9 w-full rounded-md border border-input bg-background pl-8 pr-8 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      {local && (
        <button
          type="button"
          aria-label="清除搜索"
          title="清除搜索"
          onClick={() => {
            setLocal("");
            setSearchQuery("");
          }}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

/** 云同步状态芯片：未配置隐藏；未登录显示入口；已登录显示状态/立即同步/退出 */
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

  const statusTitle =
    sync.status === "syncing"
      ? "正在同步…"
      : sync.status === "error"
        ? `同步失败：${sync.error ?? "未知错误"} · 点击重试`
        : sync.lastSyncAt
          ? `已同步（${new Date(sync.lastSyncAt).toLocaleTimeString()}）· 点击立即同步`
          : "点击立即同步";

  const signOut = async () => {
    await getSupabase()?.auth.signOut();
  };

  return (
    <div className="flex items-center gap-0.5">
      <Button
        variant="ghost"
        size="icon"
        title={statusTitle}
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
      </Button>
      <Button
        variant="ghost"
        size="icon"
        title={`退出登录（${sync.userEmail ?? ""}）`}
        aria-label="退出登录"
        onClick={() => void signOut()}
      >
        <LogOut className="h-4 w-4" />
      </Button>
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
    <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-background px-3 md:px-4">
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

      <div className="min-w-0 flex-1 md:flex-initial">
        <SearchBox />
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-1">
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

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="导出数据" title="导出数据（单篇 Markdown / 全量 ZIP）" disabled={exporting}>
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
          onClick={() => setFeaturesOpen(true)}
          aria-label="功能说明"
          title="功能说明与 Markdown 快捷键速查"
        >
          <HelpCircle className="h-4 w-4" />
        </Button>

        <Button
          variant="ghost"
          size="icon"
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
