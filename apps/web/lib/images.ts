import type { Editor } from "@tiptap/react";
import type { Attachment } from "@quickwiki/shared";
import {
  ATT_BATCH_LIMIT,
  ATT_MAX_ORIGINAL_BYTES,
} from "@quickwiki/shared";
import { useToastStore } from "@/stores/use-toast-store";
import { attachmentRef, attachmentRepo } from "@/lib/data/attachment-repository";
import { readCompressPref } from "@/lib/attachments/prefs";

/**
 * 图片管线：所有插图入口统一「创建附件 → 正文插入引用」。
 * 压缩档（默认）走 canvas → WebP；原图档不压缩直存（≤10MB）。
 * 本地 blob 是唯一真相源；上云仅把 blob 镜像到 Storage（见 sync-engine）。
 */

export const IMAGE_MAX_EDGE = 1600;
export const IMAGE_QUALITY = 0.8;
export const IMAGE_MAX_BYTES = 3 * 1024 * 1024;

export class ImageTooLargeError extends Error {
  constructor(message = "图片压缩后仍超过 3MB，可关闭压缩后重试（原图上限 10MB）") {
    super(message);
    this.name = "ImageTooLargeError";
  }
}

/** SHA-256 hex；环境不支持（非安全上下文）返回空串，去重功能降级 */
export async function sha256Hex(blob: Blob): Promise<string> {
  if (typeof crypto === "undefined" || !crypto.subtle) return "";
  try {
    const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
    return Array.from(new Uint8Array(digest), (b) =>
      b.toString(16).padStart(2, "0")
    ).join("");
  } catch {
    return "";
  }
}

/** data URL → Blob（压缩档产物转二进制落库用） */
export function dataUrlToBlob(dataUrl: string): Blob {
  const [head, payload] = dataUrl.split(",");
  const mime = /data:([^;,]+)/.exec(head)?.[1] ?? "application/octet-stream";
  const bin = atob(payload);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/** data URL 的解码后字节数（base64 → 原始大小） */
export function dataUrlBytes(dataUrl: string): number {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

export async function fileToDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("读取文件失败"));
    reader.readAsDataURL(file);
  });
}

async function loadImageSource(
  file: File
): Promise<{ width: number; height: number; source: CanvasImageSource }> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file);
      return { width: bitmap.width, height: bitmap.height, source: bitmap };
    } catch {
      // 继续走 <img> 回退
    }
  }
  // Safari < 15 等不支持 createImageBitmap 的环境
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("图片加载失败"));
      el.src = url;
    });
    return { width: img.naturalWidth, height: img.naturalHeight, source: img };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function compressOnce(
  file: File,
  maxEdge: number,
  quality: number
): Promise<{ dataUrl: string; width: number; height: number }> {
  const { width, height, source } = await loadImageSource(file);
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  const targetW = Math.max(1, Math.round(width * scale));
  const targetH = Math.max(1, Math.round(height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("当前浏览器不支持 Canvas");
  ctx.drawImage(source, 0, 0, targetW, targetH);

  if (typeof (source as ImageBitmap).close === "function") {
    (source as ImageBitmap).close();
  }

  let dataUrl = canvas.toDataURL("image/webp", quality);
  if (!dataUrl.startsWith("data:image/webp")) {
    // 浏览器不支持 webp 编码（Safari 旧版），回退 jpeg
    dataUrl = canvas.toDataURL("image/jpeg", quality);
  }
  return { dataUrl, width: targetW, height: targetH };
}

/** 压缩图片文件为可内嵌的 data URL；SVG/GIF 小文件原样内嵌 */
export async function compressImageFile(
  file: File
): Promise<{ dataUrl: string; width: number; height: number }> {
  if (file.type === "image/svg+xml" || file.type === "image/gif") {
    if (file.size > IMAGE_MAX_BYTES) throw new ImageTooLargeError();
    const dataUrl = await fileToDataUrl(file);
    return { dataUrl, width: 0, height: 0 };
  }
  if (!file.type.startsWith("image/")) {
    throw new Error(`不支持的文件类型：${file.type || "未知"}`);
  }

  let result = await compressOnce(file, IMAGE_MAX_EDGE, IMAGE_QUALITY);
  if (dataUrlBytes(result.dataUrl) > IMAGE_MAX_BYTES) {
    // 降档重试
    result = await compressOnce(file, 1280, 0.7);
  }
  if (dataUrlBytes(result.dataUrl) > IMAGE_MAX_BYTES) {
    throw new ImageTooLargeError();
  }
  return result;
}

/**
 * 统一插图入口（工具栏/粘贴/拖拽/抽屉共用）：
 * 按压缩偏好创建附件 → 以引用形式插入编辑器。
 * 单个失败弹 toast 不中断其余文件。
 */
export async function insertFilesAsAttachments(
  editor: Editor,
  files: File[],
  noteId: string
): Promise<Attachment[]> {
  const { created } = await createAttachmentsFromFiles(files, noteId, {
    compress: readCompressPref(),
  });
  if (created.length > 0) {
    insertAttachmentIntoEditor(editor, created);
  }
  return created;
}

/** 把已有附件以引用形式插入编辑器（src 为协议串，序列化天然正确） */
export function insertAttachmentIntoEditor(
  editor: Editor,
  atts: Attachment[]
): void {
  for (const att of atts) {
    editor
      .chain()
      .focus()
      .setImage({
        src: attachmentRef(att.id),
        alt: att.filename.replace(/\.[^.]+$/, "") || undefined,
      })
      .run();
  }
}

/** blob → data URL（单文件导出时把引用内嵌回去，保证可移植） */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("读取图片失败"));
    reader.readAsDataURL(blob);
  });
}

