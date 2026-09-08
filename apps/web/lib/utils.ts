import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** 防抖 */
export function debounce<T extends (...args: never[]) => void>(
  fn: T,
  wait: number
): ((...args: Parameters<T>) => void) & { cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const debounced = (...args: Parameters<T>) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
  debounced.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  return debounced;
}

/** Markdown → 纯文本（纯正则、SSR 安全；用于搜索索引、标题与摘要）。
 * 顺序关键：必须先剥图片再处理链接，防止 data URL 进入索引。 */
export function markdownToText(md: string): string {
  if (!md) return "";
  return (
    md
      // ① 代码围栏标记行（保留代码正文）
      .replace(/^```.*$/gm, "")
      // ② 图片（含 data URL；base64 字符集不含 ")"，[^)]* 安全）
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      // ③ 链接 → 保留文字
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]*)\]\[[^\]]*\]/g, "$1")
      // ④ 块级标记
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/^(\s{0,3}>\s?)+/gm, "")
      .replace(/^\s*[-*+]\s+/gm, "")
      .replace(/^\s*\d+[.)]\s+/gm, "")
      .replace(/^\s*\[[ xX]\]\s*/gm, "")
      // 表格分隔行与管道
      .replace(/^\s*\|?\s*:?-{3,}[\s:|-]*$/gm, "")
      .replace(/\|/g, " ")
      // 分隔线
      .replace(/^\s*([-*_])(\s*\1){2,}\s*$/gm, "")
      // ⑤ 行内标记
      .replace(/(\*\*|__)(.+?)\1/g, "$2")
      .replace(/(\*|_)(.+?)\1/g, "$2")
      .replace(/~~(.+?)~~/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      // ⑥ 残留 HTML 标签
      .replace(/<\/?[a-z][^>]*>/gi, "")
      // ⑦ 实体解码（&amp; 最后，避免二次解码）
      .replace(/&nbsp;/g, " ")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, "&")
      // ⑧ 折叠空行
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

/** 从笔记内容（Markdown）提取标题：第一个非空行，截断到 maxLength */
export function extractTitle(content: string, maxLength = 80): string {
  const text = markdownToText(content);
  if (!text) return "无标题";
  const firstLine =
    text
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? "";
  if (!firstLine) return "无标题";
  return firstLine.length > maxLength
    ? `${firstLine.slice(0, maxLength)}…`
    : firstLine;
}

/** 标签规范化：去空白、统一小写 */
export function normalizeTag(tag: string): string {
  return tag.trim().toLowerCase();
}
