import { describe, expect, it } from "vitest";
import { countWords } from "@/lib/word-count";
import { extractHeadings, headingAnchor } from "@/lib/headings";

describe("countWords", () => {
  it("中文字符逐个计数", () => {
    expect(countWords("你好世界").total).toBe(4);
    expect(countWords("你好世界").chinese).toBe(4);
  });

  it("英文按单词计数，数字与连字符归属单词", () => {
    const r = countWords("hello world foo-bar v2");
    expect(r.words).toBe(4);
    expect(r.total).toBe(4);
  });

  it("中英混排相加，空白不计", () => {
    const r = countWords("标题 title\n\n正文 body 123");
    expect(r.chinese).toBe(4);
    expect(r.words).toBe(3); // title / body / 123
    expect(r.total).toBe(7);
    expect(r.chars).toBe("标题title正文body123".length);
  });

  it("空串与纯空白为零", () => {
    expect(countWords("")).toEqual({ total: 0, chinese: 0, words: 0, chars: 0 });
    expect(countWords("  \n\t ").chars).toBe(0);
  });
});

describe("extractHeadings", () => {
  it("提取 1-3 级标题并记录行号，忽略 4 级以上", () => {
    const md = "# 一\n\ntext\n### 三\n#### 四\n## 二";
    expect(extractHeadings(md)).toEqual([
      { level: 1, text: "一", line: 0 },
      { level: 3, text: "三", line: 3 },
      { level: 2, text: "二", line: 5 },
    ]);
  });

  it("围栏代码块内的 # 行不计入", () => {
    const md = "# 真标题\n```bash\n# 这是注释\n```\n~~~\n# 也是注释\n~~~\n## 尾标题";
    const items = extractHeadings(md);
    expect(items.map((h) => h.text)).toEqual(["真标题", "尾标题"]);
  });

  it("去掉行尾闭合井号与首尾空白", () => {
    expect(extractHeadings("##  标题 ##  ")[0]).toEqual({
      level: 2,
      text: "标题",
      line: 0,
    });
  });

  it("无空格的 # 行与空串不误判", () => {
    expect(extractHeadings("#标签不是标题")).toEqual([]);
    expect(extractHeadings("")).toEqual([]);
  });
});

describe("headingAnchor", () => {
  it("同文本得到稳定相同 id，不同文本不同", () => {
    expect(headingAnchor("用法")).toBe(headingAnchor("用法"));
    expect(headingAnchor("用法")).not.toBe(headingAnchor("安装"));
  });

  it("id 以 h- 开头且不含特殊字符", () => {
    expect(headingAnchor("C++ 指南/用法")).toMatch(/^h-[a-z0-9]+$/);
  });
});
