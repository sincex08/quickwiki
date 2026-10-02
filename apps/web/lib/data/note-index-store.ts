import { noteRepo } from "@/lib/data/repository";
import type { NoteIndexItem } from "@/lib/data/repository";
import { sortNotesForDisplay } from "@/lib/data/note-order";
import { subscribe, type ChangeEvent } from "@/lib/events";

const EMPTY: NoteIndexItem[] = [];

/**
 * 全量笔记轻量索引的模块级内存缓存（侧栏树 / 子笔记本角标数据源）。
 *
 * 此前任何 notes 事件（包括每秒级的自动保存回读）都触发全表读取——
 * Dexie 无列裁剪，读索引行也会反序列化正文，千条笔记时每次数百 ms。
 * 改为事件驱动增量维护：事件携带 ids，create/update 按 id 重读合并、
 * delete 直接移除；**未变更的行保留对象引用**，配合 NoteRow 的 memo
 * 让「打字自动保存」只重渲染受影响的那一行。
 *
 * 首次全量加载完成前排队的增量事件在加载后统一回放，不丢更新。
 */
class NoteIndexStore {
  private items: NoteIndexItem[] | null = null;
  private initialLoad: Promise<void> | null = null;
  private listeners = new Set<() => void>();
  private started = false;
  /** 全量加载完成前排队的增量事件 */
  private pendingEvents: ChangeEvent[] = [];

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    this.ensureStarted();
    return () => {
      this.listeners.delete(listener);
    };
  }

  getSnapshot(): NoteIndexItem[] {
    return this.items ?? EMPTY;
  }

  isLoading(): boolean {
    return this.items === null;
  }

  private ensureStarted(): void {
    if (this.started || typeof window === "undefined") return;
    this.started = true;
    this.initialLoad = noteRepo
      .listIndex()
      .then((list) => {
        this.items = list;
        // 回放加载窗口期的增量事件（合并后统一 emit 一次）
        const queued = this.pendingEvents;
        this.pendingEvents = [];
        for (const e of queued) void this.applyEvent(e);
        this.initialLoad = null;
        this.emit();
      })
      .catch((err) => {
        console.warn("note index load failed:", err);
        this.initialLoad = null;
        this.items = [];
        this.emit();
      });
    subscribe("notes", (e) => void this.applyEvent(e));
  }

  private async applyEvent(e: ChangeEvent): Promise<void> {
    if (this.items === null) {
      this.pendingEvents.push(e);
      return;
    }
    const prev = this.items;
    const ids = new Set(e.ids);
    let next = prev;
    if (e.type === "delete") {
      if (prev.some((n) => ids.has(n.id))) {
        next = prev.filter((n) => !ids.has(n.id));
      }
    } else {
      const fresh = await noteRepo.listIndexByIds(e.ids);
      if (fresh.length === 0) return;
      // 未变更行保留原对象引用（memo 的关键），变更行整体替换
      const freshMap = new Map(fresh.map((n) => [n.id, n]));
      next = prev.filter((n) => !freshMap.has(n.id)).concat(fresh);
    }
    if (next !== prev) {
      this.items = sortNotesForDisplay(next);
      this.emit();
    }
  }

  private emit(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (err) {
        console.error("note index listener error", err);
      }
    }
  }
}

export const noteIndexStore = new NoteIndexStore();
