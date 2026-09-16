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

describe("手动顺序", () => {
  it("moveBy：相邻交换并整体编号，边界返回 false", async () => {
    for (let i = 0; i < 3; i++) await noteRepo.create({ notebookId: "nb1" });
    const before = (await noteRepo.listIndex())
      .filter((n) => n.notebookId === "nb1")
      .map((n) => n.id);
    expect(before).toHaveLength(3);

    await noteRepo.moveBy(before[0]!, 1);
    const after = (await noteRepo.listIndex())
      .filter((n) => n.notebookId === "nb1")
      .map((n) => n.id);
    expect(after).toEqual([before[1], before[0], before[2]]);

    expect(await noteRepo.moveBy(after[0]!, -1)).toBe(false);
    expect(await noteRepo.moveBy(after[2]!, 1)).toBe(false);
  });

  it("排序不刷新 updatedAt（列表上的相对时间不被排序操作干扰）", async () => {
    for (let i = 0; i < 3; i++) await noteRepo.create({ notebookId: "nb1" });
    // 取当前显示顺序的第一条：创建时间可能同毫秒，不假设「创建顺序 = 显示顺序」
    const first = (await noteRepo.listIndex())[0]!.id;
    const before = (await db.notes.get(first))!.updatedAt;

    expect(await noteRepo.moveBy(first, 1)).toBe(true);

    const after = (await db.notes.get(first))!;
    expect(after.updatedAt).toBe(before);
    expect(after.sortOrder).not.toBeNull();
  });

  it("moveToPosition：把笔记放到容器内指定位置", async () => {
    for (let i = 0; i < 3; i++) await noteRepo.create({ notebookId: "nb1" });
    const start = (await noteRepo.listIndex()).map((n) => n.id); // 当前显示顺序
    const [x, y, z] = start as [string, string, string];

    await noteRepo.moveToPosition(z, "nb1", 0);

    const order = (await noteRepo.listIndex()).map((n) => n.id);
    expect(order).toEqual([z, x, y]);
  });

  it("moveToPosition：跨容器同时改分类，并维护 cat 派生索引", async () => {
    const from = await notebookRepo.create({ name: "from", color: "#111" });
    const to = await notebookRepo.create({ name: "to", color: "#222" });
    const id = await noteRepo.create({ notebookId: from });

    await noteRepo.moveToPosition(id, to, 0);

    const note = (await db.notes.get(id))!;
    expect(note.notebookId).toBe(to);
    expect(catOf(note)).toBe(to);
    expect((await noteRepo.list({ notebookId: "none" })).total).toBe(0);
    expect((await noteRepo.list({ notebookId: to })).total).toBe(1);
  });

  it("resetOrder：清空编号，回到默认排序", async () => {
    const a = await noteRepo.create({ notebookId: null });
    const b = await noteRepo.create({ notebookId: null });
    await noteRepo.moveToPosition(a, null, 1);
    expect((await noteRepo.listIndex())[0]!.id).toBe(b);

    await noteRepo.resetOrder(null);

    const rows = await db.notes.toArray();
    expect(rows.every((r) => r.sortOrder == null)).toBe(true);
    // 默认排序下两者仍在（顺序按时间，创建时间相同则按 id 稳定）
    expect((await noteRepo.listIndex()).map((n) => n.id).sort()).toEqual(
      [a, b].sort()
    );
  });

  it("pinToTop：手动顺序容器里置顶 = 移到最前（pinned 不决定位置）", async () => {
    const a = await noteRepo.create({ notebookId: "nb1" });
    const b = await noteRepo.create({ notebookId: "nb1" });
    await noteRepo.moveToPosition(a, "nb1", 1); // a 落到 b 之后
    expect((await noteRepo.listIndex())[0]!.id).toBe(b);

    await noteRepo.pinToTop(b);

    const top = (await noteRepo.listIndex())[0]!;
    expect(top.id).toBe(b);
    expect(top.pinned).toBe(true);
  });

  it("新建笔记落入已手动排序的容器时置于最前", async () => {
    for (let i = 0; i < 2; i++) await noteRepo.create({ notebookId: "nb1" });
    const ids = (await noteRepo.listIndex()).map((n) => n.id);
    await noteRepo.moveBy(ids[0]!, 1); // 触发该容器进入手动顺序
    const ordered = (await noteRepo.listIndex()).map((n) => n.id);

    const fresh = await noteRepo.create({ notebookId: "nb1" });

    expect((await noteRepo.listIndex())[0]!.id).toBe(fresh);
    const created = (await db.notes.get(fresh))!;
    expect(created.sortOrder).not.toBeNull();
    expect(ordered).toHaveLength(2);
  });
});
