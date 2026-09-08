import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase/client";
import { db } from "@/lib/db";
import { emitChange, subscribe } from "@/lib/events";
import { debounce } from "@/lib/utils";
import type { Note, Notebook } from "@quickwiki/shared";

/**
 * 云同步引擎（Supabase 验证阶段）。
 *
 * 模型：IndexedDB 仍为主存储（离线可用），Supabase 为同步对等端。
 * - push：本地 outbox 队列 → 服务端；条件更新实现 LWW（.lte updated_at）
 * - pull：updated_at > cursor 增量拉取；墓碑（deleted_at）删除本地
 * - 冲突：Last-Write-Wins；本地较旧的脏数据被远端覆盖（LWW 固有语义）
 * - 图片：push 时把正文 data URL 上传到 Storage 并改写为公开链接（仅服务端副本）
 *
 * 已知限制（验证阶段）：客户端时钟做 LWW 比较，跨设备时钟偏差会影响胜负。
 */

export type SyncStatus =
  | "disabled" // 未配置 Supabase
  | "signed-out" // 已配置但未登录
  | "idle"
  | "syncing"
  | "error";

export interface SyncState {
  status: SyncStatus;
  lastSyncAt: number | null;
  error: string | null;
  userId: string | null;
  userEmail: string | null;
}

let state: SyncState = {
  status: "disabled",
  lastSyncAt: null,
  error: null,
  userId: null,
  userEmail: null,
};
const listeners = new Set<(s: SyncState) => void>();

export function getSyncState(): SyncState {
  return state;
}

export function subscribeSync(fn: (s: SyncState) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function setState(patch: Partial<SyncState>) {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn(state));
}

/** 应用远端数据到本地时置位，避免事件回流再次入队造成循环 */
let applyingRemote = false;

const scheduleSync = debounce(() => {
  void syncNow();
}, 5000);

// ---------- 初始化 ----------

let initialized = false;

export async function initSync(): Promise<void> {
  if (initialized) return;
  initialized = true;

  const sb = getSupabase();
  if (!sb) {
    setState({ status: "disabled" });
    return;
  }

  const { data } = await sb.auth.getSession();
  setState({
    userId: data.session?.user.id ?? null,
    userEmail: data.session?.user.email ?? null,
  });

  sb.auth.onAuthStateChange((_ev, session) => {
    setState({
      userId: session?.user.id ?? null,
      userEmail: session?.user.email ?? null,
    });
    if (session?.user.id) {
      void syncNow();
    } else {
      setState({ status: "signed-out" });
    }
  });

  subscribe("notes", (e) => {
    if (applyingRemote) return;
    void enqueue("note", e.ids, e.type === "delete");
    scheduleSync();
  });
  subscribe("notebooks", (e) => {
    if (applyingRemote) return;
    void enqueue("notebook", e.ids, e.type === "delete");
    scheduleSync();
  });

  if (typeof window !== "undefined") {
    window.addEventListener("online", () => void syncNow());
  }

  if (state.userId) {
    void syncNow();
  } else {
    setState({ status: "signed-out" });
  }
}

async function enqueue(
  kind: "note" | "notebook",
  ids: string[],
  deleted: boolean
): Promise<void> {
  if (ids.length === 0) return;
  await db.outbox.bulkPut(
    ids.map((id) => ({
      key: `${kind}:${id}`,
      kind,
      entityId: id,
      deleted,
      queuedAt: Date.now(),
    }))
  );
}

// ---------- 同步主流程 ----------

