import type { SupabaseClient, RealtimeChannel } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase/client";
import { db, AUTH_UID_KEY, type AttachmentRecord, type OutboxEntry } from "@/lib/db";
import { emitChange, subscribe } from "@/lib/events";
import { debounce } from "@/lib/utils";
import {
  attachmentRepo,
  attachmentExt,
} from "@/lib/data/attachment-repository";
import { setBlobMissingHandler } from "@/lib/attachments/resolve";
import type { Note, Notebook } from "@quickwiki/shared";

/**
 * 云同步引擎。
 *
 * 模型：IndexedDB 仍为主存储（离线可用），Supabase 为同步对等端。
 * - push：本地 outbox 队列 → 服务端；乐观锁条件更新（.eq version），
 *   冲突时以「本地编辑时间 vs 服务端 server_updated_at」做 LWW 裁决
 * - pull：server_updated_at > 游标 增量拉取（服务端权威时钟，与设备时钟无关），
 *   按 server_updated_at 排序 + 分页循环；游标为服务端时间（ISO 字符串）。
 *   attachments 使用独立游标（各表 server_updated_at 独立推进）
 * - 删除：软删除墓碑。push 删除需通过乐观锁；墓碑应用会比较删除意图时间，
 *   本地存在更新的编辑则复活（推回并清除墓碑）
 * - server_updated_at / version 均由服务端触发器维护，客户端不可伪造
 * - 附件：元数据走 attachments 表（乐观锁/墓碑同 notes）；
 *   二进制为不可变内容，上传 note-images 桶（<uid>/<noteId>/<attId>.<ext>），
 *   永不冲突；本端缺 blob 时按需懒下载回填（渲染侧触发）
 *
 * 已知限制：冲突裁决中「本地编辑时间（设备时钟）vs server_updated_at（服务端
 * 时钟）」仍是跨时钟启发式比较，仅在真正的写冲突时介入；常规路径（漏拉、
 * 盲覆盖、删除无条件生效）已不依赖设备时钟。
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

/** pull 游标初始值（epoch）；旧数值游标会被重置为该值触发一次全量重拉 */
const EPOCH_CURSOR = "1970-01-01T00:00:00+00:00";
/** 单页拉取行数（PostgREST 默认 max-rows 通常为 1000，必须分页防止静默截断） */
const PULL_PAGE_SIZE = 200;
/**
 * 游标安全回退窗口（毫秒）：规避「写入事务开始早于本次查询、提交晚于查询」
 * 的极小竞态（now() 取事务开始时间）。窗口内的行重复拉取是幂等的。
 */
const CURSOR_SAFETY_LAG_MS = 2000;
/** push 冲突（条件删除/覆盖）最大尝试次数 */
const PUSH_CONFLICT_RETRIES = 3;

/**
 * 登录/退出时同步 uid 标记；标记变化则整页重载，
 * 使 Dexie 打开对应用户的库、搜索索引与同步水位随库切换。
 */
function syncUidMarker(userId: string | null): void {
  if (typeof window === "undefined") return;
  let changed = false;
  try {
    const prev = localStorage.getItem(AUTH_UID_KEY) ?? "";
    const next = userId ?? "";
    if (prev !== next) {
      localStorage.setItem(AUTH_UID_KEY, next);
      changed = true;
    }
  } catch {
    // 隐私模式等写入失败：跳过重载，避免无标记死循环
    return;
  }
  if (changed) window.location.reload();
}

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

/**
 * 仅本地语义的附件写入（如 blob 懒下载回填）置位：这类写入不改变元数据，
 * 若照常入队只会在服务端空推一次 UPDATE（version 自增 + Realtime 广播给各端）。
 */
let localAttachmentWrite = false;

const scheduleSync = debounce(() => {
  void syncNow();
}, 5000);

/** Realtime 收到远端变更后快速触发一次同步（push + pull） */
const scheduleRealtimeSync = debounce(() => {
  void syncNow();
}, 1500);

// ---------- Realtime 订阅 ----------

