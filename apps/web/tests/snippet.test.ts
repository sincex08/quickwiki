import { describe, expect, it } from "vitest";
import {
  literalTerms,
  locateHit,
  makeSnippet,
  splitHighlight,
} from "@/lib/search/snippet";

describe("literalTerms", () => {
  it("整串优先；中文长串追加二元组", () => {
    expect(literalTerms("笔记排序")).toEqual([
      "笔记排序",
      "笔记",
      "记排",
      "排序",
    ]);
  });

  it("空格分词：整串 + 各词", () => {
    expect(literalTerms("react hooks")).toEqual(["react hooks", "react", "hooks"]);
  });

  it("纯拉丁单词不拆二元组，也不重复自身", () => {
    expect(literalTerms("minisearch")).toEqual(["minisearch"]);
  });

  it("空查询返回空数组", () => {
    expect(literalTerms("   ")).toEqual([]);
  });
});

describe("locateHit", () => {
  const text = "前面一些铺垫文字，这里开始讲笔记排序的实现，后面还有别的内容";

  it("整串命中时定位到整串起点", () => {
    expect(locateHit(text, "笔记排序")).toBe(text.indexOf("笔记排序"));
  });

  it("整串不连续出现时退化为最长词项（二元组）定位", () => {
    const split = "笔记的排序";
    expect(locateHit(split, "笔记排序")).toBe(split.indexOf("笔记"));
  });

  it("大小写不敏感", () => {
    expect(locateHit("Hello MiniSearch World", "minisearch")).toBe(6);
  });

  it("无字面命中返回 -1", () => {
    expect(locateHit(text, "zzzz")).toBe(-1);
  });
});

describe("makeSnippet", () => {
  it("以命中点为中心截取，两端按需加省略号", () => {
    const text = `${"前".repeat(200)}关键字${"后".repeat(200)}`;
    const snippet = makeSnippet(text, "关键字", { before: 10, after: 20 })!;
    expect(snippet.startsWith("…")).toBe(true);
    expect(snippet.endsWith("…")).toBe(true);
    expect(snippet).toContain("关键字");
    // 命中点前 10 字 + 命中 3 字 + 后 20 字
    expect(snippet.length).toBe(1 + 10 + 3 + 20 + 1);
  });

  it("命中在文本开头时不加前缀省略号", () => {
    const snippet = makeSnippet("关键字就在开头，后面是正文", "关键字")!;
    expect(snippet.startsWith("…")).toBe(false);
  });

  it("折叠空白：换行与多空格压成单个空格", () => {
    const snippet = makeSnippet("第一行\n\n第二行   关键字   后面", "关键字")!;
    expect(snippet).not.toContain("\n");
    expect(snippet).toContain("第二行 关键字");
  });

  it("无字面命中时退化为开头一段（模糊匹配也能看到概览）", () => {
    const snippet = makeSnippet("甲".repeat(300), "zzz", { fallbackLength: 20 })!;
    expect(snippet).toBe(`${"甲".repeat(20)}…`);
  });

  it("空文本返回 undefined", () => {
    expect(makeSnippet("", "关键字")).toBeUndefined();
    expect(makeSnippet("   ", "关键字")).toBeUndefined();
  });
});

describe("splitHighlight", () => {
  it("把命中片段与普通文本分段", () => {
    const parts = splitHighlight("这是笔记排序的说明", "笔记排序");
    expect(parts).toEqual([
      { text: "这是", match: false },
      { text: "笔记排序", match: true },
      { text: "的说明", match: false },
    ]);
  });

  it("分段拼回原文（不丢字、不改字）", () => {
    const text = "前后关键字中间关键字结尾";
    const parts = splitHighlight(text, "关键字");
    expect(parts.map((p) => p.text).join("")).toBe(text);
    expect(parts.filter((p) => p.match).map((p) => p.text)).toEqual([
      "关键字",
      "关键字",
    ]);
  });

  it("相邻命中会合并成一段", () => {
    const parts = splitHighlight("关键字关键字末尾", "关键字");
    expect(parts).toEqual([
      { text: "关键字关键字", match: true },
      { text: "末尾", match: false },
    ]);
  });

  it("整串命中优先：中文二元组不会把整串的边界切碎", () => {
    const parts = splitHighlight("讲笔记排序", "笔记排序");
    expect(parts).toEqual([
      { text: "讲", match: false },
      { text: "笔记排序", match: true },
    ]);
  });

  it("无命中时整段为普通文本", () => {
    expect(splitHighlight("完全无关的内容", "zzz")).toEqual([
      { text: "完全无关的内容", match: false },
    ]);
  });

  it("空查询 / 空文本的边界处理", () => {
    expect(splitHighlight("正文", "  ")).toEqual([
      { text: "正文", match: false },
    ]);
    expect(splitHighlight("", "关键字")).toEqual([]);
  });
});
