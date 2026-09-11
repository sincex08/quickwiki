import { db } from "@/lib/db";
import { emitChange } from "@/lib/events";
import { normalizeTag } from "@/lib/utils";
import type {
  ListFilters,
  Note,
  Notebook,
  Paginated,
  Tag,
} from "@quickwiki/shared";
import { DEFAULT_PAGE_SIZE } from "@quickwiki/shared";

/**
 * Repository 抽象层：组件只依赖接口，不直接依赖 Dexie。
 * Phase 2（云端）切换为 APINoteRepository，Phase 3（桌面）切换为 TauriNoteRepository，
 * 组件代码零改动。
 */

export interface CreateNoteInput {
  title?: string;
  content?: string;
  notebookId?: string | null;
  tags?: string[];
}

export interface NoteCounts {
  all: number;
  byNotebook: Record<string, number>;
}

export interface NoteRepository {
  create(input: CreateNoteInput): Promise<string>;
  update(id: string, updates: Partial<Note>): Promise<void>;
  delete(id: string): Promise<void>;
  findById(id: string): Promise<Note | null>;
  /** 按输入顺序返回（用于保持搜索排名顺序） */
  listByIds(ids: string[]): Promise<Note[]>;
  list(filters?: ListFilters): Promise<Paginated<Note>>;
  /** 全量与分笔记本的笔记数量（侧边栏角标） */
  counts(): Promise<NoteCounts>;
  exportAll(): Promise<Note[]>;
}

export interface NotebookRepository {
  create(name: string, color: string): Promise<string>;
  update(id: string, updates: Partial<Notebook>): Promise<void>;
  delete(id: string): Promise<void>;
  findById(id: string): Promise<Notebook | null>;
  list(): Promise<Notebook[]>;
}

export interface TagRepository {
  /** 按使用次数降序 */
  list(): Promise<Tag[]>;
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function cleanTags(tags: string[] | undefined): string[] {
  if (!tags) return [];
  return Array.from(new Set(tags.map(normalizeTag).filter(Boolean)));
}

/** 标签计数 +1（不存在则创建） */
async function incrementTagCounts(tags: string[]): Promise<void> {
  for (const name of tags) {
    const existing = await db.tags.get(name);
    if (existing) {
      await db.tags.update(name, { count: existing.count + 1 });
    } else {
      await db.tags.add({ name, count: 1 });
    }
  }
}

/** 标签计数 -1（归零则删除字典项） */
async function decrementTagCounts(tags: string[]): Promise<void> {
  for (const name of tags) {
    const existing = await db.tags.get(name);
    if (!existing) continue;
    if (existing.count <= 1) {
      await db.tags.delete(name);
    } else {
      await db.tags.update(name, { count: existing.count - 1 });
    }
  }
}

class IndexedDBNoteRepository implements NoteRepository {
  async create(input: CreateNoteInput): Promise<string> {
    const id = newId();
    const now = Date.now();
    const tags = cleanTags(input.tags);
    const note: Note = {
      id,
      title: input.title?.trim() || "无标题",
      titleManual: null,
      content: input.content ?? "",
      notebookId: input.notebookId ?? null,
      tags,
      createdAt: now,
      updatedAt: now,
      pinned: false,
    };

    await db.transaction("rw", db.notes, db.noteTags, db.tags, async () => {
      await db.notes.add(note);
      for (const tagName of tags) {
        await db.noteTags.add({ noteId: id, tagName });
      }
      await incrementTagCounts(tags);
    });

    emitChange("notes", { type: "create", ids: [id] });
    emitChange("tags", { type: "update", ids: tags });
    return id;
  }

  async update(id: string, updates: Partial<Note>): Promise<void> {
    const existing = await db.notes.get(id);
    if (!existing) return;

    const nextTags =
      updates.tags !== undefined ? cleanTags(updates.tags) : null;

    await db.transaction("rw", db.notes, db.noteTags, db.tags, async () => {
      await db.notes.update(id, { ...updates, updatedAt: Date.now() });

      if (nextTags) {
        const oldTags = existing.tags;
        const removed = oldTags.filter((t) => !nextTags.includes(t));
        const added = nextTags.filter((t) => !oldTags.includes(t));

        if (removed.length > 0) {
          await db.noteTags
            .where("noteId")
            .equals(id)
            .and((row) => removed.includes(row.tagName))
            .delete();
          await decrementTagCounts(removed);
        }
        for (const tagName of added) {
          await db.noteTags.add({ noteId: id, tagName });
        }
        await incrementTagCounts(added);
      }
    });

    emitChange("notes", { type: "update", ids: [id] });
    if (nextTags) {
      emitChange("tags", { type: "update", ids: nextTags });
    }
  }