// ===== 附件管线：唯一图片来源 =====

/** 读取图片像素尺寸（SVG/GIF 兼容，读不出返回 0） */
export async function readImageSize(
  file: File
): Promise<{ width: number; height: number }> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file);
      const size = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
      return size;
    } catch {
      // SVG 等类型部分浏览器不支持 bitmap，走 <img> 回退
    }
  }
  try {
    const { width, height, source } = await loadImageSource(file);
    if (typeof (source as ImageBitmap).close === "function") {
      (source as ImageBitmap).close();
    }
    return { width, height };
  } catch {
    return { width: 0, height: 0 };
  }
}

/** GIF/SVG 不重编码，两档位都原样存储 */
function isPassthroughType(file: File): boolean {
  return file.type === "image/gif" || file.type === "image/svg+xml";
}

async function createAttachmentFromFile(
  file: File,
  noteId: string,
  compress: boolean
): Promise<Attachment> {
  if (!file.type.startsWith("image/")) {
    throw new Error(`不支持的文件类型：${file.type || "未知"}`);
  }

  let blob: Blob;
  let mime: string;
  let width = 0;
  let height = 0;
  let compressed = false;

  if (compress && !isPassthroughType(file)) {
    const { dataUrl, width: w, height: h } = await compressImageFile(file);
    blob = dataUrlToBlob(dataUrl);
    mime = blob.type || "image/webp";
    width = w;
    height = h;
    compressed = true;
  } else {
    if (file.size > ATT_MAX_ORIGINAL_BYTES) {
      throw new Error("原图超过 10MB 上限");
    }
    blob = file;
    mime = file.type;
    ({ width, height } = await readImageSize(file));
  }

  const hash = await sha256Hex(blob);
  return attachmentRepo.create({
    noteId,
    filename: file.name,
    mime,
    blob,
    width,
    height,
    hash,
    compressed,
  });
}

export interface CreateAttachmentsResult {
  created: Attachment[];
  failed: Array<{ filename: string; reason: string }>;
}

/**
 * 批量创建附件（压缩档/原图档由调用方的开关决定）。
 * 单个失败弹 toast 不中断其余；超出批量上限截断并提示。
 */
export async function createAttachmentsFromFiles(
  files: File[],
  noteId: string,
  opts: { compress: boolean }
): Promise<CreateAttachmentsResult> {
  const result: CreateAttachmentsResult = { created: [], failed: [] };

  let batch = files.filter((f) => f.type.startsWith("image/"));
  if (batch.length > ATT_BATCH_LIMIT) {
    batch = batch.slice(0, ATT_BATCH_LIMIT);
    useToastStore
      .getState()
      .show(`单次最多上传 ${ATT_BATCH_LIMIT} 张，已截取前 ${ATT_BATCH_LIMIT} 张`, "error");
  }

  for (const file of batch) {
    try {
      result.created.push(
        await createAttachmentFromFile(file, noteId, opts.compress)
      );
    } catch (err) {
      const reason = err instanceof Error ? err.message : "上传失败";
      result.failed.push({ filename: file.name, reason });
      useToastStore.getState().show(`${file.name}：${reason}`, "error");
    }
  }
  return result;
}
