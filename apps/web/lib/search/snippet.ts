/**
 * 搜索结果的摘要与关键字高亮（纯函数，便于单测）。
 *
 * 与索引分词（`search-manager` 的 CJK 二元组）刻意分离：
 * 索引分词决定「命中」，这里决定「怎么展示」——
 * 展示优先按**字面整串**定位，这样高亮出来的片段与用户输入一致；
 * 中文长串再补二元组，保证「关键词被拆开出现」时仍能标出命中处。
 */

/** 高亮分段：连续的同性质字符合成一段 */
export interface HighlightPart {
  text: string;
  match: boolean;
}

export interface SnippetOptions {
  /** 命中点之前保留的字符数 */
  before?: number;
  /** 命中点之后保留的字符数（比 before 长，多给一点后文语境） */
  after?: number;
  /** 完全没命中时截断到多少字 */
  fallbackLength?: number;
}

/** 把查询拆成用于字面匹配的词项：整串优先，其次按空格拆词 / 中文二元组 */
export function literalTerms(query: string): string[] {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const terms = [trimmed];
  const push = (t: string) => {
    if (t && !terms.includes(t)) terms.push(t);
  };
  if (/\s/.test(trimmed)) {
    for (const word of trimmed.split(/\s+/)) push(word);
  } else if (!/^[a-z0-9]+$/i.test(trimmed) && trimmed.length >= 2) {
    // 中文等非拉丁串：追加二元组，「关键词不连续出现」时也能标出命中片段
    for (let i = 0; i < trimmed.length - 1; i++) push(trimmed.slice(i, i + 2));
  }
  return terms;
}

/** 折叠空白，让摘要在一行内可读（换行/多空格会被压成单个空格） */
function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** 命中位置与命中片段长度 */
export interface MatchLocation {
  pos: number;
  length: number;
}

/**
 * 定位最佳命中：整串优先，其次最长的词项。
 * 返回 null 表示文本里找不到字面命中（可能是模糊/前缀匹配命中）。
 */
export function locateMatch(
  text: string,
  query: string
): MatchLocation | null {
  const terms = literalTerms(query);
  if (!text || terms.length === 0) return null;
  const lower = text.toLowerCase();
  for (const term of [...terms].sort((a, b) => b.length - a.length)) {
    const pos = lower.indexOf(term.toLowerCase());
    if (pos >= 0) return { pos, length: term.length };
  }
  return null;
}

/** 命中下标（需要片段长度时用 locateMatch）；-1 = 无字面命中 */
export function locateHit(text: string, query: string): number {
  return locateMatch(text, query)?.pos ?? -1;
}

/**
 * 生成命中摘要：命中片段前后各取一段上下文，两端按需加省略号。
 * 找不到字面命中时退化为「开头一段」——模糊匹配的用户也能看到内容概览。
 */
export function makeSnippet(
  text: string,
  query: string,
  options: SnippetOptions = {}
): string | undefined {
  const { before = 30, after = 90, fallbackLength = 120 } = options;
  const flat = collapse(text ?? "");
  if (!flat) return undefined;

  const hit = locateMatch(flat, query);
  if (!hit) {
    return flat.length > fallbackLength
      ? `${flat.slice(0, fallbackLength)}…`
      : flat;
  }
  const start = Math.max(0, hit.pos - before);
  const end = Math.min(flat.length, hit.pos + hit.length + after);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < flat.length ? "…" : "";
  return `${prefix}${flat.slice(start, end)}${suffix}`;
}

/**
 * 把文本切成「命中 / 未命中」的分段，供 UI 渲染高亮。
 * 长词优先标记，避免二元组把整串命中的边界切碎；不修改原文本。
 */
export function splitHighlight(text: string, query: string): HighlightPart[] {
  if (!text) return [];
  const terms = literalTerms(query).sort((a, b) => b.length - a.length);
  if (terms.length === 0) return [{ text, match: false }];

  const lower = text.toLowerCase();
  // toLowerCase 在个别 Unicode 上会改变长度，此时下标会错位；退化为大小写敏感匹配
  const haystack = lower.length === text.length ? lower : text;
  const flags = new Array<boolean>(text.length).fill(false);

  for (const term of terms) {
    const needle = haystack === lower ? term.toLowerCase() : term;
    let from = 0;
    for (;;) {
      const pos = haystack.indexOf(needle, from);
      if (pos < 0) break;
      for (let i = pos; i < pos + needle.length && i < flags.length; i++) {
        flags[i] = true;
      }
      from = pos + needle.length;
    }
  }

  const parts: HighlightPart[] = [];
  let i = 0;
  while (i < text.length) {
    const match = flags[i]!;
    let j = i;
    while (j < text.length && flags[j] === match) j++;
    parts.push({ text: text.slice(i, j), match });
    i = j;
  }
  return parts;
}
