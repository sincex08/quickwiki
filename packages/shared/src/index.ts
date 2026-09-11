/**
 * QuickWiki 共享类型定义
 * 跨 web / server / desktop 复用，保证 Phase 2（云端）与 Phase 3（桌面）迁移时类型一致。
 */

/** 笔记 */
export interface Note {
  id: string;
  /** 标题（展示/搜索/导出用） */
  title: string;
  /** 自定义标题；null 表示标题自动取自正文首行 */
  titleManual: string | null;
  /** 内容（Markdown 原生存储） */
  content: string;
  /** 所属笔记本 ID，null 表示未分类 */
  notebookId: string | null;
  /**
   * 标签数组（视图层使用）。
   * 规范化关系保存在 NoteTag 表中，此字段为反范式快照便于展示。
   */
  tags: string[];
  createdAt: number;
  updatedAt: number;
  pinned: boolean;
  /**
   * 云同步乐观锁版本：本地最后一次已知的云端 version 值。
   * null/undefined 表示从未与云端核对过（新创建或旧版本数据），
   * 由 sync-engine 在 pull/成功 push 后写回；本地编辑不修改此字段。
   */
  syncVersion?: number;
}

/** 笔记本 */
export interface Notebook {
  id: string;
  name: string;
  /** 颜色标识（hex） */
  color: string;
  createdAt: number;
  updatedAt: number;
  /** 云同步乐观锁版本，语义同 Note.syncVersion */
  syncVersion?: number;
}

/** 标签（去重后的字典表） */
export interface Tag {
  /** 标签名（唯一，小写规范化） */
  name: string;
  /** 使用次数（冗余字段，便于排序/展示） */
  count: number;
}

/**
 * 笔记-标签 关联表（多对多）。
 * 解决把标签数组直接塞进 Note 导致的全表扫描与大小写重复问题。
 */
export interface NoteTag {
  noteId: string;
  tagName: string;
}

/** 列表查询过滤器（分页从第一天支持，避免后期重构） */
export interface ListFilters {
  notebookId?: string;
  tag?: string;
  search?: string;
  /** 仅置顶 */
  pinnedOnly?: boolean;
  limit?: number;
  offset?: number;
}

/** 通用分页结果 */
export interface Paginated<T> {
  items: T[];
  total: number;
  hasMore: boolean;
}

/** 搜索命中的轻量结构 */
export interface SearchResult {
  id: string;
  title: string;
  /** 命中片段，用于高亮预览 */
  snippet?: string;
  score: number;
}

/** 数据源抽象标识：当前为本地，后续可切换云端/桌面 */
export type StorageBackend = 'indexeddb' | 'api' | 'tauri';

export * from './constants';
