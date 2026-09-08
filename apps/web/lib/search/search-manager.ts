import MiniSearch from "minisearch";
import type { Note, SearchResult } from "@quickwiki/shared";
import { SEARCH_SYNC_KEY } from "@quickwiki/shared";
import { db } from "@/lib/db";
import { subscribe } from "@/lib/events";
import { markdownToText, debounce } from "@/lib/utils";

/**
 * 增量搜索管理器（MiniSearch）。
 *
 * 相对设计文档原方案的优化：
 * 1. 索引持久化到 IndexedDB（meta 表），页面刷新后无需全量重建；
 * 2. 通过 updatedAt 水位做增量同步，启动成本与变更量成正比；
 * 3. 订阅 notes 变更事件，CRUD/自动保存后实时更新索引；
 * 4. 中文分词：CJK 连续片段按二元组（bigram）切分，英文/数字按单词切分；
 * 5. 搜索结果按数据库现存笔记过滤，陈旧索引条目不会出现在结果中。
 */

interface IndexedDoc {
  id: string;
  title: string;
  content: string;
}

const INDEX_META_KEY = "search.index";
const LAST_SYNC_META_KEY = SEARCH_SYNC_KEY;

/** 提取拉丁/数字单词与 CJK 连续片段 */
const SEGMENT_RE = /[a-z0-9]+|[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]+/gi;

function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const segments = text.toLowerCase().match(SEGMENT_RE) ?? [];
  for (const seg of segments) {
    if (/^[a-z0-9]+$/.test(seg)) {
      tokens.push(seg);
      continue;
    }
    // CJK：单字片段直接保留，否则生成二元组
    if (seg.length === 1) {
      tokens.push(seg);
      continue;
    }
    for (let i = 0; i < seg.length - 1; i++) {
      tokens.push(seg.slice(i, i + 2));
    }
  }
  return tokens;
}

const miniSearchOptions = {
  fields: ["title", "content"],
  storeFields: ["title"],
  tokenize,
  searchOptions: {
    tokenize,
    prefix: true,
    fuzzy: 0.2,
    boost: { title: 2 },
  },
};

class SearchManager {
  private index: MiniSearch<IndexedDoc> | null = null;
  private initPromise: Promise<void> | null = null;
  private subscribed = false;
  private lastSync = 0;
  /** 已入索引的笔记 id（内存维护，配合 discard 幂等删除） */
  private indexedIds = new Set<string>();

  /** 延迟持久化，避免每次按键都写 IndexedDB */
  private schedulePersist = debounce(() => {
    void this.persist();
  }, 2000);

