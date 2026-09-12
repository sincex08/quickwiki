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
 *  v3：新增同步 outbox 表（Supabase 云同步验证）
 *  v4：新增 attachments 附件表（图片唯一来源） */
export const DB_VERSION = 4;

/** 附件引用协议：Markdown 内以 ![alt](quickwiki-att://<attachmentId>) 引用，
 *  本地与服务端内容同协议、零改写 */
export const ATT_PROTOCOL = 'quickwiki-att://';

/** 原图档单张上限（压缩档上限沿用 web 层 IMAGE_MAX_BYTES） */
export const ATT_MAX_ORIGINAL_BYTES = 10 * 1024 * 1024;

/** 单次批量上传上限（超出部分提示分批） */
export const ATT_BATCH_LIMIT = 20;

/** mime → 扩展名（Storage 对象命名与导出文件名用） */
export const ATTACHMENT_MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'image/bmp': 'bmp',
  'image/avif': 'avif',
};

/** 自动保存防抖间隔（毫秒） */
export const AUTOSAVE_DEBOUNCE_MS = 1000;

/** 搜索同步时间戳存储键 */
export const SEARCH_SYNC_KEY = 'quickwiki.search.lastSync';

/** 标题最大长度（超出截断） */
export const TITLE_MAX_LENGTH = 80;