export async function syncNow(): Promise<void> {
  const sb = getSupabase();
  if (!sb) {
    setState({ status: "disabled" });
    return;
  }
  if (!state.userId) {
    setState({ status: "signed-out" });
    return;
  }
  setState({ status: "syncing", error: null });
  try {
    await push(sb);
    await pull(sb);
    setState({ status: "idle", lastSyncAt: Date.now() });
  } catch (e) {
    setState({
      status: "error",
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

async function push(sb: SupabaseClient): Promise<void> {
  const entries = await db.outbox.orderBy("queuedAt").toArray();
  for (const entry of entries) {
    if (entry.kind === "note") {
      await pushNote(sb, entry.entityId, entry.deleted);
    } else {
      await pushNotebook(sb, entry.entityId, entry.deleted);
    }
    await db.outbox.delete(entry.key);
  }
}

async function pushNote(
  sb: SupabaseClient,
  id: string,
  deleted: boolean
): Promise<void> {
  const userId = state.userId!;
  const note = await db.notes.get(id);

  if (deleted || !note) {
    await sb
      .from("notes")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id)
      .eq("user_id", userId);
    return;
  }

  const content = await uploadEmbeddedImages(sb, note);
  const row = {
    id: note.id,
    user_id: userId,
    notebook_id: note.notebookId,
    title: note.title,
    title_manual: note.titleManual,
    content,
    tags: note.tags,
    pinned: note.pinned,
    created_at: new Date(note.createdAt).toISOString(),
    updated_at: new Date(note.updatedAt).toISOString(),
  };

  // 条件更新：仅当服务端版本不新于本地时覆盖（LWW）
  const updated = await sb
    .from("notes")
    .update(row)
    .eq("id", id)
    .lte("updated_at", row.updated_at)
    .select();
  if (updated.error) throw new Error(updated.error.message);
  if (updated.data && updated.data.length > 0) return;

  // 0 行受影响：行不存在（插入）或远端更新（远端胜出，回填本地）
  const remote = await sb
    .from("notes")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (remote.error) throw new Error(remote.error.message);
  if (!remote.data) {
    const ins = await sb.from("notes").insert(row);
    if (ins.error) throw new Error(ins.error.message);
    return;
  }
  await applyRemoteNote(remote.data as RemoteNote);
}

async function pushNotebook(
  sb: SupabaseClient,
  id: string,
  deleted: boolean
): Promise<void> {
  const userId = state.userId!;
  const nb = await db.notebooks.get(id);

  if (deleted || !nb) {
    await sb
      .from("notebooks")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id)
      .eq("user_id", userId);
    return;
  }

  const row = {
    id: nb.id,
    user_id: userId,
    name: nb.name,
    color: nb.color,
    created_at: new Date(nb.createdAt).toISOString(),
    updated_at: new Date(nb.updatedAt).toISOString(),
  };

  const updated = await sb
    .from("notebooks")
    .update(row)
    .eq("id", id)
    .lte("updated_at", row.updated_at)
    .select();
  if (updated.error) throw new Error(updated.error.message);
  if (updated.data && updated.data.length > 0) return;

  const remote = await sb
    .from("notebooks")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (remote.error) throw new Error(remote.error.message);
  if (!remote.data) {
    const ins = await sb.from("notebooks").insert(row);
    if (ins.error) throw new Error(ins.error.message);
    return;
  }
  await applyRemoteNotebook(remote.data as RemoteNotebook);
}

// ---------- 拉取 ----------

interface RemoteNote {
  id: string;
  notebook_id: string | null;
  title: string;
  title_manual: string | null;
  content: string;
  tags: string[];
  pinned: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface RemoteNotebook {
  id: string;
  name: string;
  color: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

async function pull(sb: SupabaseClient): Promise<void> {
  const userId = state.userId!;
  const cursorKey = `sync.lastPull:${userId}`;
  const meta = await db.meta.get(cursorKey);
  const cursor = typeof meta?.value === "number" ? meta.value : 0;
  const since = new Date(cursor).toISOString();

  const notesRes = await sb
    .from("notes")
    .select("*")
    .eq("user_id", userId)
    .gt("updated_at", since);
  if (notesRes.error) throw new Error(notesRes.error.message);
  for (const row of (notesRes.data ?? []) as RemoteNote[]) {
    await applyRemoteNote(row);
  }

  const nbsRes = await sb
    .from("notebooks")
    .select("*")
    .eq("user_id", userId)
    .gt("updated_at", since);
  if (nbsRes.error) throw new Error(nbsRes.error.message);
  for (const row of (nbsRes.data ?? []) as RemoteNotebook[]) {
    await applyRemoteNotebook(row);
  }

  await db.meta.put({ key: cursorKey, value: Date.now() });
}

async function applyRemoteNote(row: RemoteNote): Promise<void> {
  applyingRemote = true;
  try {
    if (row.deleted_at) {
      // 墓碑：删除本地（删除胜出），并清除本地待推送记录
      await db.notes.delete(row.id);
      await db.outbox.delete(`note:${row.id}`);
      emitChange("notes", { type: "delete", ids: [row.id] });
      return;
    }
    const local = await db.notes.get(row.id);
    const remoteUpdated = new Date(row.updated_at).getTime();
    // 本地更新且有待推送修改 → 本地胜出，等 push 处理
    if (local && local.updatedAt > remoteUpdated) {
      const pending = await db.outbox.get(`note:${row.id}`);
      if (pending) return;
    }
    const note: Note = {
      id: row.id,
      title: row.title,
      titleManual: row.title_manual,
      content: row.content,
      notebookId: row.notebook_id,
      tags: row.tags ?? [],
      createdAt: new Date(row.created_at).getTime(),
      updatedAt: remoteUpdated,
      pinned: row.pinned,
    };
    await db.notes.put(note);
    emitChange("notes", { type: "update", ids: [row.id] });
  } finally {
    applyingRemote = false;
  }
}

async function applyRemoteNotebook(row: RemoteNotebook): Promise<void> {
  applyingRemote = true;
  try {
    if (row.deleted_at) {
      await db.notebooks.delete(row.id);
      await db.outbox.delete(`notebook:${row.id}`);
      emitChange("notebooks", { type: "delete", ids: [row.id] });
      return;
    }
    const local = await db.notebooks.get(row.id);
    const remoteUpdated = new Date(row.updated_at).getTime();
    if (local && local.updatedAt > remoteUpdated) {
      const pending = await db.outbox.get(`notebook:${row.id}`);
      if (pending) return;
    }
    const nb: Notebook = {
      id: row.id,
      name: row.name,
      color: row.color,
      createdAt: new Date(row.created_at).getTime(),
      updatedAt: remoteUpdated,
    };
    await db.notebooks.put(nb);
    emitChange("notebooks", { type: "update", ids: [row.id] });
  } finally {
    applyingRemote = false;
  }
}

// ---------- 图片上传 ----------

const DATA_IMG_RE =
  /!\[([^\]]*)\]\(data:image\/([a-z+.-]+);base64,([A-Za-z0-9+/=]+)\)/g;

const MIME_EXT: Record<string, string> = {
  png: "png",
  jpeg: "jpg",
  webp: "webp",
  gif: "gif",
  "svg+xml": "svg",
};

/** dataUrl → 公开 URL 的本地缓存（持久化在 meta，避免重复上传） */
async function getImageMap(): Promise<Record<string, string>> {
  const meta = await db.meta.get("sync.imgmap");
  return (meta?.value as Record<string, string>) ?? {};
}

function hashString(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(16);
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [head, base64] = dataUrl.split(",");
  const mime = /data:([^;]+);base64/.exec(head)?.[1] ?? "image/png";
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/**
 * 把正文中的 data URL 图片上传到 Storage，返回改写后的服务端副本内容。
 * 本地内容保持 data URL 不变（离线可用）。
 */
async function uploadEmbeddedImages(
  sb: SupabaseClient,
  note: Note
): Promise<string> {
  if (!note.content.includes("data:image/")) return note.content;

  const map = await getImageMap();
  let dirty = false;

  const result = await replaceAsync(
    note.content,
    DATA_IMG_RE,
    async (_m, alt: string, mimeSub: string, payload: string) => {
      const dataUrl = `data:image/${mimeSub};base64,${payload}`;
      if (map[dataUrl]) return `![${alt}](${map[dataUrl]})`;
      const ext = MIME_EXT[mimeSub] ?? "img";
      const path = `${state.userId}/${note.id}/${hashString(dataUrl)}.${ext}`;
      const blob = dataUrlToBlob(dataUrl);
      const up = await sb.storage
        .from("note-images")
        .upload(path, blob, { upsert: true, contentType: blob.type });
      if (up.error) throw new Error(up.error.message);
      const publicUrl = sb.storage.from("note-images").getPublicUrl(path).data
        .publicUrl;
      map[dataUrl] = publicUrl;
      dirty = true;
      return `![${alt}](${publicUrl})`;
    }
  );

  if (dirty) {
    await db.meta.put({ key: "sync.imgmap", value: map });
  }
  return result;
}

/** String.replace 的异步回调版本（顺序执行） */
async function replaceAsync(
  input: string,
  re: RegExp,
  fn: (...args: string[]) => Promise<string>
): Promise<string> {
  const matches: Array<{ match: string; args: string[]; index: number }> = [];
  let m: RegExpExecArray | null;
  const global = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  while ((m = global.exec(input)) !== null) {
    matches.push({ match: m[0], args: m.slice(1), index: m.index });
  }
  let out = "";
  let last = 0;
  for (const item of matches) {
    out += input.slice(last, item.index);
    out += await fn(item.match, ...item.args);
    last = item.index + item.match.length;
  }
  out += input.slice(last);
  return out;
}
