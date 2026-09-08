/**
 * Markdown 块切分：把原始 Markdown 按「可独立编辑的块」拆分，
 * 每块保留精确源码（供块级混合编辑模式使用）。
 *
 * 规则：
 * - 空行分块；
 * - 代码围栏（``` / ~~~）整块保留；
 * - 表格（连续 | 行，含分隔行）整块保留；
 * - 列表/引用/段落的连续行（无空行间隔）属于同一块。
 */

export function splitMarkdownBlocks(md: string): string[] {
  const lines = md.split("\n");
  const blocks: string[] = [];
  let current: string[] = [];
  let fence: "```" | "~~~" | null = null;
  let inTable = false;

  const flush = () => {
    if (current.length > 0 && current.some((l) => l.trim() !== "")) {
      blocks.push(current.join("\n"));
    }
    current = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (fence) {
      current.push(line);
      if (trimmed.startsWith(fence)) {
        fence = null;
        flush();
      }
      continue;
    }

    if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
      flush();
      fence = trimmed.startsWith("```") ? "```" : "~~~";
      current.push(line);
      continue;
    }

    const isTableLine = trimmed.startsWith("|");
    if (inTable) {
      if (isTableLine) {
        current.push(line);
        continue;
      }
      inTable = false;
      flush();
    }
    if (isTableLine) {
      flush();
      inTable = true;
      current.push(line);
      continue;
    }

    if (trimmed === "") {
      flush();
      continue;
    }

    current.push(line);
  }
  flush();
  return blocks;
}

/** 重组：块间以空行连接，去除块首尾空白（标准化间隔） */
export function joinMarkdownBlocks(blocks: string[]): string {
  return blocks
    .map((b) => b.replace(/^\s+/, "").replace(/\s+$/, ""))
    .filter((b) => b !== "")
    .join("\n\n");
}
