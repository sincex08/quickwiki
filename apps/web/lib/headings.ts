/**
 * Markdown 标题提取：供大纲浮层与预览 [toc] 共用。
 * 只认 ATX 形式（# 开头）的 1-3 级标题，跳过围栏代码块内的 # 行
 * （``` 与 ~~~ 均视为围栏）。
 */

export interface HeadingItem {
  /** 标题级别 1-3 */
  level: number;
  /** 标题文本（去掉首尾 # 与空白） */
  text: string;
  /** 所在行号（0 起，源码模式按行跳转用） */
  line: number;
}

export function extractHeadings(markdown: string): HeadingItem[] {
  const items: HeadingItem[] = [];
  let inFence = false;
  let fenceMark = "";
  markdown.split("\n").forEach((raw, line) => {
    const trimmed = raw.trimStart();
    const fence = trimmed.match(/^(`{3,}|~{3,})/);
    if (fence) {
      if (!inFence) {
        inFence = true;
        fenceMark = fence[1][0];
      } else if (fence[1][0] === fenceMark) {
        inFence = false;
      }
      return;
    }
    if (inFence) return;
    const m = trimmed.match(/^(#{1,3})\s+(.+?)\s*#*\s*$/);
    if (m) items.push({ level: m[1].length, text: m[2], line });
  });
  return items;
}

/**
 * 标题锚点 id：按文本稳定散列，同一文本的多处标题指向同一锚点
 * （滚动到第一处即可，个人笔记中重复标题罕见）。预览渲染与 [toc]
 * 列表两侧用同一函数，保证 id 一致。
 */
export function headingAnchor(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  }
  return `h-${(hash >>> 0).toString(36)}`;
}
