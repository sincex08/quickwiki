import { useEffect, useRef, useState } from "react";
import { subscribe } from "@/lib/events";
import { AUTH_UID_KEY, type AttachmentRecord } from "@/lib/db";
import {
  attachmentRepo,
  attachmentExt,
  parseAttachmentRef,
} from "@/lib/data/attachment-repository";
import { getSupabase } from "@/lib/supabase/client";
import { ATT_PROTOCOL } from "@quickwiki/shared";

/**
 * 附件引用解析：quickwiki-att://<id> → <img> 可用的 src。
 * 优先本地 blob（objectURL，统一缓存防泄漏）；本地缺 blob 时签发
 * Storage 短时效签名 URL 兜底（私有桶），并触发懒下载钩子（由 sync-engine
 * 注册）。data:/https 外部图原样透传（存量兼容）。
 */

/**
 * attId → objectURL 缓存（LRU + 引用计数）。
 * refs > 0 表示仍有 <img>/预览在使用：LRU 淘汰与 releaseAll 都**不** revoke
 * 它——否则大图笔记滚动加载超过容量后，先前的图会悄悄变成裂图
 * （useAttachmentImgSrc 只在 attachments 事件或 src 变化时重解析，不会自愈）。
 */
const objectUrls = new Map<string, { url: string; refs: number }>();
const MAX_CACHED_URLS = 80;

function evictOldest(): void {
  for (const [id, entry] of objectUrls) {
    if (entry.refs > 0) continue; // 使用中的条目跳过，允许短暂超容
    URL.revokeObjectURL(entry.url);
    objectUrls.delete(id);
    return;
  }
  // 全部在使用中：本轮不淘汰，等释放后再收敛
}

/** blob → objectURL 并纳入统一缓存；同 id 重复调用复用（不增加引用） */
export function registerBlobUrl(id: string, blob: Blob): string {
  const existing = objectUrls.get(id);
  if (existing) {
    // 命中时重建插入序（真 LRU）：否则长期驻留的旧条目永不后移，
    // 淘汰时按初始插入序误杀活跃条目
    objectUrls.delete(id);
    objectUrls.set(id, existing);
    return existing.url;
  }
  while (objectUrls.size >= MAX_CACHED_URLS) evictOldest();
  const url = URL.createObjectURL(blob);
  objectUrls.set(id, { url, refs: 0 });
  return url;
}

/** 引用计数 +1：渲染方拿到 url 后调用，卸载/换 src 时配对 release */
export function acquireObjectUrl(id: string): void {
  const entry = objectUrls.get(id);
  if (entry) entry.refs += 1;
}

/** 引用计数 -1：归零后条目留在缓存中，由 LRU 淘汰时才真正 revoke */
export function releaseObjectUrl(id: string): void {
  const entry = objectUrls.get(id);
  if (entry && entry.refs > 0) entry.refs -= 1;
}

/**
 * 释放全部未被引用的 objectURL（切换笔记/卸载编辑器时调用，防内存泄漏）。
 * 使用中的条目（如打开着的 Lightbox/抽屉预览）保留，防止正在显示的图变裂图。
 */
export function releaseAllObjectUrls(): void {
  for (const [id, entry] of objectUrls) {
    if (entry.refs > 0) continue;
    URL.revokeObjectURL(entry.url);
    objectUrls.delete(id);
  }
}

/**
 * 附件在 note-images 桶中的确定性完整路径（与 sync-engine 的上传/清理
 * 约定一致：<uid>/<noteId>/<attId>.<ext>）。取不到登录 uid 时为 null。
 */
function attachmentStoragePath(att: AttachmentRecord): string | null {
  let uid: string | null = null;
  try {
    uid = localStorage.getItem(AUTH_UID_KEY);
  } catch {
    return null;
  }
  if (!uid) return null;
  return `${uid}/${att.noteId}/${att.id}.${attachmentExt(att.mime)}`;
}

/**
 * 附件渲染用兜底 src：私有桶短时效签名 URL（60s）。
 * 无 Supabase 配置/未登录时为 null —— 渲染占位，等懒下载回填。
 */
export async function attachmentSignedUrl(
  att: AttachmentRecord
): Promise<string | null> {
  const sb = getSupabase();
  const path = attachmentStoragePath(att);
  if (!sb || !path) return null;
  const { data, error } = await sb.storage
    .from("note-images")
    .createSignedUrl(path, 60);
  if (error || !data) return null;
  return data.signedUrl;
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
  if (cached) return { src: cached.url, kind: "ready" };

  const record = await attachmentRepo.getRecord(id);
  if (record?.blob) {
    return { src: registerBlobUrl(id, record.blob), kind: "ready" };
  }

  // 本地缺 blob：签发短时效签名 URL 兜底 + 触发懒下载
  notifyBlobMissing(id);
  const fallback = record ? await attachmentSignedUrl(record) : null;
  return { src: fallback, kind: "missing" };
}

/**
 * React 渲染钩子：协议引用异步解析（SSR 安全，初始为占位），
 * 附件变更（懒下载回填/重建）后自动重解析。
 *
 * 引用管理：首次解析到 objectURL 时 acquire 一次并持有到卸载/换 src；
 * 订阅触发的重复 resolve 拿到的是同一 url，不重复计数。
 */
export function useAttachmentImgSrc(src: string | undefined): string | null {
  const isAtt = isAttachmentRef(src);
  const [resolved, setResolved] = useState<string | null>(
    isAtt ? null : src ?? null
  );
  /** 当前持有的引用；null 表示尚未持有（解析未完成或结果非 objectURL） */
  const heldRef = useRef<string | null>(null);

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
    const resolveAndAcquire = () => {
      void resolveAttachmentSrc(src).then((r) => {
        if (!active) return;
        setResolved(r.src);
        if (r.kind === "ready" && !heldRef.current) {
          const id = parseAttachmentRef(src);
          if (id) {
            acquireObjectUrl(id);
            heldRef.current = id;
          }
        }
      });
    };
    resolveAndAcquire();
    const id = parseAttachmentRef(src);
    const unsub = subscribe("attachments", (event) => {
      if (!id || !event.ids.includes(id)) return;
      resolveAndAcquire();
    });
    return () => {
      active = false;
      unsub();
      if (heldRef.current) {
        releaseObjectUrl(heldRef.current);
        heldRef.current = null;
      }
    };
  }, [src]);

  return resolved;
}
