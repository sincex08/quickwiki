/**
 * sync-engine 核心路径测试：push 乐观锁/LWW 裁决、删除墓碑、pull 分页
 * （同时间戳超页不漏）、outbox 毒丸隔离。Supabase 客户端以替身注入，
 * Dexie 走 fake-indexeddb 真库，验证完整 syncNow 管线。
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mockClient = vi.hoisted(() => ({
  sb: null as unknown,
  ensure: true,
}));

vi.mock("@/lib/supabase/client", () => ({
  isSupabaseConfigured: true,
  getSupabase: () => mockClient.sb,
  ensureFreshSession: async () => mockClient.ensure,
}));

import { db } from "@/lib/db";
import { getSyncState, initSync, syncNow } from "@/lib/sync/sync-engine";
import { createFakeSupabase, FakeClock, USER_ID, type Row } from "./fake-postgrest";
import type { Note } from "@quickwiki/shared";

let clock: FakeClock;
let tables: Record<string, Row[]>;
let fake: ReturnType<typeof createFakeSupabase>;

let seq = 0;
function localNote(overrides: Partial<Note> = {}): Note {
  const now = Date.now();
  return {
    id: overrides.id ?? `local-${seq++}`,
    title: "t",
    titleManual: null,
    content: "c",
    notebookId: null,
    tags: [],
    createdAt: now,
    updatedAt: now,
    pinned: false,
    ...overrides,
  };
}

function remoteNote(overrides: Row): Row {
  return {
    user_id: USER_ID,
    notebook_id: null,
    title: "t",
    title_manual: null,
    content: "c",
    tags: [],
    pinned: false,
    created_at: clock.at(1000),
    updated_at: clock.at(1000),
    server_updated_at: clock.at(1000),
    version: 1,
    deleted_at: null,
    ...overrides,
  };
}

beforeAll(async () => {
  clock = new FakeClock();
  tables = {};
  fake = createFakeSupabase(clock, tables);
  mockClient.sb = fake.sb;
  await initSync();
  // initSync 内部 void syncNow() 未被等待，留出微任务排空时间
  await new Promise((r) => setTimeout(r, 20));
});

beforeEach(async () => {
  fake.hooks.fail = null;
  tables.notes = [];
  tables.notebooks = [];
  tables.attachments = [];
  await Promise.all([
    db.notes.clear(),
    db.notebooks.clear(),
    db.tags.clear(),
    db.noteTags.clear(),
    db.meta.clear(),
    db.attachments.clear(),
    db.outbox.clear(),
  ]);
});

describe("push：乐观锁与 LWW 裁决", () => {
  it("新建笔记：insert 服务端 + syncVersion 写回 + outbox 清空", async () => {
    await db.notes.put(localNote({ id: "n1", content: "c1" }));
    await db.outbox.put({
      key: "note:n1",
      kind: "note",
      entityId: "n1",
      deleted: false,
      queuedAt: 1,
    });

    await syncNow();

    const remote = tables.notes.find((r) => r.id === "n1");
    expect(remote).toBeDefined();
    expect(remote!.version).toBe(1);
    expect(remote!.user_id).toBe(USER_ID);
    expect(remote!.content).toBe("c1");
    expect((await db.notes.get("n1"))!.syncVersion).toBe(1);
    expect(await db.outbox.get("note:n1")).toBeUndefined();
  });

  it("版本冲突且本地较新：条件覆盖服务端（LWW 本地胜）", async () => {
    tables.notes.push(
      remoteNote({ id: "n2", content: "server-old", version: 5 })
    );
    await db.notes.put(
      localNote({ id: "n2", content: "local-new", updatedAt: Date.now(), syncVersion: 4 })
    );
    await db.outbox.put({
      key: "note:n2",
      kind: "note",
      entityId: "n2",
      deleted: false,
      queuedAt: 1,
    });

    await syncNow();

    const remote = tables.notes.find((r) => r.id === "n2")!;
    expect(remote.content).toBe("local-new");
    expect(remote.version).toBe(6);
    expect((await db.notes.get("n2"))!.syncVersion).toBe(6);
    expect(await db.outbox.get("note:n2")).toBeUndefined();
  });

  it("版本冲突且服务端较新：远端胜出，本地被强制回填", async () => {
    tables.notes.push(
      remoteNote({
        id: "n3",
        content: "server-new",
        version: 7,
        updated_at: clock.at(2000),
        server_updated_at: clock.at(2000),
      })
    );
    await db.notes.put(
      localNote({
        id: "n3",
        content: "stale-local",
        updatedAt: Date.UTC(2020, 0, 1),
        syncVersion: 3,
      })
    );
    await db.outbox.put({
      key: "note:n3",
      kind: "note",
      entityId: "n3",
      deleted: false,
      queuedAt: 1,
    });

    await syncNow();

    const local = (await db.notes.get("n3"))!;
    expect(local.content).toBe("server-new");
    expect(local.syncVersion).toBe(7);
    expect(await db.outbox.get("note:n3")).toBeUndefined();
  });
});

describe("push：删除墓碑", () => {
  it("远端有更新写入：删除让位，本地复活为远端内容", async () => {
    tables.notes.push(
      remoteNote({
        id: "n4",
        content: "remote-newer",
        version: 2,
        updated_at: clock.at(3000),
        server_updated_at: clock.at(3000),
      })
    );
    await db.notes.put(localNote({ id: "n4", content: "local-old" }));
    await db.outbox.put({
      key: "note:n4",
      kind: "note",
      entityId: "n4",
      deleted: true,
      queuedAt: Date.UTC(2023, 0, 1), // 删除意图早于远端写入
    });

    await syncNow();

    expect(tables.notes.find((r) => r.id === "n4")!.deleted_at).toBeNull();
    expect((await db.notes.get("n4"))!.content).toBe("remote-newer");
    expect(await db.outbox.get("note:n4")).toBeUndefined();
  });

  it("正常删除：条件更新写入 deleted_at", async () => {
    tables.notes.push(remoteNote({ id: "n5", server_updated_at: clock.at(1000) }));
    const queuedAt = Date.now(); // 晚于远端最后写入
    await db.outbox.put({
      key: "note:n5",
      kind: "note",
      entityId: "n5",
      deleted: true,
      queuedAt,
    });

    await syncNow();

    const remote = tables.notes.find((r) => r.id === "n5")!;
    expect(remote.deleted_at).toBe(new Date(queuedAt).toISOString());
    expect(remote.version).toBe(2);
    expect(await db.outbox.get("note:n5")).toBeUndefined();
  });
});

describe("pull：分页与游标", () => {
  it("同一 server_updated_at 超过一页（200 行）不漏拉", async () => {
    const TS = clock.at(1000);
    for (let i = 0; i < 250; i++) {
      tables.notes.push(
        remoteNote({
          id: `r${String(i).padStart(4, "0")}`,
          title: `t${i}`,
          content: `c${i}`,
          server_updated_at: TS,
          updated_at: TS,
        })
      );
    }

    await syncNow();
    expect(await db.notes.count()).toBe(250);

    // 增量第二轮：仅新增行被拉取，游标正常推进
    tables.notes.push(remoteNote({ id: "r999", server_updated_at: clock.at(5000) }));
    await syncNow();
    expect(await db.notes.count()).toBe(251);
  });
});

describe("push：outbox 毒丸隔离", () => {
  it("连续失败达上限后标记 dead，不再无限重试且不阻塞错误提示", async () => {
    await db.outbox.put({
      key: "note:bad",
      kind: "note",
      entityId: "bad",
      deleted: false,
      queuedAt: 1,
    });

    fake.hooks.fail = "boom";
    for (let i = 0; i < 10; i++) {
      await syncNow();
    }
    const entry = await db.outbox.get("note:bad");
    expect(entry!.attempts).toBe(10);
    expect(entry!.dead).toBe(true);

    // 恢复后：dead 条目被跳过（不再重试），错误消息明确提示
    fake.hooks.fail = null;
    await syncNow();
    expect(getSyncState().status).toBe("error");
    expect(getSyncState().error).toContain("已跳过");
    // 条目保留，等待人工排查（不静默丢数据）
    expect(await db.outbox.get("note:bad")).toBeDefined();
  });
});
