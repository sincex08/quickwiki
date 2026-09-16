"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { useUIStore } from "@/stores/use-ui-store";
import { NoteListPane } from "./_components/note-list-pane";
import { EditorPane } from "./_components/editor-pane";

/**
 * 深链同步：?note=<id> 与全局选中笔记双向绑定。
 *
 * 刻意不走 next/navigation：`router.replace` 会发起一次真实的路由导航
 * （重新请求 RSC payload、页面级 Suspense 回退到空白），表现为「打开/新建
 * 笔记时整页闪一下」。直接读写地址栏同样保住了刷新与分享链接语义，
 * 但没有任何重渲染，也不会让组件重新挂载。
 */
function NoteUrlSync() {
  const activeNoteId = useUIStore((s) => s.activeNoteId);
  const openNote = useUIStore((s) => s.openNote);
  const [hydrated, setHydrated] = useState(false);

  // 首次挂载：从地址栏恢复 ?note=（支持刷新 / 分享链接 / 浏览器重新打开）
  useEffect(() => {
    const noteId = new URLSearchParams(window.location.search).get("note");
    if (noteId) openNote(noteId);
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 选中变化：只同步地址栏。用 state 版 hydrated 做闸门，确保首次回写发生在
  // 恢复选中之后，避免用初始的 activeNoteId=null 误删刚读到的 ?note=。
  // replaceState 不产生历史记录、不触发路由渲染；history.state 原样透传，
  // 避免扰动 Next 自身的路由状态。
  useEffect(() => {
    if (!hydrated) return;
    const url = new URL(window.location.href);
    if (activeNoteId === url.searchParams.get("note")) return;
    if (activeNoteId) url.searchParams.set("note", activeNoteId);
    else url.searchParams.delete("note");
    window.history.replaceState(
      window.history.state,
      "",
      `${url.pathname}${url.search}${url.hash}`
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeNoteId, hydrated]);

  return null;
}

function NotesLayout() {
  const activeNoteId = useUIStore((s) => s.activeNoteId);

  return (
    <div className="flex h-full min-h-0">
      {/* 笔记列表卡片视图：仅移动端保留（桌面端导航已并入侧栏树），
          打开笔记时隐藏 */}
      <div
        className={cn(
          "w-full flex-col border-r md:hidden",
          activeNoteId ? "hidden" : "flex"
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
    <>
      <NoteUrlSync />
      <NotesLayout />
    </>
  );
}
