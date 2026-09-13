import { create } from "zustand";
import type { NotebookFilter } from "@quickwiki/shared";

/** 编辑器三模式 */
export type EditorMode = "edit" | "source" | "preview";

const HYBRID_STORAGE_KEY = "quickwiki.hybridEditing";
const LIST_TITLE_ONLY_KEY = "quickwiki.noteListTitleOnly";

function readHybridDefault(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(HYBRID_STORAGE_KEY) !== "0";
  } catch {
    return true;
  }
}

function readListTitleOnlyDefault(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(LIST_TITLE_ONLY_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * UI 状态（过滤器、选中项、搜索词、移动端抽屉、编辑器模式）。
 * 数据本身存在 IndexedDB，这里只保存视图状态。
 */
interface UIState {
  /**
   * 当前笔记本过滤：
   * - null = 全部笔记（含未分类）
   * - "none" = 仅未分类（不属于任何笔记本）
   * - 具体 id = 该笔记本下的笔记
   */
  notebookFilter: NotebookFilter | null;
  /** 当前标签过滤，null = 全部 */
  tagFilter: string | null;
  /** 当前打开的笔记（编辑器展示） */
  activeNoteId: string | null;
  /** 搜索关键词 */
  searchQuery: string;
  /** 移动端侧边栏抽屉 */
  sidebarOpen: boolean;
  /** 附件抽屉（编辑器头部按钮打开，按当前笔记维度） */
  attachmentsDrawerOpen: boolean;
  /** 编辑器模式（提升到 store 供头部开关感知） */
  editorMode: EditorMode;
  /** 预览模式是否开启「点击块编辑」（头部开关控制，持久化） */
  hybridEditing: boolean;
  /** 笔记列表是否只展示标题（紧凑模式，中栏更窄，持久化） */
  noteListTitleOnly: boolean;
  /** 源码视图重挂载计数：抽屉等外部路径改写正文后 bump，刷新 textarea 内容 */
  sourceNonce: number;

  setNotebookFilter: (id: NotebookFilter | null) => void;
  setTagFilter: (tag: string | null) => void;
  openNote: (id: string | null) => void;
  setSearchQuery: (q: string) => void;
  setSidebarOpen: (open: boolean) => void;
  setAttachmentsDrawerOpen: (open: boolean) => void;
  setEditorMode: (mode: EditorMode) => void;
  setHybridEditing: (on: boolean) => void;
  setNoteListTitleOnly: (on: boolean) => void;
  bumpSourceNonce: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  notebookFilter: null,
  tagFilter: null,
  activeNoteId: null,
  searchQuery: "",
  sidebarOpen: false,
  attachmentsDrawerOpen: false,
  editorMode: "edit",
  hybridEditing: readHybridDefault(),
  noteListTitleOnly: readListTitleOnlyDefault(),
  sourceNonce: 0,

  setNotebookFilter: (id) => set({ notebookFilter: id, tagFilter: null }),
  setTagFilter: (tag) => set({ tagFilter: tag }),
  openNote: (id) => set({ activeNoteId: id }),
  setSearchQuery: (q) => set({ searchQuery: q }),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setAttachmentsDrawerOpen: (open) => set({ attachmentsDrawerOpen: open }),
  setEditorMode: (mode) => set({ editorMode: mode }),
  setHybridEditing: (on) => {
    try {
      window.localStorage.setItem(HYBRID_STORAGE_KEY, on ? "1" : "0");
    } catch {
      // 忽略隐私模式等存储失败
    }
    set({ hybridEditing: on });
  },
  setNoteListTitleOnly: (on) => {
    try {
      window.localStorage.setItem(LIST_TITLE_ONLY_KEY, on ? "1" : "0");
    } catch {
      // 忽略隐私模式等存储失败
    }
    set({ noteListTitleOnly: on });
  },
  bumpSourceNonce: () => set((s) => ({ sourceNonce: s.sourceNonce + 1 })),
}));
