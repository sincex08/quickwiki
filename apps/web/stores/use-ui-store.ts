import { create } from "zustand";

/** 编辑器三模式 */
export type EditorMode = "edit" | "source" | "preview";

const HYBRID_STORAGE_KEY = "quickwiki.hybridEditing";

function readHybridDefault(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(HYBRID_STORAGE_KEY) !== "0";
  } catch {
    return true;
  }
}

/**
 * UI 状态（过滤器、选中项、搜索词、移动端抽屉、编辑器模式）。
 * 数据本身存在 IndexedDB，这里只保存视图状态。
 */
interface UIState {
  /** 当前笔记本过滤，null = 全部 */
  notebookFilter: string | null;
  /** 当前标签过滤，null = 全部 */
  tagFilter: string | null;
  /** 当前打开的笔记（编辑器展示） */
  activeNoteId: string | null;
  /** 搜索关键词 */
  searchQuery: string;
  /** 移动端侧边栏抽屉 */
  sidebarOpen: boolean;
  /** 编辑器模式（提升到 store 供头部开关感知） */
  editorMode: EditorMode;
  /** 预览模式是否开启「点击块编辑」（头部开关控制，持久化） */
  hybridEditing: boolean;

  setNotebookFilter: (id: string | null) => void;
  setTagFilter: (tag: string | null) => void;
  openNote: (id: string | null) => void;
  setSearchQuery: (q: string) => void;
  setSidebarOpen: (open: boolean) => void;
  setEditorMode: (mode: EditorMode) => void;
  setHybridEditing: (on: boolean) => void;
}

export const useUIStore = create<UIState>((set) => ({
  notebookFilter: null,
  tagFilter: null,
  activeNoteId: null,
  searchQuery: "",
  sidebarOpen: false,
  editorMode: "edit",
  hybridEditing: readHybridDefault(),

  setNotebookFilter: (id) => set({ notebookFilter: id, tagFilter: null }),
  setTagFilter: (tag) => set({ tagFilter: tag }),
  openNote: (id) => set({ activeNoteId: id }),
  setSearchQuery: (q) => set({ searchQuery: q }),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setEditorMode: (mode) => set({ editorMode: mode }),
  setHybridEditing: (on) => {
    try {
      window.localStorage.setItem(HYBRID_STORAGE_KEY, on ? "1" : "0");
    } catch {
      // 忽略隐私模式等存储失败
    }
    set({ hybridEditing: on });
  },
}));
