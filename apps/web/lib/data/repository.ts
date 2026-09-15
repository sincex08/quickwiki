import { db } from "@/lib/db";
import { emitChange } from "@/lib/events";
import { normalizeTag } from "@/lib/utils";
import {
  cleanTags,
  incrementTagCounts,
  retractNoteTags,
  syncNoteTags,
} from "@/lib/data/tag-counts";
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

export interface CreateNotebookInput {
  name: string;
  color: string;
  /** 父笔记本（嵌套分组）；null/undefined = 顶层 */
  parentId?: string | null;
}

export interface NoteCounts {
  all: number;
  /** 未分类（不属于任何笔记本）的笔记数 */
  uncategorized: number;
  byNotebook: Record<string, number>;
}

/** 笔记树索引行：侧栏导航用，刻意不含正文以控制内存 */
export interface NoteIndexItem {
  id: string;
  title: string;
  notebookId: string | null;
  tags: string[];
  pinned: boolean;
  updatedAt: number;
}

export interface NoteRepository {
  create(input: CreateNoteInput): Promise<string>;
  update(id: string, updates: Partial<Note>): Promise<void>;
  delete(id: string): Promise<void>;
  /** 撤销删除：按原 id 恢复笔记（含标签关系），updatedAt 刷新为当前时间 */
  restore(note: Note): Promise<void>;
  findById(id: string): Promise<Note | null>;
  /** 按输入顺序返回（用于保持搜索排名顺序） */
  listByIds(ids: string[]): Promise<Note[]>;
  list(filters?: ListFilters): Promise<Paginated<Note>>;
  /** 侧栏树索引：全量笔记的轻量行（不含正文），置顶优先 + 更新时间倒序 */
  listIndex(): Promise<NoteIndexItem[]>;
  /** 全量与分笔记本的笔记数量（侧边栏角标） */
  counts(): Promise<NoteCounts>;
  exportAll(): Promise<Note[]>;
}

export interface NotebookRepository {
  create(input: CreateNotebookInput): Promise<string>;
  update(id: string, updates: Partial<Notebook>): Promise<void>;
  delete(id: string): Promise<void>;
  findById(id: string): Promise<Notebook | null>;
  list(): Promise<Notebook[]>;
}

/**
 * 环检测：把 id 的父级设为 newParentId 是否安全。
 * 沿 newParentId 向上走父链，回到 id 即成环（UI 侧预防 + 写入前兜底）。
 */
export async function canSetParent(
  id: string,
  newParentId: string | null
): Promise<boolean> {
  if (!newParentId) return true;
  if (newParentId === id) return false;
  let cursor = await db.notebooks.get(newParentId);
  while (cursor) {
    const next = cursor.parentId ?? null;
    if (!next) return true;
    if (next === id) return false;
    cursor = await db.notebooks.get(next);
  }
  return true;
}

export interface TagRepository {
  /** 按使用次数降序 */
  list(): Promise<Tag[]>;
}

