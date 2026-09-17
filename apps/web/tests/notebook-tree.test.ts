import { describe, expect, it } from "vitest";
import {
  notebookAncestors,
  notebookPathLabel,
} from "@/lib/data/notebook-tree";
import type { Notebook } from "@quickwiki/shared";

const nb = (id: string, name: string, parentId: string | null = null): Notebook => ({
  id,
  name,
  color: "#000000",
  parentId,
  createdAt: 0,
  updatedAt: 0,
});

// root ── child ── grand
const notebooks = [
  nb("root", "技术"),
  nb("child", "前端", "root"),
  nb("grand", "构建", "child"),
  nb("other", "生活"),
];

describe("notebookAncestors", () => {
  it("返回「根 → 自身」的完整链", () => {
    expect(notebookAncestors(notebooks, "grand").map((n) => n.id)).toEqual([
      "root",
      "child",
      "grand",
    ]);
  });

  it("顶层笔记本只有自身", () => {
    expect(notebookAncestors(notebooks, "other").map((n) => n.id)).toEqual([
      "other",
    ]);
  });

  it("null / undefined / 不存在的 id 返回空数组", () => {
    expect(notebookAncestors(notebooks, null)).toEqual([]);
    expect(notebookAncestors(notebooks, undefined)).toEqual([]);
    expect(notebookAncestors(notebooks, "missing")).toEqual([]);
  });

  it("父级已不存在时链到此为止（远端可能先同步了删除）", () => {
    const orphan = [nb("child", "前端", "root")];
    expect(notebookAncestors(orphan, "child").map((n) => n.id)).toEqual(["child"]);
  });

  it("数据造环时不死循环（同步层 LWW 可能产生环）", () => {
    const cyclic = [nb("a", "A", "b"), nb("b", "B", "a")];
    const chain = notebookAncestors(cyclic, "a");
    expect(chain.length).toBe(2);
    expect(chain.map((n) => n.id).sort()).toEqual(["a", "b"]);
  });
});

describe("notebookPathLabel", () => {
  it("嵌套时拼成「父 / 子 / 孙」", () => {
    expect(notebookPathLabel(notebooks, "grand")).toBe("技术 / 前端 / 构建");
  });

  it("顶层笔记本就是名字本身", () => {
    expect(notebookPathLabel(notebooks, "root")).toBe("技术");
  });

  it("无法解析时返回空串（由调用方决定显示什么）", () => {
    expect(notebookPathLabel(notebooks, null)).toBe("");
    expect(notebookPathLabel(notebooks, "missing")).toBe("");
  });
});
