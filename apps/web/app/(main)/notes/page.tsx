"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { useUIStore } from "@/stores/use-ui-store";
import { NoteListPane } from "./_components/note-list-pane";
import { EditorPane } from "./_components/editor-pane";

/**
 * 深度链接同步：?note=<id> 与全局选中笔记双向绑定。
 * 静态导出下通过客户端 useSearchParams 读取，需包裹在 Suspense 中。
 */
function NoteUrlSync() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeNoteId = useUIStore((s) => s.activeNoteId);
  const openNote = useUIStore((s) => s.openNote);
  const [hydrated, setHydrated] = useState(false);

  // 首次挂载：从 URL 读取 ?note= 恢复选中状态（支持刷新/分享链接）
  useEffect(() => {
    const noteId = searchParams.get("note");
    if (noteId) openNote(noteId);
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 选中变化：回写 URL（不触发页面滚动）。
  // 依赖 state 版 hydrated，确保首次写入发生在水合渲染之后，
  // 避免用旧的 activeNoteId=null 误删 ?note= 参数。
  useEffect(() => {
    if (!hydrated) return;
    const current = searchParams.get("note");
    if (activeNoteId === current) return;
    if (activeNoteId) {
      router.replace(`/notes?note=${activeNoteId}`, { scroll: false });
    } else if (current) {
      router.replace("/notes", { scroll: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeNoteId, hydrated]);

  return null;
}

function NotesLayout() {
  const activeNoteId = useUIStore((s) => s.activeNoteId);
  const noteListTitleOnly = useUIStore((s) => s.noteListTitleOnly);

  return (
    <div className="flex h-full min-h-0">
      {/* 笔记列表栏：移动端在打开笔记时隐藏，桌面端始终显示；仅标题模式下收窄 */}
      <div
        className={cn(
          "w-full flex-col border-r md:flex",
          noteListTitleOnly ? "md:w-56 lg:w-64" : "md:w-80 lg:w-96",
          activeNoteId ? "hidden md:flex" : "flex"
        )}
      >
        <NoteListPane />
      </div>

      {/* 编辑器区：移动端在打开笔记时全屏，桌面端始终显示 */}
      <div
        className={cn(
          "min-w-0 flex-1 flex-col",
          activeNoteId ? "flex" : "hidden md:flex"
        )}
      >
        <EditorPane />
      </div>
    </div>
  );
}

export default function NotesPage() {
  return (
    <Suspense fallback={<div className="h-full" />}>
      <NoteUrlSync />
      <NotesLayout />
    </Suspense>
  );
}
