import Dexie, { type Table } from "dexie";
import type { Attachment, Note, Notebook, Tag, NoteTag } from "@quickwiki/shared";
import { DB_NAME } from "@quickwiki/shared";

/** 登录用户标记（sync-engine 在登录/退出时写入，见 AUTH_UID_KEY） */
export const AUTH_UID_KEY = "quickwiki.uid";

/** 已登录 → 按用户分库（数据隔离）；未登录 → 占位库名（登录门禁挡住不会访问） */
function resolveDbName(): string {
  try {
    const uid =
      typeof window !== "undefined" ? localStorage.getItem(AUTH_UID_KEY) : null;
    return uid ? `${DB_NAME}:${uid}` : DB_NAME;
  } catch {
    return DB_NAME;
  }
}

/** 键值元数据表（搜索索引持久化等） */
export interface MetaEntry {
  key: string;
  value: unknown;
}

/** 同步出站队列：每个实体最多一条待推送记录（key = kind:entityId） */
export interface OutboxEntry {
  key: string;
  kind: "note" | "notebook" | "attachment";
  entityId: string;
  deleted: boolean;
  queuedAt: number;
  /** 连续推送失败次数（达到上限标记 dead，非索引字段，无需升库版本） */
  attempts?: number;
  /** 毒丸隔离：连续失败达上限后置位，push 跳过（防止无限重试卡住同步） */
  dead?: boolean;
}

/** 附件完整记录：元数据 + 二进制（IndexedDB 结构化克隆原生支持 Blob 内联）。
 *  blob 可缺省：云同步元数据先行时先落无 blob 记录，靠懒下载回填 */
export interface AttachmentRecord extends Attachment {
  blob?: Blob;
}

/**
 * Dexie 数据库。
 *
 * 索引设计说明：
 * - noteTags 为「笔记-标签」关联表，主键是 [noteId+tagName] 复合键，
 *   避免把标签数组直接放进 Note 造成的全表扫描与大小写重复。
 * - meta 表用于持久化搜索索引（MiniSearch.toJSON）与同步水位。
 * - outbox 表为云同步出站队列（Supabase 验证阶段）。
 */
export const db = new Dexie(resolveDbName()) as Dexie & {
  notes: Table<Note, string>;
  notebooks: Table<Notebook, string>;
  tags: Table<Tag, string>;
  noteTags: Table<NoteTag, [string, string]>;
  meta: Table<MetaEntry, string>;
  outbox: Table<OutboxEntry, string>;
  attachments: Table<AttachmentRecord, string>;
};

db.version(1).stores({
  notes: "id, notebookId, createdAt, updatedAt, pinned",
  notebooks: "id, createdAt",
  tags: "name, count",
  noteTags: "[noteId+tagName], tagName, noteId",
  meta: "key",
});

/**
 * v2：内容格式切换为 Markdown 原生（不兼容旧 HTML 数据）。
 * 一次性清空所有表（含 meta 中持久化的旧搜索索引），升级后从空库开始。
 */
db.version(2)
  .stores({})
  .upgrade(async (tx) => {
    await Promise.all([
      tx.table("notes").clear(),
      tx.table("notebooks").clear(),
      tx.table("tags").clear(),
      tx.table("noteTags").clear(),
      tx.table("meta").clear(),
    ]);
  });

/** v3：云同步出站队列 */
db.version(3).stores({
  outbox: "key, queuedAt",
});

/** v4：附件表（图片唯一来源，blob 内联；升级只建 store，无数据搬运） */
db.version(4).stores({
  attachments: "id, noteId, createdAt, [noteId+hash]",
});

/**
 * v5：notes 派生索引 cat（notebookId ?? ""）。
 * IndexedDB 索引不收录 null/undefined，「仅未分类」过滤此前只能全表扫描；
 * 派生为空字符串后走索引。cat 由下方 CRUD hook 在所有写入路径自动维护。
 */
db.version(5)
  .stores({
    notes: "id, notebookId, cat, createdAt, updatedAt, pinned",
  })
  .upgrade(async (tx) => {
    await tx
      .table("notes")
      .toCollection()
      .modify((note) => {
        (note as { cat?: string }).cat =
          (note as { notebookId?: string | null }).notebookId ?? "";
      });
  });

// 派生字段维护：cat 只依赖 notebookId，create/update/modify/put 全路径生效。
// hook 订阅者参数类型须与 Dexie 的 TableHooks 声明一致（Object），否则
// 严格函数类型检查下 overload 不匹配
db.notes.hook("creating", (_key: string, note: Note) => {
  (note as Note & { cat?: string }).cat = note.notebookId ?? "";
});
db.notes.hook("updating", (mods: object) => {
  if ("notebookId" in mods) {
    const notebookId = (mods as { notebookId?: string | null }).notebookId;
    if (notebookId !== undefined) {
      return { ...mods, cat: notebookId ?? "" };
    }
  }
});
