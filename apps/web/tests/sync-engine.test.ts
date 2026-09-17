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

function remoteNotebook(overrides: Row): Row {
  return {
    user_id: USER_ID,
    name: "nb",
    color: "#f00",
    parent_id: null,
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
  fake.hooks.beforeExecute = undefined;
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

describe("pull：轮间游标持久化", () => {
  it("首次拉取后复合游标同步到已推进的安全水位", async () => {
    tables.notes.push(remoteNote({ id: "cursor-note", server_updated_at: clock.at(10_000) }));

    await syncNow();

    const cursor = await db.meta.get(`sync.lastPull:${USER_ID}`);
    const pair = await db.meta.get(`sync.lastPullPair:${USER_ID}`);
    expect(Date.parse(cursor!.value as string)).toBeGreaterThan(0);
    expect(pair!.value).toEqual({ ts: cursor!.value, id: null });
  });
});

describe("push：附件删除裁决", () => {
  it("远端更新胜出时保留附件且不删除 Storage 文件", async () => {
    const row = {
      id: "att-kept", user_id: USER_ID, note_id: "attachment-note",
      filename: "kept.png", mime: "image/png", size: 1,
      width: 1, height: 1, hash: "hash", compressed: false,
      created_at: clock.at(1000), updated_at: clock.at(3000),
      server_updated_at: clock.at(3000), version: 2, deleted_at: null,
    };
    tables.attachments.push(row);
    await db.attachments.put({
      id: row.id, noteId: row.note_id, filename: row.filename, mime: row.mime,
      size: 1, width: 1, height: 1, hash: row.hash, compressed: false,
      createdAt: Date.parse(row.created_at), updatedAt: Date.parse(row.updated_at),
      blob: new Blob(["x"]), syncVersion: 2,
    });
    await db.outbox.put({
      key: `attachment:${row.id}`, kind: "attachment", entityId: row.id,
      deleted: true, queuedAt: Date.parse(clock.at(2000)),
    });
    const remove = vi.fn(async () => ({ data: null, error: null }));
    const storage = vi.spyOn(fake.sb.storage, "from").mockReturnValue({ remove });
    try {
      await syncNow();
      expect(remove).not.toHaveBeenCalled();
      expect(tables.attachments[0].deleted_at).toBeNull();
      expect((await db.attachments.get(row.id))?.filename).toBe(row.filename);
      expect(await db.outbox.get(`attachment:${row.id}`)).toBeUndefined();
    } finally {
      storage.mockRestore();
    }
  });
});

/** 挂起第一条满足条件的请求并返回放行函数：模拟「网络请求悬而未决」窗口，
 *  在窗口内执行本地编辑/删除/重新入队，验证回执不覆盖新状态 */
function gateRequest(matchMode: "update", matchTable: string): () => void {
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  let gated = false;
  fake.hooks.beforeExecute = ({ mode, table }) => {
    if (gated || mode !== matchMode || table !== matchTable) return;
    gated = true;
    return gate;
  };
  return release;
}

describe("push：请求期间的本地编辑保护", () => {
  it("网络期间再次编辑：旧回执不覆盖新内容，也不确认掉新一代队列操作", async () => {
    tables.notes.push(
      remoteNote({ id: "n-mid", content: "server-v1", version: 1 })
    );
    await db.notes.put(
      localNote({ id: "n-mid", content: "local-v1", syncVersion: 1 })
    );
    await db.outbox.put({
      key: "note:n-mid",
      kind: "note",
      entityId: "n-mid",
      deleted: false,
      queuedAt: 1,
      revision: "rev-1",
    });

    const release = gateRequest("update", "notes");
    const syncing = syncNow();
    await new Promise((r) => setTimeout(r, 20)); // 等条件更新请求到达闸门
    // 网络悬而未决期间：用户再次编辑 + 新一代操作覆盖同 key
    await db.notes.update("n-mid", {
      content: "local-v2",
      updatedAt: Date.now(),
    });
    await db.outbox.put({
      key: "note:n-mid",
      kind: "note",
      entityId: "n-mid",
      deleted: false,
      queuedAt: Date.now(),
      revision: "rev-2",
    });
    release();
    await syncing;

    // 本地新编辑未被旧快照回写覆盖；新一代操作未被旧回执确认掉
    expect((await db.notes.get("n-mid"))!.content).toBe("local-v2");
    expect((await db.outbox.get("note:n-mid"))?.revision).toBe("rev-2");

    // 下一轮把新编辑推上去并收敛
    await syncNow();
    expect(tables.notes.find((r) => r.id === "n-mid")!.content).toBe(
      "local-v2"
    );
    expect(await db.outbox.get("note:n-mid")).toBeUndefined();
    expect((await db.notes.get("n-mid"))!.syncVersion).toBe(
      tables.notes.find((r) => r.id === "n-mid")!.version
    );
  });

  it("网络期间删除：旧回执不复活本地记录，新一代删除操作下一轮生效", async () => {
    tables.notes.push(
      remoteNote({ id: "n-del", content: "server-v1", version: 1 })
    );
    await db.notes.put(
      localNote({ id: "n-del", content: "local-v1", syncVersion: 1 })
    );
    await db.outbox.put({
      key: "note:n-del",
      kind: "note",
      entityId: "n-del",
      deleted: false,
      queuedAt: 1,
      revision: "rev-1",
    });

    const release = gateRequest("update", "notes");
    const syncing = syncNow();
    await new Promise((r) => setTimeout(r, 20));
    await db.notes.delete("n-del");
    await db.outbox.put({
      key: "note:n-del",
      kind: "note",
      entityId: "n-del",
      deleted: true,
      queuedAt: Date.now(),
      revision: "rev-2",
    });
    release();
    await syncing;

    // 旧回执只 patch 版本（对已删 key 是 no-op），不得复活本地记录
    expect(await db.notes.get("n-del")).toBeUndefined();
    expect(await db.outbox.get("note:n-del")).toBeDefined();

    // 队列里的新一代删除操作把远端打成墓碑
    await syncNow();
    expect(tables.notes.find((r) => r.id === "n-del")!.deleted_at).not.toBeNull();
    expect(await db.outbox.get("note:n-del")).toBeUndefined();
  });

  it("推送失败时失败计数按修订隔离，不污染请求期间的新操作", async () => {
    tables.notes.push(
      remoteNote({ id: "n-fail", content: "server-v1", version: 1 })
    );
    await db.notes.put(
      localNote({ id: "n-fail", content: "local-v1", syncVersion: 1 })
    );
    await db.outbox.put({
      key: "note:n-fail",
      kind: "note",
      entityId: "n-fail",
      deleted: false,
      queuedAt: 1,
      revision: "rev-1",
    });

    const release = gateRequest("update", "notes");
    const syncing = syncNow();
    await new Promise((r) => setTimeout(r, 20));
    fake.hooks.fail = "network down"; // release 后该请求失败
    await db.outbox.put({
      key: "note:n-fail",
      kind: "note",
      entityId: "n-fail",
      deleted: false,
      queuedAt: 2,
      revision: "rev-2",
    });
    release();
    await syncing;
    fake.hooks.fail = null;

    const cur = await db.outbox.get("note:n-fail");
    expect(cur?.revision).toBe("rev-2");
    expect(cur?.attempts).toBeUndefined();
    expect(cur?.dead).toBeFalsy();
  });
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

describe("笔记本嵌套：parent_id 同步", () => {
  it("push 映射 parent_id（顶层为 null）", async () => {
    await db.notebooks.put({
      id: "p1",
      name: "父",
      color: "#f00",
      parentId: null,
      createdAt: 1,
      updatedAt: 1,
    });
    await db.notebooks.put({
      id: "c1",
      name: "子",
      color: "#0f0",
      parentId: "p1",
      createdAt: 1,
      updatedAt: 1,
    });
    await db.outbox.bulkPut([
      { key: "notebook:p1", kind: "notebook", entityId: "p1", deleted: false, queuedAt: 1 },
      { key: "notebook:c1", kind: "notebook", entityId: "c1", deleted: false, queuedAt: 1 },
    ]);

    await syncNow();

    expect(tables.notebooks.find((r) => r.id === "c1")!.parent_id).toBe("p1");
    expect(tables.notebooks.find((r) => r.id === "p1")!.parent_id).toBeNull();
    expect(await db.outbox.get("notebook:c1")).toBeUndefined();
  });

  it("pull 应用 parent_id", async () => {
    tables.notebooks.push(remoteNotebook({ id: "p1" }));
    tables.notebooks.push(
      remoteNotebook({ id: "c1", parent_id: "p1", server_updated_at: clock.at(2000) })
    );

    await syncNow();

    expect((await db.notebooks.get("c1"))!.parentId).toBe("p1");
    expect((await db.notebooks.get("p1"))!.parentId).toBeNull();
  });

  it("远端 LWW 造环：apply 侧断环并入队推平", async () => {
    // 本地：a 挂在 b 下；远端覆盖 b 挂到 a 下 → a→b→a 成环
    await db.notebooks.put({
      id: "a",
      name: "A",
      color: "#f00",
      parentId: "b",
      createdAt: 1,
      updatedAt: 1,
    });
    await db.notebooks.put({
      id: "b",
      name: "B",
      color: "#0f0",
      parentId: null,
      createdAt: 1,
      updatedAt: 1,
    });
    tables.notebooks.push(
      remoteNotebook({
        id: "b",
        parent_id: "a",
        updated_at: clock.at(5000),
        server_updated_at: clock.at(5000),
      })
    );

    await syncNow();

    // 断环：b 的父级被置空，树重新可达
    expect((await db.notebooks.get("b"))!.parentId).toBeNull();
    // 断环修正已入队（推平服务端）
    const entry = await db.outbox.get("notebook:b");
    expect(entry).toBeDefined();
    expect(entry!.deleted).toBe(false);
  });

  it("远端删除笔记本：子笔记本上移到被删者的父级并入队", async () => {
    await db.notebooks.put({
      id: "root",
      name: "root",
      color: "#f00",
      parentId: null,
      createdAt: 1,
      updatedAt: 1,
    });
    await db.notebooks.put({
      id: "mid",
      name: "mid",
      color: "#0f0",
      parentId: "root",
      createdAt: 1,
      updatedAt: 1,
    });
    await db.notebooks.put({
      id: "child",
      name: "child",
      color: "#00f",
      parentId: "mid",
      createdAt: 1,
      updatedAt: 1,
    });
    tables.notebooks.push(
      remoteNotebook({
        id: "mid",
        deleted_at: clock.at(8000),
        server_updated_at: clock.at(8000),
      })
    );

    await syncNow();

    expect(await db.notebooks.get("mid")).toBeUndefined();
    expect((await db.notebooks.get("child"))!.parentId).toBe("root");
    const entry = await db.outbox.get("notebook:child");
    expect(entry).toBeDefined();
    expect(entry!.deleted).toBe(false);
  });
});

describe("孤儿清扫", () => {
  it("cat 指向不存在笔记本的笔记收敛进未分类并入队", async () => {
    // 模拟多端竞态残留：归属指向已消失的笔记本
    await db.notes.put(localNote({ id: "orphan1", notebookId: "gone" }));
    tables.notebooks.push(remoteNotebook({ id: "live" }));

    await syncNow();

    const fixed = await db.notes.get("orphan1");
    expect(fixed!.notebookId).toBeNull();
    expect((fixed as Note & { cat?: string }).cat).toBe("");
    const entry = await db.outbox.get("note:orphan1");
    expect(entry).toBeDefined();
    expect(entry!.deleted).toBe(false);
  });
});

describe("同步路径维护标签计数", () => {
  it("applyRemoteNote 维护 noteTags 行与 tags 计数器", async () => {
    tables.notes.push(
      remoteNote({ id: "tag1", tags: ["work", "life"], server_updated_at: clock.at(3000) })
    );

    await syncNow();

    expect((await db.notes.get("tag1"))!.tags).toEqual(["work", "life"]);
    expect((await db.tags.get("work"))!.count).toBe(1);
    expect((await db.tags.get("life"))!.count).toBe(1);
    const links = await db.noteTags.where("noteId").equals("tag1").toArray();
    expect(links.map((l) => l.tagName).sort()).toEqual(["life", "work"]);

    // 第二轮：远端把 tag1 的标签改为 ["work"] → life 计数归零删除
    tables.notes.push(
      remoteNote({
        id: "tag1",
        tags: ["work"],
        server_updated_at: clock.at(6000),
        updated_at: clock.at(6000),
      })
    );
    await syncNow();

    expect(await db.tags.get("life")).toBeUndefined();
    expect((await db.tags.get("work"))!.count).toBe(1);
    const linksAfter = await db.noteTags.where("noteId").equals("tag1").toArray();
    expect(linksAfter.map((l) => l.tagName)).toEqual(["work"]);
  });

  it("远端删除笔记回收标签计数与关联", async () => {
    // 本地已有正常标签状态（低 updatedAt，避免触发「本地较新」复活分支）
    await db.notes.put(
      localNote({ id: "d1", tags: ["tmp"], createdAt: 1000, updatedAt: 1000 })
    );
    await db.noteTags.add({ noteId: "d1", tagName: "tmp" });
    await db.tags.add({ name: "tmp", count: 1 });

    tables.notes.push(
      remoteNote({
        id: "d1",
        tags: ["tmp"],
        deleted_at: clock.at(9000),
        server_updated_at: clock.at(9000),
      })
    );

    await syncNow();

    expect(await db.notes.get("d1")).toBeUndefined();
    expect(await db.tags.get("tmp")).toBeUndefined();
    expect(await db.noteTags.where("noteId").equals("d1").count()).toBe(0);
  });
});
