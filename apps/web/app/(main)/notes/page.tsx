"use client";

import { useEffect, useRef, useState } from "react";
import { useNotebooks } from "@/hooks/use-data";
import { useUIStore } from "@/stores/use-ui-store";
import { NoteListPane } from "./_components/note-list-pane";
import { EditorPane } from "./_components/editor-pane";
import { WorkspaceHome } from "./_components/workspace-home";

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

/**
 * 主区三态（作用域侧栏模型，桌面 / 手机同一套心智）：
 * - 启动页：未进入任何笔记本且未打开笔记（左侧栏 = 笔记本索引 + 最近编辑）
 * - 卡片列表：已进入笔记本但未打开笔记（当前笔记本的子笔记本 + 笔记卡片）
 * - 编辑器：打开了笔记（返回按钮回卡片列表）
 */
function NotesLayout() {
  const activeNoteId = useUIStore((s) => s.activeNoteId);
  const notebookFilter = useUIStore((s) => s.notebookFilter);
  const setNotebookFilter = useUIStore((s) => s.setNotebookFilter);
  const { notebooks, loading: notebooksLoading } = useNotebooks();

  /**
   * 记住的位置失效时**清空**（回到启动页），不自动落到第一个笔记本：
   * 应用允许没有当前位置 —— 由用户自己选。
   *
   * 区分两种情况，避免误清空：
   * - 远端删除了当前笔记本（它**曾经**在列表里，现在没了）→ 清空；
   * - 对话框刚创建的新笔记本：create 事件尚未回流到 useNotebooks，filter 指向的 id
   *   **暂时**不在列表里 → 不能清（清了「创建后自动进入」就会被这条 effect 当场抹掉）。
   * 首次装载单独处理：持久化的位置在首载列表里不存在 = 幽灵值，清空。
   */
  const firstLoadRef = useRef(true);
  const validFilterRef = useRef<string | null>(null);
  useEffect(() => {
    if (notebooksLoading) return;
    const exists =
      notebookFilter !== null &&
      notebookFilter !== "none" &&
      notebooks.some((nb) => nb.id === notebookFilter);
    if (exists) {
      validFilterRef.current = notebookFilter;
      firstLoadRef.current = false;
      return;
    }
    if (firstLoadRef.current) {
      firstLoadRef.current = false;
      if (notebookFilter !== null && notebookFilter !== "none") {
        setNotebookFilter(null); // 记住的位置已不存在 → 回启动页
      }
      return;
    }
    if (notebookFilter === null || notebookFilter === "none") return;
    // 不在列表里：只有「曾经有效」才是远端删除；从未有效（刚创建、事件未回流）不动
    if (validFilterRef.current === notebookFilter) {
      validFilterRef.current = null;
      setNotebookFilter(null);
    }
  }, [notebooksLoading, notebooks, notebookFilter, setNotebookFilter]);

  /** 启动页：未选位置且未打开笔记 */
  const showLauncher = notebookFilter === null && !activeNoteId;

  return showLauncher ? (
    <WorkspaceHome />
  ) : activeNoteId ? (
    <EditorPane />
  ) : (
    <NoteListPane />
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
