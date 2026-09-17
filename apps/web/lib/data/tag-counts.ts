import { db } from "@/lib/db";
import { normalizeTag } from "@/lib/utils";
import type { NoteTag } from "@quickwiki/shared";

/**
 * 标签字典（tags 表）与「笔记-标签」关联（noteTags 表）的唯一维护入口。
 * repository 的本地 CRUD 与 sync-engine 的远端应用路径都必须经过这里，
 * 否则两条写入路径的标签角标/标签过滤会各自漂移。
 *
 * 不变式（reconcileTags 兜底修复）：
 *   noteTags = notes.tags 的投影；tags.count = noteTags 中该标签的行数。
 */

/** 规范化 + 去重（空串丢弃） */
export function cleanTags(tags: string[] | undefined | null): string[] {
  if (!tags) return [];
  return Array.from(new Set(tags.map(normalizeTag).filter(Boolean)));
}

/** 标签计数 +1（不存在则创建） */
export async function incrementTagCounts(tags: string[]): Promise<void> {
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
export async function decrementTagCounts(tags: string[]): Promise<void> {
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

/**
 * 确保关联行存在；返回是否真的新增（决定是否 +1 计数）。
 * noteTags 主键是 [noteId+tagName]：盲 add 在关系已存在时抛 ConstraintError
 * 并中止整个写事务（连带 note.tags 写入一起回滚，表现为「标签打不上」）。
 */
export async function ensureNoteTag(
  noteId: string,
  tagName: string
): Promise<boolean> {
  if (await db.noteTags.get([noteId, tagName])) return false;
  await db.noteTags.add({ noteId, tagName });
  return true;
}

/**
 * 把一篇笔记的标签从 prev 迁移到 next：diff 出增删，
 * 同步维护 noteTags 行与 tags 计数器。prev/next 均应为 cleanTags 结果。
 * 关联已存在（漂移）时幂等跳过：不抛错、不重复计数，note.tags 由调用方写入收敛。
 */
export async function syncNoteTags(
  noteId: string,
  prev: string[],
  next: string[]
): Promise<boolean> {
  const removed = prev.filter((t) => !next.includes(t));
  const added = next.filter((t) => !prev.includes(t));
  if (removed.length === 0 && added.length === 0) return false;

  if (removed.length > 0) {
    await db.noteTags
      .where("noteId")
      .equals(noteId)
      .and((row: NoteTag) => removed.includes(row.tagName))
      .delete();
    await decrementTagCounts(removed);
  }
  const newlyAdded: string[] = [];
  for (const tagName of added) {
    if (await ensureNoteTag(noteId, tagName)) newlyAdded.push(tagName);
  }
  await incrementTagCounts(newlyAdded);
  return removed.length > 0 || newlyAdded.length > 0;
}

/**
 * 回收一篇笔记的全部 noteTags 行与计数（笔记删除/远端墓碑路径）。
 * 以关系表为事实来源而不是 note.tags：两者分叉时（历史 bug 遗留）
 * 按笔记身上的 tags 回收会漏减，计数器成为永远清不掉的孤儿。
 */
export async function retractNoteTags(noteId: string): Promise<void> {
  const rows = await db.noteTags.where("noteId").equals(noteId).toArray();
  if (rows.length === 0) return;
  await db.noteTags.where("noteId").equals(noteId).delete();
  await decrementTagCounts(rows.map((r) => r.tagName));
}

/**
 * 标签一致性对账：以 notes.tags 为唯一事实，重建 noteTags 关联与 tags 计数器。
 * 修复历史分叉（如旧版 push 回写覆盖 note.tags 后残留的孤儿计数/关系行）。
 * 幂等：无漂移时零写入。返回是否有修正（供调用方决定是否发事件刷新 UI）。
 */
export async function reconcileTags(): Promise<boolean> {
  // 期望态：noteId -> 规范化标签（事务外只读快照）
  const desiredTags = new Map<string, string[]>();
  await db.notes.each((n) => {
    desiredTags.set(n.id, cleanTags(n.tags));
  });

  let changed = false;
  await db.transaction("rw", db.noteTags, db.tags, async () => {
    // 关联对账：删掉孤儿行（笔记已删 / 标签已摘），补建缺失行
    for (const row of await db.noteTags.toArray()) {
      if (desiredTags.get(row.noteId)?.includes(row.tagName)) continue;
      await db.noteTags.delete([row.noteId, row.tagName]);
      changed = true;
    }
    for (const [noteId, tags] of desiredTags) {
      for (const tagName of tags) {
        if (await ensureNoteTag(noteId, tagName)) changed = true;
      }
    }

    // 计数对账：字典计数 = 关联表实际行数；孤儿删除、虚高/虚低修正、缺失补建
    const actual = new Map<string, number>();
    for (const row of await db.noteTags.toArray()) {
      actual.set(row.tagName, (actual.get(row.tagName) ?? 0) + 1);
    }
    for (const tag of await db.tags.toArray()) {
      const want = actual.get(tag.name) ?? 0;
      actual.delete(tag.name);
      if (want === 0) {
        await db.tags.delete(tag.name);
        changed = true;
      } else if (want !== tag.count) {
        await db.tags.update(tag.name, { count: want });
        changed = true;
      }
    }
    for (const [name, count] of actual) {
      await db.tags.add({ name, count });
      changed = true;
    }
  });
  return changed;
}