  async delete(id: string): Promise<void> {
    const existing = await db.notes.get(id);
    if (!existing) return;

    await db.transaction("rw", db.notes, db.noteTags, db.tags, async () => {
      await db.notes.delete(id);
      await db.noteTags.where("noteId").equals(id).delete();
      await decrementTagCounts(existing.tags);
    });

    emitChange("notes", { type: "delete", ids: [id] });
    emitChange("tags", { type: "update", ids: existing.tags });
  }

  async findById(id: string): Promise<Note | null> {
    return (await db.notes.get(id)) ?? null;
  }

  async listByIds(ids: string[]): Promise<Note[]> {
    if (ids.length === 0) return [];
    const notes = await db.notes.bulkGet(ids);
    return notes.filter((n): n is Note => Boolean(n));
  }

  async list(filters: ListFilters = {}): Promise<Paginated<Note>> {
    const limit = filters.limit ?? DEFAULT_PAGE_SIZE;
    const offset = filters.offset ?? 0;

    let rows: Note[];

    if (filters.tag) {
      const tagName = normalizeTag(filters.tag);
      const noteIds = await db.noteTags
        .where("tagName")
        .equals(tagName)
        .primaryKeys()
        .then((keys) => keys.map((k) => k[0] as string));
      rows = noteIds.length > 0 ? await db.notes.bulkGet(noteIds).then(
        (list) => list.filter((n): n is Note => Boolean(n))
      ) : [];
    } else if (filters.notebookId) {
      rows = await db.notes.where("notebookId").equals(filters.notebookId).toArray();
    } else {
      rows = await db.notes.toArray();
    }

    if (filters.pinnedOnly) {
      rows = rows.filter((n) => n.pinned);
    }

    // 置顶优先，其次按更新时间倒序
    rows.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return b.updatedAt - a.updatedAt;
    });

    const total = rows.length;
    const items = rows.slice(offset, offset + limit);
    return { items, total, hasMore: offset + limit < total };
  }

  async exportAll(): Promise<Note[]> {
    return db.notes.toArray();
  }

  async counts(): Promise<NoteCounts> {
    const notes = await db.notes.toArray();
    const byNotebook: Record<string, number> = {};
    for (const note of notes) {
      if (note.notebookId) {
        byNotebook[note.notebookId] = (byNotebook[note.notebookId] ?? 0) + 1;
      }
    }
    return { all: notes.length, byNotebook };
  }
}

class IndexedDBNotebookRepository implements NotebookRepository {
  async create(name: string, color: string): Promise<string> {
    const id = newId();
    const now = Date.now();
    const notebook: Notebook = {
      id,
      name: name.trim() || "未命名笔记本",
      color,
      createdAt: now,
      updatedAt: now,
    };
    await db.notebooks.add(notebook);
    emitChange("notebooks", { type: "create", ids: [id] });
    return id;
  }

  async update(id: string, updates: Partial<Notebook>): Promise<void> {
    await db.notebooks.update(id, { ...updates, updatedAt: Date.now() });
    emitChange("notebooks", { type: "update", ids: [id] });
  }

  async delete(id: string): Promise<void> {
    let affectedIds: string[] = [];
    const movedAt = Date.now();
    await db.transaction("rw", db.notebooks, db.notes, async () => {
      // 删除笔记本时保留笔记，仅移出分类。
      // 注意：必须同时刷新 updatedAt 并以真实 ids 发出变更事件，
      // 否则这些笔记不会进入同步队列，其他设备会残留指向已删除笔记本的分类。
      affectedIds = (await db.notes
        .where("notebookId")
        .equals(id)
        .primaryKeys()) as string[];
      await db.notes
        .where("notebookId")
        .equals(id)
        .modify((note) => {
          note.notebookId = null;
          note.updatedAt = movedAt;
        });
      await db.notebooks.delete(id);
    });
    emitChange("notebooks", { type: "delete", ids: [id] });
    if (affectedIds.length > 0) {
      emitChange("notes", { type: "update", ids: affectedIds });
    }
  }

  async findById(id: string): Promise<Notebook | null> {
    return (await db.notebooks.get(id)) ?? null;
  }

  async list(): Promise<Notebook[]> {
    return db.notebooks.orderBy("createdAt").toArray();
  }
}

class IndexedDBTagRepository implements TagRepository {
  async list(): Promise<Tag[]> {
    const tags = await db.tags.toArray();
    return tags.sort(
      (a, b) => b.count - a.count || a.name.localeCompare(b.name)
    );
  }
}

export const noteRepo: NoteRepository = new IndexedDBNoteRepository();
export const notebookRepo: NotebookRepository = new IndexedDBNotebookRepository();
export const tagRepo: TagRepository = new IndexedDBTagRepository();
