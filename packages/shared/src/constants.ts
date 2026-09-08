/**
 * QuickWiki 共享常量
 */

/** 笔记本可选颜色（hex） */
export const NOTEBOOK_COLORS = [
  '#3b82f6', // blue
  '#ef4444', // red
  '#22c55e', // green
  '#f59e0b', // amber
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#64748b', // slate
] as const;

/** 列表默认分页大小 */
export const DEFAULT_PAGE_SIZE = 50;

/** IndexedDB 数据库名 */
export const DB_NAME = 'QuickWikiDB';
/** v2：内容格式切换为 Markdown 原生，升级时一次性清空旧 HTML 数据
 *  v3：新增同步 outbox 表（Supabase 云同步验证） */
export const DB_VERSION = 3;

/** 自动保存防抖间隔（毫秒） */
export const AUTOSAVE_DEBOUNCE_MS = 1000;

/** 搜索同步时间戳存储键 */
export const SEARCH_SYNC_KEY = 'quickwiki.search.lastSync';

/** 标题最大长度（超出截断） */
export const TITLE_MAX_LENGTH = 80;