  ensureReady(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.initialize();
    }
    return this.initPromise;
  }

  private async initialize(): Promise<void> {
    const [indexEntry, syncEntry] = await Promise.all([
      db.meta.get(INDEX_META_KEY),
      db.meta.get(LAST_SYNC_META_KEY),
    ]);

    this.lastSync = Number(syncEntry?.value ?? 0);

    if (indexEntry?.value) {
      try {
        this.index = MiniSearch.loadJSON(
          JSON.stringify(indexEntry.value),
          miniSearchOptions
        );
        this.indexedIds = this.readIndexedIds();
        await this.reconcile();
        await this.incrementalSync();
      } catch (err) {
        console.warn("搜索索引损坏，执行全量重建", err);
        this.index = null;
        this.indexedIds.clear();
      }
    }

    if (!this.index) {
      this.index = new MiniSearch<IndexedDoc>(miniSearchOptions);
      await this.fullBuild();
    }

    this.subscribeChanges();
    // 页面隐藏/关闭前尽量落盘
    if (typeof window !== "undefined") {
      window.addEventListener("pagehide", () => void this.persist());
    }
  }

  /** 从持久化索引中恢复文档 id 集合（依赖 MiniSearch toJSON 结构，做防御处理） */
  private readIndexedIds(): Set<string> {
    const set = new Set<string>();
    if (!this.index) return set;
    try {
      const json = this.index.toJSON() as unknown as {
        documentIds?: Record<number, string>;
      };
      for (const id of Object.values(json.documentIds ?? {})) {
        set.add(id);
      }
    } catch {
      // 结构不兼容时返回空集合，后续全量重建兜底
    }
    return set;
  }

  /** 清理索引中已不存在的笔记（删除事件丢失/多标签页等边界场景） */
  private async reconcile(): Promise<void> {
    if (!this.index || this.indexedIds.size === 0) return;
    const existingIds = new Set(await db.notes.toCollection().primaryKeys());
    for (const id of Array.from(this.indexedIds)) {
      if (!existingIds.has(id)) {
        this.index.discard(id);
        this.indexedIds.delete(id);
      }
    }
  }

  private async fullBuild(): Promise<void> {
    if (!this.index) return;
    const notes = await db.notes.toArray();
    this.index.addAll(notes.map((n) => this.toDoc(n)));
    this.indexedIds = new Set(notes.map((n) => n.id));
    this.lastSync = Date.now();
    await this.persist();
  }

  private async incrementalSync(): Promise<void> {
    if (!this.index) return;
    const changed = await db.notes
      .where("updatedAt")
      .above(this.lastSync)
      .toArray();

    for (const note of changed) {
      this.upsert(note);
    }
    this.lastSync = Date.now();
    if (changed.length > 0) {
      await this.persist();
    }
  }

  private subscribeChanges(): void {
    if (this.subscribed) return;
    this.subscribed = true;
    subscribe("notes", (event) => {
      if (event.type === "delete") {
        for (const id of event.ids) {
          if (this.indexedIds.has(id)) {
            this.index?.discard(id);
            this.indexedIds.delete(id);
          }
        }
        this.schedulePersist();
        return;
      }
      // create/update：按 id 重新读取最新内容入索引
      void (async () => {
        const notes = await db.notes.bulkGet(event.ids);
        for (const note of notes) {
          if (note) this.upsert(note);
        }
        this.schedulePersist();
      })();
    });
  }

  private upsert(note: Note): void {
    if (!this.index) return;
    // MiniSearch.discard 对不存在的 id 会抛错，必须先确认已在索引中
    if (this.indexedIds.has(note.id)) {
      this.index.discard(note.id);
      this.indexedIds.delete(note.id);
    }
    this.index.add(this.toDoc(note));
    this.indexedIds.add(note.id);
  }

  private toDoc(note: Note): IndexedDoc {
    return {
      id: note.id,
      title: note.title,
      content: markdownToText(note.content),
    };
  }

  private async persist(): Promise<void> {
    if (!this.index) return;
    try {
      await db.meta.bulkPut([
        { key: INDEX_META_KEY, value: this.index.toJSON() },
        { key: LAST_SYNC_META_KEY, value: this.lastSync },
      ]);
    } catch (err) {
      console.warn("搜索索引持久化失败", err);
    }
  }

  async search(query: string): Promise<SearchResult[]> {
    await this.ensureReady();
    const trimmed = query.trim();
    if (!trimmed || !this.index) return [];

    const hits = this.index.search(trimmed);
    if (hits.length === 0) return [];

    // 按数据库现存笔记过滤，杜绝陈旧索引条目出现在结果里
    const notes = await db.notes.bulkGet(hits.map((h) => h.id as string));
    const noteMap = new Map(
      notes.filter((n): n is Note => Boolean(n)).map((n) => [n.id, n])
    );

    const queryTokens = tokenize(trimmed);

    // 去重兜底：同一笔记即使被重复索引也只返回一条
    const seen = new Set<string>();

    return hits
      .filter((h) => noteMap.has(h.id as string))
      .filter((h) => {
        const id = h.id as string;
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      })
      .slice(0, 50)
      .map((h) => {
        const note = noteMap.get(h.id as string)!;
        return {
          id: note.id,
          title: note.title,
          snippet: makeSnippet(markdownToText(note.content), queryTokens),
          score: h.score,
        };
      });
  }
}

/** 生成命中摘要：优先展示首个命中位置前后各 40 字符 */
function makeSnippet(text: string, queryTokens: string[]): string | undefined {
  if (!text) return undefined;
  const lower = text.toLowerCase();
  let hitPos = -1;
  for (const token of queryTokens) {
    const pos = lower.indexOf(token);
    if (pos >= 0 && (hitPos === -1 || pos < hitPos)) {
      hitPos = pos;
    }
  }
  if (hitPos === -1) {
    return text.length > 80 ? `${text.slice(0, 80)}…` : text;
  }
  const start = Math.max(0, hitPos - 40);
  const end = Math.min(text.length, hitPos + 40);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  return `${prefix}${text.slice(start, end)}${suffix}`;
}

/** 懒加载单例：仅在浏览器端创建 */
let instance: SearchManager | null = null;

export function getSearchManager(): SearchManager {
  if (!instance) {
    instance = new SearchManager();
  }
  return instance;
}
