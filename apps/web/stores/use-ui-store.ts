import { create } from "zustand";
import type { NotebookFilter } from "@quickwiki/shared";

/** 编辑器三模式 */
export type EditorMode = "edit" | "source" | "preview";

const HYBRID_STORAGE_KEY = "quickwiki.hybridEditing";
const LIST_TITLE_ONLY_KEY = "quickwiki.noteListTitleOnly";
const TREE_EXPANDED_KEY = "quickwiki.treeExpanded";
const NOTEBOOK_FILTER_KEY = "quickwiki.notebookFilter";

/** 「预览点击编辑」开关默认关闭（从未设置过时为 false） */
function readHybridDefault(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(HYBRID_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/** 移动端断点（与 Tailwind md 对齐）：≤767px 视为手机 */
const MOBILE_MAX_WIDTH = 767;

/**
 * 打开 / 切换笔记时的默认编辑器模式：手机端优先「预览」（读优先），
 * 桌面端「编辑」（写优先）。服务端渲染 / 异常时兜底为 "edit"。
 */
export function defaultEditorMode(): EditorMode {
  if (typeof window === "undefined") return "edit";
  try {
    return window.matchMedia(`(max-width: ${MOBILE_MAX_WIDTH}px)`).matches
      ? "preview"
      : "edit";
  } catch {
    return "edit";
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

/** 树展开的子节点 id（笔记本 id 与 "none"=未分类） */
function readTreeExpandedDefault(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(TREE_EXPANDED_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { ids?: unknown };
    return Array.isArray(parsed?.ids) ? (parsed.ids as string[]) : [];
  } catch {
    return [];
  }
}

/**
 * 记住上次查看的笔记本：打开应用回到上次的位置。
 * 存笔记本 id 或 "none"（未分类）；null = 没有记录（或上次就没选）→ 显示默认页。
 */
function readNotebookFilterDefault(): NotebookFilter | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(NOTEBOOK_FILTER_KEY);
    return raw ? (raw as NotebookFilter) : null;
  } catch {
    return null;
  }
}

/**
 * UI 状态（过滤器、选中项、移动端抽屉、编辑器模式、侧栏展开）。
 * 数据本身存在 IndexedDB，这里只保存视图状态。
 * 搜索词**不在这里**：搜索已收敛为顶部搜索框的局部状态（结果走悬浮面板），
 * 不再作为全局过滤条件参与渲染。
 */
interface UIState {
  /**
   * 当前笔记本过滤：
   * - 具体 id = 该笔记本下的笔记
   * - `"none"` = 未分类
   * - `null` = **未选择**（显示默认页）—— 应用允许没有当前位置，不强制停在某个笔记本下；
   *   再次点击已选中的笔记本 / 未分类即可回到这个状态。
   *
   * 2026-09-16：先移除了「全部笔记」维度（不再有跨笔记本混合列表与入口），
   * 随后放开了 `null`（此前会被归一化到第一个笔记本）。
   */
  notebookFilter: NotebookFilter | null;
  /** 当前标签过滤，null = 全部 */
  tagFilter: string | null;
  /** 当前打开的笔记（编辑器展示） */
  activeNoteId: string | null;
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
  /** 侧栏树展开的子节点 id（笔记本 id 与 "none"=未分类，持久化） */
  treeExpandedIds: string[];
  /** 源码视图重挂载计数：抽屉等外部路径改写正文后 bump，刷新 textarea 内容 */
  sourceNonce: number;
  /** 命令面板（Ctrl/Cmd+K）开关：全局快捷键与头部按钮共用 */
  commandPaletteOpen: boolean;
  /** 功能说明弹窗开关：头部按钮与快捷键共用一份状态 */
  helpOpen: boolean;

  setNotebookFilter: (id: NotebookFilter | null) => void;
  setTagFilter: (tag: string | null) => void;
  openNote: (id: string | null) => void;
  setSidebarOpen: (open: boolean) => void;
  setAttachmentsDrawerOpen: (open: boolean) => void;
  setEditorMode: (mode: EditorMode) => void;
  setHybridEditing: (on: boolean) => void;
  setNoteListTitleOnly: (on: boolean) => void;
  toggleTreeExpandedId: (id: string) => void;
  /** 幂等展开（并集）：搜索结果跳转后把侧栏树展开到目标笔记本 */
  expandTreeIds: (ids: string[]) => void;
  bumpSourceNonce: () => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setHelpOpen: (open: boolean) => void;
}

export const useUIStore = create<UIState>((set) => ({
  notebookFilter: readNotebookFilterDefault(),
  tagFilter: null,
  activeNoteId: null,
  sidebarOpen: false,
  attachmentsDrawerOpen: false,
  editorMode: "edit",
  hybridEditing: readHybridDefault(),
  noteListTitleOnly: readListTitleOnlyDefault(),
  treeExpandedIds: readTreeExpandedDefault(),
  sourceNonce: 0,
  commandPaletteOpen: false,
  helpOpen: false,

  setNotebookFilter: (id) => {
    // 记住位置：下次打开应用直接回到这里
    try {
      if (id === null) window.localStorage.removeItem(NOTEBOOK_FILTER_KEY);
      else window.localStorage.setItem(NOTEBOOK_FILTER_KEY, id);
    } catch {
      // 忽略隐私模式等存储失败
    }
    set({ notebookFilter: id, tagFilter: null });
  },
  setTagFilter: (tag) => set({ tagFilter: tag }),
  openNote: (id) => set({ activeNoteId: id }),
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
  toggleTreeExpandedId: (id) =>
    set((s): Partial<UIState> => {
      const ids = s.treeExpandedIds.includes(id)
        ? s.treeExpandedIds.filter((x) => x !== id)
        : [...s.treeExpandedIds, id];
      persistTreeExpanded(ids);
      return { treeExpandedIds: ids };
    }),
  expandTreeIds: (ids) =>
    set((s): Partial<UIState> => {
      const merged = [...s.treeExpandedIds];
      for (const id of ids) {
        if (id && !merged.includes(id)) merged.push(id);
      }
      if (merged.length === s.treeExpandedIds.length) {
        return {};
      }
      persistTreeExpanded(merged);
      return { treeExpandedIds: merged };
    }),
  bumpSourceNonce: () => set((s) => ({ sourceNonce: s.sourceNonce + 1 })),
  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
  setHelpOpen: (open) => set({ helpOpen: open }),
}));

/** 树展开状态写 localStorage（失败静默，如隐私模式） */
function persistTreeExpanded(ids: string[]): void {
  try {
    window.localStorage.setItem(TREE_EXPANDED_KEY, JSON.stringify({ ids }));
  } catch {
    // 忽略存储失败
  }
}
