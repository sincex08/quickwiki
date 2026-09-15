import { db } from "@/lib/db";
import { normalizeTag } from "@/lib/utils";
import type { NoteTag } from "@quickwiki/shared";

/**
 * 标签字典（tags 表）与「笔记-标签」关联（noteTags 表）的唯一维护入口。
 * repository 的本地 CRUD 与 sync-engine 的远端应用路径都必须经过这里，
 * 否则两条写入路径的标签角标/标签过滤会各自漂移。
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
 * 把一篇笔记的标签从 prev 迁移到 next：diff 出增删，
 * 同步维护 noteTags 行与 tags 计数器。prev/next 均应为 cleanTags 结果。
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
  for (const tagName of added) {
    await db.noteTags.add({ noteId, tagName });
  }
  await incrementTagCounts(added);
  return true;
}

/** 回收一篇笔记的全部 noteTags 行与计数（笔记删除/远端墓碑路径） */
export async function retractNoteTags(
  noteId: string,
  tags: string[]
): Promise<void> {
  await db.noteTags.where("noteId").equals(noteId).delete();
  await decrementTagCounts(tags);
}
