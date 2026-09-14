import { db, type AttachmentRecord } from "@/lib/db";
import { emitChange } from "@/lib/events";
import { newId } from "@/lib/data/repository";
import type { Attachment } from "@quickwiki/shared";
import { ATT_PROTOCOL, ATTACHMENT_MIME_EXT } from "@quickwiki/shared";

/**
 * 附件仓库：附件库是全应用图片的唯一来源。
 * 正文以 ![alt](quickwiki-att://<id>) 引用附件；附件不可变（替换 = 删旧建新），
 * 元数据除 rename 外不就地修改。本地记录含 blob（唯一真相源），云端仅为镜像。
 */

/** 生成正文引用串 */
export function attachmentRef(id: string): string {
  return `${ATT_PROTOCOL}${id}`;
}

/** 解析引用串，返回附件 id；非协议串返回 null */
export function parseAttachmentRef(src: string): string | null {
  return src.startsWith(ATT_PROTOCOL)
    ? src.slice(ATT_PROTOCOL.length)
    : null;
}

/** Storage 对象命名与导出文件名用的扩展名 */
export function attachmentExt(mime: string): string {
  return ATTACHMENT_MIME_EXT[mime] ?? "img";
}

/** 展示名净化：去文件系统非法字符与 Markdown 图片语法保留字符（[ ]），保底「图片」 */
function sanitizeFilename(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|[\]\u0000-\u001f]/g, "")
    .trim()
    .slice(0, 120);
  return cleaned || "图片";
}

export interface CreateAttachmentInput {
  noteId: string;
  /** 原始文件名（仅展示用，内部会净化） */
  filename: string;
  mime: string;
  /** 附件不可变，blob 创建后不再替换 */
  blob: Blob;
  width?: number;
  height?: number;
  /** SHA-256 hex；空串表示环境不支持 */
  hash: string;
  compressed: boolean;
}

export interface AttachmentRepository {
  create(input: CreateAttachmentInput): Promise<Attachment>;
  /** 重命名仅改展示名，正文引用按 id 不受影响 */
  rename(id: string, filename: string): Promise<void>;
  delete(id: string): Promise<void>;
  /** 批量删除（抽屉「清理未引用」用），返回实际删除的 id */
  deleteByIds(ids: string[]): Promise<string[]>;
  /** 删除某笔记全部附件（本地），返回被删 id 列表（供同步墓碑入队） */
  deleteByNote(noteId: string): Promise<string[]>;
  /** 撤销删除：按原记录恢复附件（含 blob），updatedAt 刷新为当前时间 */
  restore(records: AttachmentRecord[]): Promise<void>;
  findById(id: string): Promise<Attachment | null>;
  /** 含 blob 的完整记录（渲染 / 导出 / 同步上传用） */
  getRecord(id: string): Promise<AttachmentRecord | null>;
  /** 含 blob（抽屉缩略图渲染用） */
  listRecordsByNote(noteId: string): Promise<AttachmentRecord[]>;
}

function toMeta(record: AttachmentRecord): Attachment {
  return {
    id: record.id,
    noteId: record.noteId,
    filename: record.filename,
    mime: record.mime,
    size: record.size,
    width: record.width,
    height: record.height,
    hash: record.hash,
    compressed: record.compressed,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    syncVersion: record.syncVersion,
  };
}

class IndexedDBAttachmentRepository implements AttachmentRepository {
  async create(input: CreateAttachmentInput): Promise<Attachment> {
    const id = newId();
    const now = Date.now();
    const record: AttachmentRecord = {
      id,
      noteId: input.noteId,
      filename: sanitizeFilename(input.filename),
      mime: input.mime,
      size: input.blob.size,
      width: input.width ?? 0,
      height: input.height ?? 0,
      hash: input.hash,
      compressed: input.compressed,
      createdAt: now,
      updatedAt: now,
      blob: input.blob,
    };
    await db.attachments.add(record);
    emitChange("attachments", { type: "create", ids: [id] });
    return toMeta(record);
  }

  async rename(id: string, filename: string): Promise<void> {
    const cleaned = sanitizeFilename(filename);
    await db.attachments.update(id, { filename: cleaned, updatedAt: Date.now() });
    emitChange("attachments", { type: "update", ids: [id] });
  }

  async delete(id: string): Promise<void> {
    const existing = await db.attachments.get(id);
    if (!existing) return;
    await db.attachments.delete(id);
    emitChange("attachments", { type: "delete", ids: [id] });
  }

  async deleteByIds(ids: string[]): Promise<string[]> {
    if (ids.length === 0) return [];
    const existing = await db.attachments.bulkGet(ids);
    const present = existing
      .map((r) => r?.id)
      .filter((id): id is string => Boolean(id));
    await db.attachments.bulkDelete(present);
    if (present.length > 0) {
      emitChange("attachments", { type: "delete", ids: present });
    }
    return present;
  }

  async deleteByNote(noteId: string): Promise<string[]> {
    const ids = (await db.attachments
      .where("noteId")
      .equals(noteId)
      .primaryKeys()) as string[];
    if (ids.length > 0) {
      await db.attachments.bulkDelete(ids);
      emitChange("attachments", { type: "delete", ids });
    }
    return ids;
  }

  async restore(records: AttachmentRecord[]): Promise<void> {
    if (records.length === 0) return;
    const existing = await db.attachments.bulkGet(records.map((r) => r.id));
    const missing = records.filter((_, i) => !existing[i]);
    if (missing.length === 0) return;
    await db.attachments.bulkPut(
      missing.map((r) => ({ ...r, updatedAt: Date.now() }))
    );
    emitChange("attachments", { type: "create", ids: missing.map((r) => r.id) });
  }

  async findById(id: string): Promise<Attachment | null> {
    const record = await db.attachments.get(id);
    return record ? toMeta(record) : null;
  }

  async getRecord(id: string): Promise<AttachmentRecord | null> {
    return (await db.attachments.get(id)) ?? null;
  }

  async listRecordsByNote(noteId: string): Promise<AttachmentRecord[]> {
    const rows = await db.attachments
      .where("noteId")
      .equals(noteId)
      .toArray();
    rows.sort(
      (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)
    );
    return rows;
  }
}

export const attachmentRepo: AttachmentRepository =
  new IndexedDBAttachmentRepository();
