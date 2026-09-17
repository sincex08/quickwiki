/**
 * 标签一致性回归：note.tags 与 noteTags/tags 计数器分叉后的自愈。
 * 漂移现场来自旧版 push「整行回写旧快照」——覆盖 note.tags 后，
 * 关系行/计数器成为孤儿，表现为「标签空但计数 1、打不上、删除不清零」。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { noteRepo } from "@/lib/data/repository";
import { reconcileTags } from "@/lib/data/tag-counts";
import type { Note } from "@quickwiki/shared";

let seq = 0;
async function seedNote(overrides: Partial<Note> = {}): Promise<Note> {
  const now = Date.now();
  const note: Note = {
    id: overrides.id ?? `n${seq++}`,
    title: "t",
    titleManual: null,
    content: "c",
    notebookId: null,
    tags: [],
    createdAt: now,
    updatedAt: now,
    pinned: false,
    ...overrides,
  };
  await db.notes.put(note);
  return note;
}

beforeEach(async () => {
  await Promise.all([
    db.notes.clear(),
    db.noteTags.clear(),
    db.tags.clear(),
    db.outbox.clear(),
  ]);
});

describe("update 打标签（关系行已漂移存在）", () => {
  it("不抛约束错误、不重复计数，note.tags 正常写入", async () => {
    await seedNote({ id: "n1", tags: [] });
    await db.noteTags.add({ noteId: "n1", tagName: "已完成" });
    await db.tags.add({ name: "已完成", count: 1 });

    await noteRepo.update("n1", { tags: ["已完成"] });

    expect((await db.notes.get("n1"))!.tags).toEqual(["已完成"]);
    expect(await db.noteTags.get(["n1", "已完成"])).toBeDefined();
    expect((await db.tags.get("已完成"))!.count).toBe(1);
  });

  it("正常加标签仍正确维护关系与计数", async () => {
    await seedNote({ id: "n2", tags: [] });

    await noteRepo.update("n2", { tags: ["重要"] });

    expect(await db.noteTags.get(["n2", "重要"])).toBeDefined();
    expect((await db.tags.get("重要"))!.count).toBe(1);
  });
});

describe("delete 按关系表回收计数", () => {
  it("note.tags 已漂移为空时，删除仍把计数清零", async () => {
    await seedNote({ id: "n3", tags: [] });
    await db.noteTags.add({ noteId: "n3", tagName: "已完成" });
    await db.tags.add({ name: "已完成", count: 1 });

    await noteRepo.delete("n3");

    expect(await db.noteTags.get(["n3", "已完成"])).toBeUndefined();
    // 归零即删除字典项，不再残留永远清不掉的孤儿计数
    expect(await db.tags.get("已完成")).toBeUndefined();
  });
});

describe("reconcileTags 对账", () => {
  it("孤儿计数被清除、缺失的关联与计数被补齐", async () => {
    // 孤儿：note.tags 为空但计数器残留（线上遇到的「卡在 1」状态）
    await seedNote({ id: "n4", tags: [] });
    await db.tags.add({ name: "已完成", count: 1 });
    // 反向缺失：note.tags 有标签但无关系行、无计数
    await seedNote({ id: "n5", tags: ["重要"] });

    const changed = await reconcileTags();

    expect(changed).toBe(true);
    expect(await db.tags.get("已完成")).toBeUndefined();
    expect(await db.noteTags.get(["n5", "重要"])).toBeDefined();
    expect((await db.tags.get("重要"))!.count).toBe(1);
  });

  it("一致的数据零写入（changed=false）", async () => {
    await seedNote({ id: "n6", tags: ["a", "b"] });
    await db.noteTags.bulkAdd([
      { noteId: "n6", tagName: "a" },
      { noteId: "n6", tagName: "b" },
    ]);
    await db.tags.bulkAdd([{ name: "a", count: 1 }, { name: "b", count: 1 }]);

    expect(await reconcileTags()).toBe(false);
    expect((await db.tags.get("a"))!.count).toBe(1);
  });

  it("已删笔记的残留关系行被清理且计数回落", async () => {
    // 笔记已删但关系行残留（带计数）
    await db.noteTags.add({ noteId: "n-gone", tagName: "旧标签" });
    await db.tags.add({ name: "旧标签", count: 1 });

    const changed = await reconcileTags();

    expect(changed).toBe(true);
    expect(await db.noteTags.get(["n-gone", "旧标签"])).toBeUndefined();
    expect(await db.tags.get("旧标签")).toBeUndefined();
  });
});
