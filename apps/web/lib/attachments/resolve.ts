import { useEffect, useState } from "react";
import { subscribe } from "@/lib/events";
import { AUTH_UID_KEY, type AttachmentRecord } from "@/lib/db";
import {
  attachmentRepo,
  attachmentExt,
  parseAttachmentRef,
} from "@/lib/data/attachment-repository";
import { ATT_PROTOCOL } from "@quickwiki/shared";

/**
 * 附件引用解析：quickwiki-att://<id> → <img> 可用的 src。
 * 优先本地 blob（objectURL，统一缓存防泄漏）；本地缺 blob 时回退
 * Storage 确定性公开 URL，并触发懒下载钩子（由 sync-engine 注册）。
 * data:/https 外部图原样透传（存量兼容）。
 */

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(
  /\/+$/,
  ""
);

/** attId → objectURL 缓存（LRU，容量上限后回收最旧） */
const objectUrls = new Map<string, string>();
const MAX_CACHED_URLS = 80;

function evictOldest(): void {
  const oldest = objectUrls.keys().next();
  if (oldest.done) return;
  URL.revokeObjectURL(objectUrls.get(oldest.value)!);
  objectUrls.delete(oldest.value);
}

/** blob → objectURL 并纳入统一缓存；同 id 重复调用复用 */
export function registerBlobUrl(id: string, blob: Blob): string {
  const existing = objectUrls.get(id);
  if (existing) return existing;
  while (objectUrls.size >= MAX_CACHED_URLS) evictOldest();
  const url = URL.createObjectURL(blob);
  objectUrls.set(id, url);
  return url;
}

/** 释放全部 objectURL（切换笔记/卸载编辑器时调用，防内存泄漏） */
export function releaseAllObjectUrls(): void {
  for (const url of objectUrls.values()) URL.revokeObjectURL(url);
  objectUrls.clear();
}

/** 附件确定性公开 URL（无 Supabase 配置/未登录时为 null） */
export function attachmentPublicUrl(att: AttachmentRecord): string | null {
  if (!SUPABASE_URL) return null;
  let uid: string | null = null;
  try {
    uid = localStorage.getItem(AUTH_UID_KEY);
  } catch {
    return null;
  }
  if (!uid) return null;
  const path = `${uid}/${att.noteId}/${att.id}.${attachmentExt(att.mime)}`;
  return `${SUPABASE_URL}/storage/v1/object/public/note-images/${path}`;
}

export type ResolvedKind = "external" | "ready" | "missing";

export interface ResolvedSrc {
  /** <img> 可用 src；附件缺失且无回退时为 null */
  src: string | null;
  kind: ResolvedKind;
}

// ---------- 懒下载钩子（阶段 4 由 sync-engine 注册） ----------

let blobMissingHandler: ((id: string) => void) | null = null;

/** 注册「本地缺 blob」回调（懒下载入口）；重复注册覆盖 */
export function setBlobMissingHandler(fn: (id: string) => void): void {
  blobMissingHandler = fn;
}

function notifyBlobMissing(id: string): void {
  try {
    blobMissingHandler?.(id);
  } catch (err) {
    console.error("blob missing handler error", err);
  }
}

// ---------- 解析 ----------

export function isAttachmentRef(src: string | undefined | null): boolean {
  return !!src && src.startsWith(ATT_PROTOCOL);
}

export async function resolveAttachmentSrc(
  src: string
): Promise<ResolvedSrc> {
  if (!isAttachmentRef(src)) return { src, kind: "external" };

  const id = parseAttachmentRef(src)!;
  const cached = objectUrls.get(id);
  if (cached) return { src: cached, kind: "ready" };

  const record = await attachmentRepo.getRecord(id);
  if (record?.blob) {
    return { src: registerBlobUrl(id, record.blob), kind: "ready" };
  }

  // 本地缺 blob：回退公开 URL + 触发懒下载
  notifyBlobMissing(id);
  const fallback = record ? attachmentPublicUrl(record) : null;
  return { src: fallback, kind: "missing" };
}

/**
 * React 渲染钩子：协议引用异步解析（SSR 安全，初始为占位），
 * 附件变更（懒下载回填/重建）后自动重解析。
 */
export function useAttachmentImgSrc(src: string | undefined): string | null {
  const isAtt = isAttachmentRef(src);
  const [resolved, setResolved] = useState<string | null>(
    isAtt ? null : src ?? null
  );

  useEffect(() => {
    if (!src) {
      setResolved(null);
      return;
    }
    if (!src.startsWith(ATT_PROTOCOL)) {
      setResolved(src);
      return;
    }
    let active = true;
    void resolveAttachmentSrc(src).then((r) => {
      if (active) setResolved(r.src);
    });
    return () => {
      active = false;
    };
  }, [src]);

  useEffect(() => {
    if (!isAtt || !src) return;
    const id = parseAttachmentRef(src)!;
    const unsub = subscribe("attachments", (event) => {
      if (!event.ids.includes(id)) return;
      void resolveAttachmentSrc(src).then((r) => setResolved(r.src));
    });
    return unsub;
  }, [src, isAtt]);

  return resolved;
}