export function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
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
        const tagsChanged = await syncNoteTags(
          id,
          cleanTags(existing.tags),
          nextTags
        );
        if (!tagsChanged) return;
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
      await retractNoteTags(id, cleanTags(existing.tags));
    });

    emitChange("notes", { type: "delete", ids: [id] });
    emitChange("tags", { type: "update", ids: existing.tags });
  }

  /** 撤销删除：delete 的逆操作。保留原 id/createdAt/syncVersion，
   *  仅刷新 updatedAt（同步层的复活裁决以「本地更新晚于删除意图」为准） */
  async restore(note: Note): Promise<void> {
    if (await db.notes.get(note.id)) return;
    const tags = cleanTags(note.tags);
    const restored: Note = { ...note, tags, updatedAt: Date.now() };

    await db.transaction("rw", db.notes, db.noteTags, db.tags, async () => {
      await db.notes.put(restored);
      for (const tagName of tags) {
        await db.noteTags.put({ noteId: restored.id, tagName });
      }
      await incrementTagCounts(tags);
    });

    emitChange("notes", { type: "create", ids: [restored.id] });
    emitChange("tags", { type: "update", ids: tags });
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
      // 标签与笔记本过滤叠加（含「仅未分类」），否则先选笔记本再点标签时
      // 两枚过滤芯片都在，结果却只按标签跨笔记本过滤
      if (filters.notebookId === "none") {
        rows = rows.filter((n) => n.notebookId == null);
      } else if (filters.notebookId) {
        rows = rows.filter((n) => n.notebookId === filters.notebookId);
      }
    } else if (filters.notebookId === "none") {
      // 仅未分类：派生索引 cat（notebookId ?? ""）——IndexedDB 索引不收录
      // null，直接 equals(null) 查不到任何行，全表扫描也随数据量劣化
      rows = await db.notes.where("cat").equals("").toArray();
    } else if (filters.notebookId) {
      // 与 counts() 同走 cat 派生索引：角标与列表口径一致，不会因
      // notebookId / cat 双索引各自维护而漂移
      rows = await db.notes.where("cat").equals(filters.notebookId).toArray();
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

  async listIndex(): Promise<NoteIndexItem[]> {
    const rows = await db.notes.toArray();
    const items: NoteIndexItem[] = rows.map((n) => ({
      id: n.id,
      title: n.title,
      notebookId: n.notebookId,
      tags: n.tags,
      pinned: n.pinned,
      updatedAt: n.updatedAt,
    }));
    // 与 list() 相同的排序约定：置顶优先，其次更新时间倒序
    items.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return b.updatedAt - a.updatedAt;
    });
    return items;
  }

  async counts(): Promise<NoteCounts> {
    // 走 cat 派生索引的 count 查询，避免随笔记量线性劣化的全表加载。
    // byNotebook 只统计现存笔记本（孤儿引用不入角标，与侧边栏展示一致）
    const [all, uncategorized, notebooks] = await Promise.all([
      db.notes.count(),
      db.notes.where("cat").equals("").count(),
      db.notebooks.toArray(),
    ]);
    const byNotebook: Record<string, number> = {};
    await Promise.all(
      notebooks.map(async (nb) => {
        byNotebook[nb.id] = await db.notes.where("cat").equals(nb.id).count();
      })
    );
    return { all, uncategorized, byNotebook };
  }
}

class IndexedDBNotebookRepository implements NotebookRepository {
  async create(input: CreateNotebookInput): Promise<string> {
    if (input.parentId && !(await db.notebooks.get(input.parentId))) {
      throw new Error("父笔记本不存在");
    }
    const id = newId();
    const now = Date.now();
    const notebook: Notebook = {
      id,
      name: input.name.trim() || "未命名笔记本",
      color: input.color,
      parentId: input.parentId ?? null,
      createdAt: now,
      updatedAt: now,
    };
    await db.notebooks.add(notebook);
    emitChange("notebooks", { type: "create", ids: [id] });
    return id;
  }

  async update(id: string, updates: Partial<Notebook>): Promise<void> {
    if (updates.parentId && !(await canSetParent(id, updates.parentId))) {
      throw new Error("不能把笔记本移动到它自己或它的子级之下");
    }
    await db.notebooks.update(id, { ...updates, updatedAt: Date.now() });
    emitChange("notebooks", { type: "update", ids: [id] });
  }

  async delete(id: string): Promise<void> {
    let affectedNoteIds: string[] = [];
    let childIds: string[] = [];
    const movedAt = Date.now();
    await db.transaction("rw", db.notebooks, db.notes, async () => {
      // 笔记保留，仅移出分类。
      // 注意：必须同时刷新 updatedAt 并以真实 ids 发出变更事件，
      // 否则这些笔记不会进入同步队列，其他设备会残留指向已删除笔记本的分类。
      affectedNoteIds = (await db.notes
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
      // 子笔记本上移到被删者的父级（根则变根），避免整棵子树不可达；
      // 同样刷新 updatedAt 以进入同步队列推平其他设备
      const target = await db.notebooks.get(id);
      const parentId = target?.parentId ?? null;
      const children = await db.notebooks
        .filter((nb) => nb.parentId === id)
        .toArray();
      childIds = children.map((c) => c.id);
      for (const child of children) {
        await db.notebooks.update(child.id, { parentId, updatedAt: movedAt });
      }
      await db.notebooks.delete(id);
    });
    emitChange("notebooks", { type: "delete", ids: [id] });
    if (childIds.length > 0) {
      emitChange("notebooks", { type: "update", ids: childIds });
    }
    if (affectedNoteIds.length > 0) {
      emitChange("notes", { type: "update", ids: affectedNoteIds });
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