let realtimeChannel: RealtimeChannel | null = null;
let realtimeUid: string | null = null;

function subscribeRealtime(sb: SupabaseClient, userId: string): void {
  // 同一 uid（如 token 刷新触发的 auth 事件）不重建频道
  if (realtimeChannel && realtimeUid === userId) return;
  unsubscribeRealtime(sb);
  realtimeUid = userId;
  realtimeChannel = sb
    .channel(`sync-realtime:${userId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "notes",
        filter: `user_id=eq.${userId}`,
      },
      () => scheduleRealtimeSync()
    )
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "notebooks",
        filter: `user_id=eq.${userId}`,
      },
      () => scheduleRealtimeSync()
    )
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "attachments",
        filter: `user_id=eq.${userId}`,
      },
      () => scheduleRealtimeSync()
    )
    .subscribe();
}

function unsubscribeRealtime(sb: SupabaseClient): void {
  if (!realtimeChannel) return;
  void sb.removeChannel(realtimeChannel);
  realtimeChannel = null;
}

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
    syncUidMarker(session?.user.id ?? null);
    setState({
      userId: session?.user.id ?? null,
      userEmail: session?.user.email ?? null,
    });
    if (session?.user.id) {
      subscribeRealtime(sb, session.user.id);
      void syncNow();
    } else {
      unsubscribeRealtime(sb);
      setState({ status: "signed-out" });
    }
  });

  subscribe("notes", (e) => {
    if (applyingRemote) return;
    void enqueue("note", e.ids, e.type === "delete");
    // 删除笔记级联：本地附件一并删除（其 delete 事件会自动入队附件墓碑）
    if (e.type === "delete") {
      for (const noteId of e.ids) {
        void attachmentRepo.deleteByNote(noteId).catch(() => {});
      }
    }
    scheduleSync();
  });
  subscribe("notebooks", (e) => {
    if (applyingRemote) return;
    void enqueue("notebook", e.ids, e.type === "delete");
    scheduleSync();
  });
  subscribe("attachments", (e) => {
    if (applyingRemote || localAttachmentWrite) return;
    void enqueue("attachment", e.ids, e.type === "delete");
    scheduleSync();
  });

  // 渲染层发现本地缺 blob 时的懒下载入口
  setBlobMissingHandler((id) => queueBlobDownload(id));

  if (typeof window !== "undefined") {
    window.addEventListener("online", () => void syncNow());
  }

  if (state.userId) {
    subscribeRealtime(sb, state.userId);
    void syncNow();
  } else {
    setState({ status: "signed-out" });
  }
}

async function enqueue(
  kind: "note" | "notebook" | "attachment",
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
    // 单条 push 失败不抛出（不阻塞队列、不跳过 pull），错误汇总上报
    const pushError = await push(sb);
    await pull(sb);
    setState({
      status: pushError ? "error" : "idle",
      error: pushError,
      lastSyncAt: Date.now(),
    });
  } catch (e) {
    setState({
      status: "error",
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

async function push(sb: SupabaseClient): Promise<string | null> {
  const entries = await db.outbox.orderBy("queuedAt").toArray();
  let lastError: string | null = null;
  for (const entry of entries) {
    try {
      if (entry.kind === "note") {
        await pushNote(sb, entry);
      } else if (entry.kind === "attachment") {
        await pushAttachment(sb, entry);
      } else {
        await pushNotebook(sb, entry);
      }
      await db.outbox.delete(entry.key);
    } catch (e) {
      // 队头容错：单条失败保留条目并计数，继续推送后续条目，下轮同步重试
      lastError = e instanceof Error ? e.message : String(e);
      try {
        await db.outbox.update(entry.key, {
          attempts: Math.min((entry.attempts ?? 0) + 1, 99),
        });
      } catch {
        // 计数失败不影响主流程
      }
    }
  }
  return lastError;
}

// ---------- 远端行结构与服务端交互原语 ----------

interface RemoteRowMeta {
  id: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  /** 服务端触发器写入的权威修改时间（pull 游标与冲突裁决依据） */
  server_updated_at: string;
  /** 服务端乐观锁版本号（触发器自增） */
  version: number;
}

interface RemoteNote extends RemoteRowMeta {
  notebook_id: string | null;
  title: string;
  title_manual: string | null;
  content: string;
  tags: string[] | null;
  pinned: boolean;
}

interface RemoteNotebook extends RemoteRowMeta {
  name: string;
  color: string;
}

interface RemoteAttachment extends RemoteRowMeta {
  note_id: string;
  filename: string;
  mime: string;
  size: number;
  width: number;
  height: number;
  hash: string;
  compressed: boolean;
}

type SyncTable = "notes" | "notebooks" | "attachments";

function ts(iso: string | null | undefined): number {
  return iso ? new Date(iso).getTime() : 0;
}

async function fetchRemote(
  sb: SupabaseClient,
  table: SyncTable,
  id: string
): Promise<RemoteRowMeta | null> {
  const res = await sb.from(table).select("*").eq("id", id).maybeSingle();
  if (res.error) throw new Error(res.error.message);
  return (res.data as RemoteRowMeta) ?? null;
}

async function insertRemote(
  sb: SupabaseClient,
  table: SyncTable,
  row: Record<string, unknown>
): Promise<RemoteRowMeta> {
  const ins = await sb.from(table).insert(row).select();
  if (ins.error) throw new Error(ins.error.message);
  const saved = (ins.data ?? [])[0] as RemoteRowMeta | undefined;
  if (!saved) throw new Error(`${table} 插入未返回数据`);
  return saved;
}

/** push 成功/被覆盖后把服务端版本写回本地（乐观锁基线） */
async function saveLocalVersion(
  kind: "note" | "notebook",
  id: string,
  version: number
): Promise<void> {
  if (kind === "note") {
    const local = await db.notes.get(id);
    if (local) await db.notes.put({ ...local, syncVersion: version });
  } else {
    const local = await db.notebooks.get(id);
    if (local) await db.notebooks.put({ ...local, syncVersion: version });
  }
}

/**
 * 远端快照在手时的冲突裁决（push 冲突与旧数据无版本基线路径共用）：
 * - 远端是墓碑且删除意图晚于本地最后编辑 → 接受删除
 * - 本地编辑时间晚于远端 server_updated_at → 以远端当前版本为基线覆盖写入
 *   （写入行带 deleted_at: null，可顺带复活墓碑）
 * - 否则远端胜出，强制回填本地（裁决已完成，跳过 pull 期的本地优先检查）
 */
async function resolveWithRemote(
  sb: SupabaseClient,
  table: SyncTable,
  kind: "note" | "notebook",
  row: Record<string, unknown> & { id: string },
  localUpdatedAt: number,
  remote: RemoteRowMeta
): Promise<void> {
  if (remote.deleted_at) {
    if (localUpdatedAt > ts(remote.deleted_at)) {
      // 本地编辑比删除意图新 → 复活：覆盖写入并清除墓碑
      const again = await sb
        .from(table)
        .update(row)
        .eq("id", row.id)
        .eq("version", remote.version)
        .select();
      if (again.error) throw new Error(again.error.message);
      if (again.data && again.data.length > 0) {
        await saveLocalVersion(
          kind,
          row.id,
          (again.data[0] as RemoteRowMeta).version
        );
        return;
      }
      // 版本再次被并发写入：接受远端，依赖下轮 pull 收敛
    }
    await applyRemote(table, remote);
    return;
  }

  if (localUpdatedAt > ts(remote.server_updated_at)) {
    const again = await sb
      .from(table)
      .update(row)
      .eq("id", row.id)
      .eq("version", remote.version)
      .select();
    if (again.error) throw new Error(again.error.message);
    if (again.data && again.data.length > 0) {
      await saveLocalVersion(
        kind,
        row.id,
        (again.data[0] as RemoteRowMeta).version
      );
      return;
    }
  }
  await applyRemote(table, remote, true);
}

async function applyRemote(
  table: SyncTable,
  row: RemoteRowMeta,
  force = false
): Promise<void> {
  if (table === "notes") {
    await applyRemoteNote(row as RemoteNote, force);
  } else if (table === "attachments") {
    await applyRemoteAttachment(row as RemoteAttachment, force);
  } else {
    await applyRemoteNotebook(row as RemoteNotebook, force);
  }
}

/**
 * push 删除：墓碑必须通过乐观锁写入，且与远端更新做时间裁决。
 * 删除意图时间取 outbox 入队时刻（本地时钟下删除发生的近似时间）。
 * - 远端行不存在 / 已是墓碑 → 无需操作
 * - 远端内容写入晚于本地删除意图 → 删除让位，拉回远端行（本地复活）
 * - 否则条件删除（.eq version），持续冲突则保留条目稍后重试
 * 返回裁决时看到的远端行（null = 行不存在；附件删除后清 Storage 用）
 */
async function pushTombstone(
  sb: SupabaseClient,
  table: SyncTable,
  entry: OutboxEntry
): Promise<RemoteRowMeta | null> {
  const delAt = new Date(entry.queuedAt).toISOString();
  let remote = await fetchRemote(sb, table, entry.entityId);
  if (!remote || remote.deleted_at) return remote;

  for (let attempt = 0; attempt < PUSH_CONFLICT_RETRIES; attempt++) {
    if (ts(remote.server_updated_at) > ts(delAt)) {
      // 远端有更新的写入：删除让位，把该行拉回本地
      await applyRemote(table, remote, true);
      return remote;
    }
    const del = await sb
      .from(table)
      .update({ deleted_at: delAt })
      .eq("id", entry.entityId)
      .eq("version", remote.version)
      .select();
    if (del.error) throw new Error(del.error.message);
    if (del.data && del.data.length > 0) return remote;
    remote = await fetchRemote(sb, table, entry.entityId);
    if (!remote || remote.deleted_at) return remote;
  }
  throw new Error(`${table}:${entry.entityId} 删除冲突，稍后重试`);
}

async function pushNote(
  sb: SupabaseClient,
  entry: OutboxEntry
): Promise<void> {
  const userId = state.userId!;
  const note = await db.notes.get(entry.entityId);

  if (entry.deleted || !note) {
    await pushTombstone(sb, "notes", entry);
    return;
  }

  // 正文即协议引用（quickwiki-att://），本地与服务端同内容、零改写
  const row = {
    id: note.id,
    user_id: userId,
    notebook_id: note.notebookId,
    title: note.title,
    title_manual: note.titleManual,
    content: note.content,
    tags: note.tags,
    pinned: note.pinned,
    created_at: new Date(note.createdAt).toISOString(),
    updated_at: new Date(note.updatedAt).toISOString(),
    // 内容更新顺带清除墓碑（复活路径）
    deleted_at: null,
  };

  if (note.syncVersion == null) {
    // 无乐观锁基线（新创建未同步过，或旧版本构建遗留的数据）：
    // 先取远端快照，再走同一套裁决
    const remote = await fetchRemote(sb, "notes", note.id);
    if (!remote) {
      const saved = await insertRemote(sb, "notes", row);
      await db.notes.put({ ...note, syncVersion: saved.version });
      return;
    }
    await resolveWithRemote(sb, "notes", "note", row, note.updatedAt, remote);
    return;
  }

  // 乐观锁条件更新：仅当远端仍是本地最后所见版本时写入
  const updated = await sb
    .from("notes")
    .update(row)
    .eq("id", note.id)
    .eq("version", note.syncVersion)
    .select();
  if (updated.error) throw new Error(updated.error.message);
  if (updated.data && updated.data.length > 0) {
    await db.notes.put({
      ...note,
      syncVersion: (updated.data[0] as RemoteRowMeta).version,
    });
    return;
  }

  // 0 行受影响：行不存在（插入）或版本已前移（进入冲突裁决）
  const remote = await fetchRemote(sb, "notes", note.id);
  if (!remote) {
    const saved = await insertRemote(sb, "notes", row);
    await db.notes.put({ ...note, syncVersion: saved.version });
    return;
  }
  await resolveWithRemote(sb, "notes", "note", row, note.updatedAt, remote);
}

async function pushNotebook(
  sb: SupabaseClient,
  entry: OutboxEntry
): Promise<void> {
  const userId = state.userId!;
  const nb = await db.notebooks.get(entry.entityId);

  if (entry.deleted || !nb) {
    await pushTombstone(sb, "notebooks", entry);
    return;
  }

  const row = {
    id: nb.id,
    user_id: userId,
    name: nb.name,
    color: nb.color,
    created_at: new Date(nb.createdAt).toISOString(),
    updated_at: new Date(nb.updatedAt).toISOString(),
    deleted_at: null,
  };

  if (nb.syncVersion == null) {
    const remote = await fetchRemote(sb, "notebooks", nb.id);
    if (!remote) {
      const saved = await insertRemote(sb, "notebooks", row);
      await db.notebooks.put({ ...nb, syncVersion: saved.version });
      return;
    }
    await resolveWithRemote(
      sb,
      "notebooks",
      "notebook",
      row,
      nb.updatedAt,
      remote
    );
    return;
  }

  const updated = await sb
    .from("notebooks")
    .update(row)
    .eq("id", nb.id)
    .eq("version", nb.syncVersion)
    .select();
  if (updated.error) throw new Error(updated.error.message);
  if (updated.data && updated.data.length > 0) {
    await db.notebooks.put({
      ...nb,
      syncVersion: (updated.data[0] as RemoteRowMeta).version,
    });
    return;
  }

  const remote = await fetchRemote(sb, "notebooks", nb.id);
  if (!remote) {
    const saved = await insertRemote(sb, "notebooks", row);
    await db.notebooks.put({ ...nb, syncVersion: saved.version });
    return;
  }
  await resolveWithRemote(
    sb,
    "notebooks",
    "notebook",
    row,
    nb.updatedAt,
    remote
  );
}

/**
 * 附件 push：元数据走 attachments 表（乐观锁/墓碑），二进制为不可变内容，
 * 上传 note-images 桶后永不冲突，因此元数据冲突一律远端胜出（本地仅
 * rename 可能竞争，可接受）。
 */
async function pushAttachment(
  sb: SupabaseClient,
  entry: OutboxEntry
): Promise<void> {
  const userId = state.userId!;
  const att = await db.attachments.get(entry.entityId);

  if (entry.deleted || !att) {
    const remote = await pushTombstone(sb, "attachments", entry);
    // 元数据墓碑落定后尽力删除 Storage 对象（失败仅记日志，孤儿由清理任务兜底）
    if (remote) {
      const row = remote as RemoteAttachment;
      const path = `${userId}/${row.note_id}/${row.id}.${attachmentExt(row.mime)}`;
      try {
        await sb.storage.from("note-images").remove([path]);
      } catch (err) {
        console.warn("attachment storage cleanup failed:", path, err);
      }
    }
    return;
  }

  const metaRow = {
    id: att.id,
    user_id: userId,
    note_id: att.noteId,
    filename: att.filename,
    mime: att.mime,
    size: att.size,
    width: att.width,
    height: att.height,
    hash: att.hash,
    compressed: att.compressed,
    created_at: new Date(att.createdAt).toISOString(),
    updated_at: new Date(att.updatedAt).toISOString(),
    deleted_at: null,
  };

  // 元数据先行（insert 或乐观锁 upsert；冲突远端胜出）
  let remote = await fetchRemote(sb, "attachments", att.id);
  if (!remote) {
    remote = await insertRemote(sb, "attachments", metaRow);
  } else {
    const updated = await sb
      .from("attachments")
      .update(metaRow)
      .eq("id", att.id)
      .eq("version", remote.version)
      .select();
    if (updated.error) throw new Error(updated.error.message);
    if (updated.data && updated.data.length > 0) {
      remote = updated.data[0] as RemoteRowMeta;
    }
    // 0 行受影响 = 版本前移：接受远端元数据（本地 blob 不受影响）
  }

  // 二进制上传（upsert 幂等；无 blob = 元数据先行场景，等 blob 回填后下轮补传）
  const record = await db.attachments.get(att.id);
  if (record?.blob) {
    const path = `${userId}/${att.noteId}/${att.id}.${attachmentExt(att.mime)}`;
    const up = await sb.storage
      .from("note-images")
      .upload(path, record.blob, { upsert: true, contentType: att.mime });
    if (up.error) throw new Error(`附件二进制上传失败：${up.error.message}`);
  }

  await db.attachments.put({ ...att, syncVersion: remote.version });
}

// ---------- 拉取 ----------

/**
 * 增量拉取：游标为服务端 server_updated_at（ISO 字符串），与设备时钟无关。
 * 按 server_updated_at 升序 + 分页循环，直到取完（防止 PostgREST max-rows
 * 静默截断）。notes 与 notebooks 共用一个游标（与旧版一致）。
 */
async function pull(sb: SupabaseClient): Promise<void> {
  const userId = state.userId!;
  const cursorKey = `sync.lastPull:${userId}`;
  const meta = await db.meta.get(cursorKey);
  // 旧游标为客户端时钟毫秒数（数值）——语义已切换，重置触发一次全量重拉
  const cursor = typeof meta?.value === "string" ? meta.value : EPOCH_CURSOR;
  const prevCursorTs = ts(cursor);
  let maxTs = prevCursorTs;

  for (const table of ["notes", "notebooks"] as const) {
    let since = cursor;
    for (;;) {
      const res = await sb
        .from(table)
        .select("*")
        .eq("user_id", userId)
        .gt("server_updated_at", since)
        .order("server_updated_at", { ascending: true })
        .limit(PULL_PAGE_SIZE);
      if (res.error) throw new Error(res.error.message);
      const rows = (res.data ?? []) as Array<RemoteNote | RemoteNotebook>;
      for (const row of rows) {
        if (table === "notes") {
          await applyRemoteNote(row as RemoteNote);
        } else {
          await applyRemoteNotebook(row as RemoteNotebook);
        }
      }
      if (rows.length > 0) {
        const lastTs = ts(rows[rows.length - 1].server_updated_at);
        if (lastTs > maxTs) maxTs = lastTs;
      }
      if (rows.length < PULL_PAGE_SIZE) break;
      const nextSince = rows[rows.length - 1].server_updated_at;
      if (ts(nextSince) <= ts(since)) break; // 防御：游标无法推进（理论不可达）
      since = nextSince;
    }
  }

  // 游标只前进：maxTs 回退安全窗口后仍不得小于上一轮游标
  const nextCursorTs = Math.max(prevCursorTs, maxTs - CURSOR_SAFETY_LAG_MS);
  await db.meta.put({
    key: cursorKey,
    value: new Date(nextCursorTs).toISOString(),
  });

  // 附件独立游标：元数据先行，blob 缺失由懒下载回填
  const attCursorKey = `sync.lastPullAtt:${userId}`;
  const attMeta = await db.meta.get(attCursorKey);
  const attCursor =
    typeof attMeta?.value === "string" ? attMeta.value : EPOCH_CURSOR;
  const attPrevTs = ts(attCursor);
  let attMaxTs = attPrevTs;

  let attSince = attCursor;
  for (;;) {
    const res = await sb
      .from("attachments")
      .select("*")
      .eq("user_id", userId)
      .gt("server_updated_at", attSince)
      .order("server_updated_at", { ascending: true })
      .limit(PULL_PAGE_SIZE);
    if (res.error) throw new Error(res.error.message);
    const rows = (res.data ?? []) as RemoteAttachment[];
    for (const row of rows) {
      await applyRemoteAttachment(row);
    }
    if (rows.length > 0) {
      const lastTs = ts(rows[rows.length - 1].server_updated_at);
      if (lastTs > attMaxTs) attMaxTs = lastTs;
    }
    if (rows.length < PULL_PAGE_SIZE) break;
    const nextSince = rows[rows.length - 1].server_updated_at;
    if (ts(nextSince) <= ts(attSince)) break;
    attSince = nextSince;
  }

  const attNextTs = Math.max(attPrevTs, attMaxTs - CURSOR_SAFETY_LAG_MS);
  await db.meta.put({
    key: attCursorKey,
    value: new Date(attNextTs).toISOString(),
  });
}

async function applyRemoteNote(row: RemoteNote, force = false): Promise<void> {
  applyingRemote = true;
  try {
    if (row.deleted_at) {
      // 墓碑：本地存在比删除意图更新的编辑 → 复活（重新入队，push 会清除墓碑）；
      // 否则接受删除并清除本地待推送记录
      const local = await db.notes.get(row.id);
      if (local && local.updatedAt > ts(row.deleted_at)) {
        await db.outbox.put({
          key: `note:${row.id}`,
          kind: "note",
          entityId: row.id,
          deleted: false,
          queuedAt: Date.now(),
        });
        scheduleSync();
        return;
      }
      await db.notes.delete(row.id);
      await db.outbox.delete(`note:${row.id}`);
      // 远端删除已级联附件：本地附件直接清理（无需入队，墓碑由附件 pull 收敛）
      await removeNoteAttachmentsLocal(row.id);
      emitChange("notes", { type: "delete", ids: [row.id] });
      return;
    }
    if (!force) {
      const local = await db.notes.get(row.id);
      const remoteUpdated = new Date(row.updated_at).getTime();
      // 本地更新且有待推送修改 → 本地胜出，等 push 处理
      // （不覆盖本地、不记录远端版本，避免绕过冲突检测）
      if (local && local.updatedAt > remoteUpdated) {
        const pending = await db.outbox.get(`note:${row.id}`);
        if (pending) return;
      }
    }
    const note: Note = {
      id: row.id,
      title: row.title,
      titleManual: row.title_manual,
      content: row.content,
      notebookId: row.notebook_id,
      tags: row.tags ?? [],
      createdAt: new Date(row.created_at).getTime(),
      updatedAt: new Date(row.updated_at).getTime(),
      pinned: row.pinned,
      syncVersion: row.version,
    };
    await db.notes.put(note);
    emitChange("notes", { type: "update", ids: [row.id] });
  } finally {
    applyingRemote = false;
  }
}

async function applyRemoteNotebook(
  row: RemoteNotebook,
  force = false
): Promise<void> {
  applyingRemote = true;
  try {
    if (row.deleted_at) {
      const local = await db.notebooks.get(row.id);
      if (local && local.updatedAt > ts(row.deleted_at)) {
        await db.outbox.put({
          key: `notebook:${row.id}`,
          kind: "notebook",
          entityId: row.id,
          deleted: false,
          queuedAt: Date.now(),
        });
        scheduleSync();
        return;
      }
      await db.notebooks.delete(row.id);
      await db.outbox.delete(`notebook:${row.id}`);
      emitChange("notebooks", { type: "delete", ids: [row.id] });
      return;
    }
    if (!force) {
      const local = await db.notebooks.get(row.id);
      const remoteUpdated = new Date(row.updated_at).getTime();
      if (local && local.updatedAt > remoteUpdated) {
        const pending = await db.outbox.get(`notebook:${row.id}`);
        if (pending) return;
      }
    }
    const nb: Notebook = {
      id: row.id,
      name: row.name,
      color: row.color,
      createdAt: new Date(row.created_at).getTime(),
      updatedAt: new Date(row.updated_at).getTime(),
      syncVersion: row.version,
    };
    await db.notebooks.put(nb);
    emitChange("notebooks", { type: "update", ids: [row.id] });
  } finally {
    applyingRemote = false;
  }
}

/** 删除笔记的全部本地附件（笔记被删除的级联；由笔记删除路径调用） */
async function removeNoteAttachmentsLocal(noteId: string): Promise<void> {
  const ids = (await db.attachments
    .where("noteId")
    .equals(noteId)
    .primaryKeys()) as string[];
  if (ids.length === 0) return;
  await db.attachments.bulkDelete(ids);
  emitChange("attachments", { type: "delete", ids });
}

async function applyRemoteAttachment(
  row: RemoteAttachment,
  force = false
): Promise<void> {
  applyingRemote = true;
  try {
    if (row.deleted_at) {
      // 附件不可变，无「本地更新」语义：直接接受删除
      await db.attachments.delete(row.id);
      await db.outbox.delete(`attachment:${row.id}`);
      emitChange("attachments", { type: "delete", ids: [row.id] });
      return;
    }
    const local = await db.attachments.get(row.id);
    if (!force && local && local.filename === row.filename) {
      // 元数据无变化：仅核对乐观锁基线，不动本地 blob
      if (local.syncVersion !== row.version) {
        await db.attachments.put({ ...local, syncVersion: row.version });
      }
      if (!local.blob) queueBlobDownload(row.id);
      return;
    }
    // 元数据先行落库；本地已有 blob 时保留（不可变内容，等价即跳过重下）
    const record: AttachmentRecord = {
      id: row.id,
      noteId: row.note_id,
      filename: row.filename,
      mime: row.mime,
      size: Number(row.size),
      width: row.width,
      height: row.height,
      hash: row.hash,
      compressed: row.compressed,
      createdAt: new Date(row.created_at).getTime(),
      updatedAt: new Date(row.updated_at).getTime(),
      syncVersion: row.version,
      blob: local?.blob,
    };
    await db.attachments.put(record);
    if (!record.blob) queueBlobDownload(row.id);
    emitChange("attachments", { type: "update", ids: [row.id] });
  } finally {
    applyingRemote = false;
  }
}

// ---------- 附件 blob 懒下载 ----------

const BLOB_DOWNLOAD_MAX_CONCURRENT = 3;
const blobDownloadQueued = new Set<string>();
let blobDownloadsInFlight = 0;

/** 本地缺 blob 的附件：按确定性公开 URL 下载回填（渲染触发，队列去重限流） */
function queueBlobDownload(id: string): void {
  if (blobDownloadQueued.has(id)) return;
  blobDownloadQueued.add(id);
  void pumpBlobDownloads();
}

async function pumpBlobDownloads(): Promise<void> {
  while (
    blobDownloadsInFlight < BLOB_DOWNLOAD_MAX_CONCURRENT &&
    blobDownloadQueued.size > 0
  ) {
    const id = blobDownloadQueued.values().next().value as string;
    blobDownloadQueued.delete(id);
    blobDownloadsInFlight += 1;
    void downloadBlobForAttachment(id).finally(() => {
      blobDownloadsInFlight -= 1;
      void pumpBlobDownloads();
    });
  }
}

async function downloadBlobForAttachment(id: string): Promise<void> {
  try {
    const sb = getSupabase();
    const userId = state.userId;
    if (!sb || !userId) return;
    const record = await db.attachments.get(id);
    if (!record || record.blob) return;

    const path = `${userId}/${record.noteId}/${record.id}.${attachmentExt(record.mime)}`;
    const { data } = sb.storage.from("note-images").getPublicUrl(path);
    const res = await fetch(data.publicUrl);
    if (!res.ok) return; // 对端尚未上传完成等情况：等下次渲染触发重试
    const blob = await res.blob();
    if (blob.size === 0) return;

    const latest = await db.attachments.get(id);
    if (!latest || latest.blob) return; // 已被删除/并发回填
    // 只回填二进制、元数据不变：抑制 outbox 入队，避免一次空转的服务端写入
    localAttachmentWrite = true;
    try {
      await db.attachments.put({ ...latest, blob });
      emitChange("attachments", { type: "update", ids: [id] });
    } finally {
      localAttachmentWrite = false;
    }
  } catch (err) {
    console.warn("attachment blob download failed:", id, err);
  }
}
