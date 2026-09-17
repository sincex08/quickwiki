/**
 * 预览 URL 协议过滤（noteUrlTransform）的纯函数测试：
 * 定向放行附件协议与存量 data:image，其余交给 react-markdown 默认安全策略。
 */
import { describe, expect, it } from "vitest";
import { noteUrlTransform } from "@/components/editor/url-transform";

describe("noteUrlTransform 协议放行", () => {
  it("放行 quickwiki-att:// 附件协议", () => {
    expect(noteUrlTransform("quickwiki-att://att_123")).toBe(
      "quickwiki-att://att_123"
    );
  });

  it("放行存量 data:image（base64 内容原样返回）", () => {
    const url = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";
    expect(noteUrlTransform(url)).toBe(url);
    expect(noteUrlTransform("DATA:image/jpeg;base64,xyz")).toBe(
      "DATA:image/jpeg;base64,xyz"
    );
  });

  it("拦截 javascript: 等危险协议", () => {
    expect(noteUrlTransform("javascript:alert(1)")).toBe("");
    expect(noteUrlTransform("JAVASCRIPT:alert(1)")).toBe("");
  });

  it("非图片的 data: 不放行（默认策略清空）", () => {
    expect(noteUrlTransform("data:text/html,<b>x</b>")).toBe("");
  });

  it("保留默认允许的 https / http / mailto 与相对路径", () => {
    expect(noteUrlTransform("https://example.com/a.png")).toBe(
      "https://example.com/a.png"
    );
    expect(noteUrlTransform("http://example.com/a.png")).toBe(
      "http://example.com/a.png"
    );
    expect(noteUrlTransform("mailto:a@b.com")).toBe("mailto:a@b.com");
    expect(noteUrlTransform("./local.png")).toBe("./local.png");
  });
});
