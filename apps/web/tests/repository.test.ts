/**
 * repository 核心路径测试：cat 派生索引（Dexie hook 全路径维护）、
 * 「仅未分类」过滤、标签 + 笔记本过滤叠加、counts 语义。
 * 走 fake-indexeddb 真库，验证的是真实 Dexie 行为。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import {
  canSetParent,
  noteRepo,
  notebookRepo,
} from "@/lib/data/repository";
import type { Note } from "@quickwiki/shared";

function catOf(note: Note | undefined): string | undefined {
  return (note as (Note & { cat?: string }) | undefined)?.cat;
}

beforeEach(async () => {
  await Promise.all([
    db.notes.clear(),
    db.notebooks.clear(),
    db.tags.clear(),
    db.noteTags.clear(),
  ]);
});

describe("cat 派生索引（v5 hook）", () => {
  it("create 与 update 全路径维护 cat", async () => {
    const id = await noteRepo.create({ notebookId: null });
    expect(catOf(await db.notes.get(id))).toBe("");

    await noteRepo.update(id, { notebookId: "nb1" });
    expect(catOf(await db.notes.get(id))).toBe("nb1");

    await noteRepo.update(id, { notebookId: null });
    expect(catOf(await db.notes.get(id))).toBe("");
  });

  it("modify 路径（同步引擎归属摘除）同样维护 cat", async () => {
    const id = await noteRepo.create({ notebookId: "nb1" });
    await db.notes
      .where("notebookId")
      .equals("nb1")
      .modify((n) => {
        n.notebookId = null;
        n.updatedAt = Date.now();
      });
    expect(catOf(await db.notes.get(id))).toBe("");
  });
});

describe("list 过滤", () => {
  it("notebookId=none 仅返回未分类（走 cat 索引）", async () => {
    const a = await noteRepo.create({ notebookId: null });
    await noteRepo.create({ notebookId: "nb1" });

    const res = await noteRepo.list({ notebookId: "none" });
    expect(res.total).toBe(1);
    expect(res.items[0]!.id).toBe(a);
  });

  it("标签过滤叠加笔记本过滤（含 none）", async () => {
    const a = await noteRepo.create({ notebookId: "nb1", tags: ["work"] });
    const b = await noteRepo.create({ notebookId: null, tags: ["work"] });
    await noteRepo.create({ notebookId: "nb2", tags: ["life"] });

    expect((await noteRepo.list({ tag: "work" })).total).toBe(2);
    const inNb1 = await noteRepo.list({ tag: "work", notebookId: "nb1" });
    expect(inNb1.total).toBe(1);
    expect(inNb1.items[0]!.id).toBe(a);
    const uncategorized = await noteRepo.list({
      tag: "work",
      notebookId: "none",
    });
    expect(uncategorized.total).toBe(1);
    expect(uncategorized.items[0]!.id).toBe(b);
  });
});

describe("counts", () => {
  it("孤儿笔记本引用不计入 byNotebook，也不计入未分类", async () => {
    const nb1 = await notebookRepo.create({ name: "工作", color: "#f00" });
    await noteRepo.create({ notebookId: nb1 });
    await noteRepo.create({ notebookId: null });
    // 模拟旧数据残留：指向已不存在笔记本的笔记
    await db.notes.put({
      id: "ghost-note",
      title: "t",
      titleManual: null,
      content: "",
      notebookId: "ghost",
      tags: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      pinned: false,
    });

    const counts = await noteRepo.counts();
    expect(counts.all).toBe(3);
    expect(counts.uncategorized).toBe(1);
    expect(counts.byNotebook[nb1]).toBe(1);
    expect(counts.byNotebook["ghost"]).toBeUndefined();
  });

  it("list 与 counts 同口径：笔记本角标数等于列表 total", async () => {
    const nb1 = await notebookRepo.create({ name: "工作", color: "#f00" });
    await noteRepo.create({ notebookId: nb1 });
    await noteRepo.create({ notebookId: nb1 });
    await noteRepo.create({ notebookId: null });

    const counts = await noteRepo.counts();
    const listed = await noteRepo.list({ notebookId: nb1 });
    expect(listed.total).toBe(counts.byNotebook[nb1]);
  });
});

describe("listIndex", () => {
  it("返回轻量行：置顶优先 + 更新时间倒序，不含正文", async () => {
    const a = await noteRepo.create({ title: "a" });
    const b = await noteRepo.create({ title: "b" });
    await noteRepo.update(b, { pinned: true });

    const items = await noteRepo.listIndex();
    expect(items.map((n) => n.id)).toEqual([b, a]);
    expect(items[0]).not.toHaveProperty("content");
    expect(items[0]).toMatchObject({
      id: b,
      title: "b",
      pinned: true,
      notebookId: null,
    });
  });
});

describe("笔记本嵌套", () => {
  it("create 带 parentId；canSetParent 拒绝成环组合", async () => {
    const root = await notebookRepo.create({ name: "root", color: "#f00" });
    const child = await notebookRepo.create({
      name: "child",
      color: "#0f0",
      parentId: root,
    });
    expect((await db.notebooks.get(child))!.parentId).toBe(root);

    expect(await canSetParent(root, child)).toBe(false); // root 挂到 child 下 → 环
    expect(await canSetParent(root, null)).toBe(true);
    expect(await canSetParent(child, root)).toBe(true);
    expect(await canSetParent(root, root)).toBe(false);

    // update 侧兜底：环组合直接抛错
    await expect(
      notebookRepo.update(root, { parentId: child })
    ).rejects.toThrow();
  });

  it("delete：笔记移未分类，子笔记本上移到被删者的父级", async () => {
    const root = await notebookRepo.create({ name: "root", color: "#f00" });
    const mid = await notebookRepo.create({
      name: "mid",
      color: "#0f0",
      parentId: root,
    });
    const child = await notebookRepo.create({
      name: "child",
      color: "#00f",
      parentId: mid,
    });
    await noteRepo.create({ notebookId: mid });

    await notebookRepo.delete(mid);

    expect(await db.notebooks.get(mid)).toBeUndefined();
    expect((await db.notebooks.get(child))!.parentId).toBe(root);
    const note = (await db.notes.toArray())[0]!;
    expect(note.notebookId).toBeNull();
  });
});
