import type { Note } from "@quickwiki/shared";
import { noteRepo } from "@/lib/data/repository";

/**
 * 数据导出：单篇 Markdown / 全量 ZIP。
 * 内容即 Markdown（原生存储），导出零转换；jszip 动态 import，不占首屏体积。
 */

/** 生成合法文件名（去掉文件系统不允许的字符） */
function sanitizeFilename(name: string): string {
  return (
    name
      .replace(/[\\/:*?"<>|]/g, "-")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || "无标题"
  );
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // 延迟释放，给浏览器足够时间发起下载
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 导出单篇笔记为 .md 文件（图片保持内嵌 data URL，保证单文件可移植） */
export async function exportNoteAsMarkdown(note: Note): Promise<void> {
  const blob = new Blob([`${buildFrontMatter(note)}${note.content}\n`], {
    type: "text/markdown;charset=utf-8",
  });
  downloadBlob(blob, `${sanitizeFilename(note.title)}.md`);
}

/** 生成 YAML front matter（标题/创建时间/标签），便于导入其他工具 */
function buildFrontMatter(note: Note): string {
  const created = new Date(note.createdAt).toISOString();
  const updated = new Date(note.updatedAt).toISOString();
  const tags = note.tags.map((t) => `  - ${t}`).join("\n");
  return [
    "---",
    `title: ${JSON.stringify(note.title)}`,
    `created: ${created}`,
    `updated: ${updated}`,
    note.tags.length > 0 ? `tags:\n${tags}` : "tags: []",
    "---",
    "",
    "",
  ].join("\n");
}

const MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
};

/** base64 data URL 图片：![alt](data:image/<mime>;base64,<payload>) */
const DATA_IMG_RE =
  /!\[([^\]]*)\]\(data:image\/([a-z+.-]+);base64,([A-Za-z0-9+/=]+)\)/g;

interface JSZipLike {
  file(path: string, data: string, options?: { base64?: boolean }): unknown;
}

/**
 * 把 Markdown 中的 data URL 图片抽取为 ZIP 内 images/<base>-<n>.<ext> 文件，
 * 返回改写为相对路径后的 Markdown；同一图片（相同 data URL）只存一份。
 */
function extractMarkdownImages(
  markdown: string,
  baseName: string,
  zip: JSZipLike
): string {
  const saved = new Map<string, string>();
  let counter = 0;

  return markdown.replace(
    DATA_IMG_RE,
    (match, alt: string, mimeSub: string, payload: string) => {
      const cached = saved.get(payload);
      if (cached) return `![${alt}](${cached})`;

      const mime = `image/${mimeSub}`;
      const ext = MIME_EXT[mime] ?? "img";
      counter += 1;
      const relPath = `images/${baseName}-${counter}.${ext}`;
      // JSZip 原生解码 base64，无需 atob（也避免非 latin1 问题）
      zip.file(relPath, payload, { base64: true });
      saved.set(payload, relPath);
      return `![${alt}](${relPath})`;
    }
  );
}

/** 导出全部笔记为 ZIP（每篇一个 .md，图片抽取到 images/ 目录） */
export async function exportAllAsZip(): Promise<number> {
  const notes = await noteRepo.exportAll();
  if (notes.length === 0) return 0;

  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();

  const usedNames = new Map<string, number>();
  for (const note of notes) {
    const base = sanitizeFilename(note.title);
    // 处理同名笔记：追加序号避免覆盖
    const seen = usedNames.get(base) ?? 0;
    usedNames.set(base, seen + 1);
    const stem = seen === 0 ? base : `${base}-${seen}`;
    const markdown = extractMarkdownImages(note.content, stem, zip);
    zip.file(`${stem}.md`, `${buildFrontMatter(note)}${markdown}\n`);
  }

  const blob = await zip.generateAsync({ type: "blob" });
  const date = new Date().toISOString().slice(0, 10);
  downloadBlob(blob, `quickwiki-export-${date}.zip`);
  return notes.length;
}
