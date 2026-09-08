import type { Editor } from "@tiptap/react";
import { useToastStore } from "@/stores/use-toast-store";

/**
 * 图片管线：客户端压缩后以 data URL 内嵌到 Markdown 内容。
 * 本地优先应用无图床；上云后此层替换为对象存储上传（见 ROADMAP.md）。
 */

export const IMAGE_MAX_EDGE = 1600;
export const IMAGE_QUALITY = 0.8;
export const IMAGE_MAX_BYTES = 3 * 1024 * 1024;

export class ImageTooLargeError extends Error {
  constructor(message = "图片压缩后仍超过 3MB，请插入更小的图片") {
    super(message);
    this.name = "ImageTooLargeError";
  }
}

/** data URL 的解码后字节数（base64 → 原始大小） */
export function dataUrlBytes(dataUrl: string): number {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

export async function fileToDataUrl(file: File): Promise<string> {
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

/** 压缩并插入图片到编辑器；单个失败弹 toast，不中断其余文件 */
export async function insertImageIntoEditor(
  editor: Editor,
  files: File[]
): Promise<void> {
  for (const file of files) {
    try {
      const { dataUrl } = await compressImageFile(file);
      editor
        .chain()
        .focus()
        .setImage({
          src: dataUrl,
          alt: file.name.replace(/\.[^.]+$/, "") || undefined,
        })
        .run();
    } catch (err) {
      const message = err instanceof Error ? err.message : "图片插入失败";
      useToastStore.getState().show(message, "error");
    }
  }
}
