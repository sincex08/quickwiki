import type { Note } from "@quickwiki/shared";
import { ATT_PROTOCOL } from "@quickwiki/shared";
import { noteRepo } from "@/lib/data/repository";
import {
  attachmentRepo,
  attachmentExt,
} from "@/lib/data/attachment-repository";
import { blobToDataUrl } from "@/lib/images";

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

/** 导出单篇笔记为 .md 文件：协议引用内嵌回 data URL，保证单文件可移植 */
export async function exportNoteAsMarkdown(note: Note): Promise<void> {
  const content = await inlineAttachmentRefs(note.content);
  const blob = new Blob([`${buildFrontMatter(note)}${content}\n`], {
    type: "text/markdown;charset=utf-8",
  });
  downloadBlob(blob, `${sanitizeFilename(note.title)}.md`);
}

/** quickwiki-att:// 引用串：![alt](quickwiki-att://<uuid>) */
const ATT_REF_RE = new RegExp(
  `!\\[([^\\]]*)\\]\\(${ATT_PROTOCOL.replace(/[-/\\^$*+?.()|[\\]{}]/g, "\\$&")}([^)\\s]+)\\)`,
  "g"
);

/** 把正文中的协议引用解析回 data URL（本地 blob 缺失时保留原样） */
async function inlineAttachmentRefs(markdown: string): Promise<string> {
  if (!markdown.includes(ATT_PROTOCOL)) return markdown;
  const matches = [...markdown.matchAll(ATT_REF_RE)];
  let result = markdown;
  for (const match of matches) {
    const [full, alt, attId] = match;
    const record = await attachmentRepo.getRecord(attId);
    if (!record?.blob) continue;
    const dataUrl = await blobToDataUrl(record.blob);
    // replaceAll：同一引用串可能出现多次，须全部内嵌
    result = result.replaceAll(full, `![${alt}](${dataUrl})`);
  }
  return result;
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
  file(
    path: string,
    data: string | Blob,
    options?: { base64?: boolean }
  ): unknown;
}

/**
 * 把 Markdown 中的图片抽取为 ZIP 内 images/<base>-<n>.<ext> 文件，
 * 返回改写为相对路径后的 Markdown；同一图片（相同附件/相同 data URL）只存一份。
 * 支持两类来源：附件协议引用（blob 取自附件库）、存量 base64 data URL。
 */
async function extractNoteImages(
  markdown: string,
  baseName: string,
  zip: JSZipLike
): Promise<string> {
  const saved = new Map<string, string>();
  let counter = 0;
  let result = markdown;

  // 1) 附件协议引用：blob 从附件库直取
  const attMatches = [...result.matchAll(ATT_REF_RE)];
  for (const match of attMatches) {
    const [full, alt, attId] = match;
    const relPath = saved.get(attId);
    if (relPath) {
      result = result.replaceAll(full, `![${alt}](${relPath})`);
      continue;
    }
    const record = await attachmentRepo.getRecord(attId);
    if (!record?.blob) continue; // 本地缺 blob：保留原样
    counter += 1;
    const ext = attachmentExt(record.mime) === "img" ? extFromFilename(record.filename) : attachmentExt(record.mime);
    const path = `images/${baseName}-${counter}.${ext}`;
    zip.file(path, record.blob);
    saved.set(attId, path);
    result = result.replaceAll(full, `![${alt}](${path})`);
  }

  // 2) 存量 base64 data URL（兼容未被附件库覆盖的旧数据）
  result = result.replace(
    DATA_IMG_RE,
    (_match, alt: string, mimeSub: string, payload: string) => {
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

  return result;
}

/** mime 不在映射表时，从文件名反推扩展名兜底 */
function extFromFilename(filename: string): string {
  const ext = filename.includes(".") ? filename.split(".").pop()! : "";
  return /^[a-z0-9]{1,5}$/i.test(ext) ? ext.toLowerCase() : "img";
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
    const markdown = await extractNoteImages(note.content, stem, zip);
    zip.file(`${stem}.md`, `${buildFrontMatter(note)}${markdown}\n`);
  }

  const blob = await zip.generateAsync({ type: "blob" });
  const date = new Date().toISOString().slice(0, 10);
  downloadBlob(blob, `quickwiki-export-${date}.zip`);
  return notes.length;
}
