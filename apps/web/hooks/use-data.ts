"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  notebookRepo,
  noteRepo,
  tagRepo,
} from "@/lib/data/repository";
import { attachmentRepo } from "@/lib/data/attachment-repository";
import { noteIndexStore } from "@/lib/data/note-index-store";
import type { AttachmentRecord } from "@/lib/db";
import { subscribe } from "@/lib/events";
import { debounce } from "@/lib/utils";
import type {
  ListFilters,
  Note,
  Notebook,
  NotebookFilter,
  Paginated,
  Tag,
} from "@quickwiki/shared";
import { DEFAULT_PAGE_SIZE } from "@quickwiki/shared";
import type { NoteIndexItem } from "@/lib/data/repository";

export interface NotesFilters {
  notebookId?: NotebookFilter | null;
  tag?: string | null;
}

/**
 * 订阅回调的合并窗口（毫秒）：同一时间窗内的事件风暴（批量同步逐行/逐批
 * emitChange）只触发一次读库。初次挂载不走防抖（直接 load）。
 */
const EVENT_MERGE_MS = 50;

export function useNotebooks() {
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const load = () => {
      notebookRepo.list().then((list) => {
        if (!active) return;
        setNotebooks(list);
        setLoading(false);
      });
    };
    const scheduleLoad = debounce(load, EVENT_MERGE_MS);
    load();
    const unsub = subscribe("notebooks", scheduleLoad);
    return () => {
      active = false;
      scheduleLoad.cancel();
      unsub();
    };
  }, []);

  return { notebooks, loading };
}

/**
 * 笔记列表（置顶优先 + 分页加载更多）。
 * 订阅 notes 变更事件，任何 CRUD/自动保存后自动刷新。
 */
export function useNotes(filters: NotesFilters) {
  const [limit, setLimit] = useState(DEFAULT_PAGE_SIZE);
  const [result, setResult] = useState<Paginated<Note>>({
    items: [],
    total: 0,
    hasMore: false,
  });
  const [loading, setLoading] = useState(true);

  const filtersKey = `${filters.notebookId ?? ""}|${filters.tag ?? ""}`;

  // 切换过滤器时重置分页 + 进入 loading：切换瞬间 items 还是上一次的结果，
  // 不重置 loading 会渲染旧笔记本的卡片或 EmptyState「还没有笔记」，直到新数据
  // 回来才切换——表现为「有时卡片有时无笔记」。重置后显示 skeleton 过渡。
  useEffect(() => {
    setLimit(DEFAULT_PAGE_SIZE);
    setLoading(true);
  }, [filtersKey]);

  useEffect(() => {
    let active = true;
    const load = () => {
      const query: ListFilters = { limit };
      if (filters.notebookId) query.notebookId = filters.notebookId;
      if (filters.tag) query.tag = filters.tag;
      noteRepo.list(query).then((res) => {
        if (!active) return;
        setResult(res);
        setLoading(false);
      });
    };
    const scheduleLoad = debounce(load, EVENT_MERGE_MS);
    load();
    const unsub = subscribe("notes", scheduleLoad);
    return () => {
      active = false;
      scheduleLoad.cancel();
      unsub();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtersKey, limit]);

  const loadMore = useCallback(() => {
    setLimit((l) => l + DEFAULT_PAGE_SIZE);
  }, []);

  return { ...result, loading, loadMore };
}

export function useNote(id: string | null) {
  const [note, setNote] = useState<Note | null>(null);
  const [loading, setLoading] = useState(false);
  /** 当前 id 的加载是否已完成（区分「加载中」与「确认不存在」） */
  const [loaded, setLoaded] = useState(false);
  /** 请求序号：id 切换后，旧请求 / 旧订阅的回写一律丢弃，防陈旧数据闪回与串写 */
  const seqRef = useRef(0);

  useEffect(() => {
    const seq = ++seqRef.current;
    if (!id) {
      setNote(null);
      setLoading(false);
      setLoaded(false);
      return;
    }
    // 保留旧笔记渲染到新数据就绪：IndexedDB 单键读取很快，清空反而让编辑区
    // 每次切换都闪一帧空白。串写防护不依赖这里——保存目标以 note 自身 id 为准，
    // 且防抖回调携带发起时的 id 校验当前笔记（editor-pane）
    setLoading(true);
    setLoaded(false);
    const load = () => {
      noteRepo.findById(id).then((n) => {
        // 卸载后不再 setState（seq 校验只防切笔记后的陈旧回写，不防卸载）
        if (!active || seqRef.current !== seq) return;
        setNote(n);
        setLoading(false);
        setLoaded(true);
      });
    };
    const scheduleLoad = debounce(load, EVENT_MERGE_MS);
    let active = true;
    load();
    const unsub = subscribe("notes", scheduleLoad);
    return () => {
      active = false;
      scheduleLoad.cancel();
      unsub();
    };
  }, [id]);

  return { note, loading, loaded };
}

export function useTags() {
  const [tags, setTags] = useState<Tag[]>([]);

  useEffect(() => {
    let active = true;
    const load = () => {
      tagRepo.list().then((list) => {
        if (active) setTags(list);
      });
    };
    const scheduleLoad = debounce(load, EVENT_MERGE_MS);
    load();
    const unsubTags = subscribe("tags", scheduleLoad);
    const unsubNotes = subscribe("notes", scheduleLoad);
    return () => {
      active = false;
      scheduleLoad.cancel();
      unsubTags();
      unsubNotes();
    };
  }, []);

  return { tags };
}

export interface NoteCountsResult {
  all: number;
  uncategorized: number;
  byNotebook: Record<string, number>;
}

export function useNoteCounts() {
  const [counts, setCounts] = useState<NoteCountsResult>({
    all: 0,
    uncategorized: 0,
    byNotebook: {},
  });

  useEffect(() => {
    let active = true;
    const load = () => {
      noteRepo.counts().then((c) => {
        if (active) setCounts(c);
      });
    };
    const scheduleLoad = debounce(load, EVENT_MERGE_MS);
    load();
    const unsubNotes = subscribe("notes", scheduleLoad);
    const unsubNotebooks = subscribe("notebooks", scheduleLoad);
    return () => {
      active = false;
      scheduleLoad.cancel();
      unsubNotes();
      unsubNotebooks();
    };
  }, []);

  return counts;
}

/**
 * 侧栏树索引：全量笔记的轻量行（不含正文）。
 * 数据来自模块级增量缓存（note-index-store）：首次全量加载后按事件的
 * ids 增量合并，未变更行保留对象引用（配合行组件 memo，打字自动保存
 * 不再触发全表读 + 整树重渲染）。
 */
export function useNotesIndex() {
  const [items, setItems] = useState<NoteIndexItem[]>(() =>
    noteIndexStore.getSnapshot()
  );
  const [loading, setLoading] = useState(() => noteIndexStore.isLoading());

  useEffect(() => {
    let active = true;
    const unsub = noteIndexStore.subscribe(() => {
      if (!active) return;
      setItems(noteIndexStore.getSnapshot());
      setLoading(false);
    });
    return () => {
      active = false;
      unsub();
    };
  }, []);

  return { items, loading };
}

/**
 * 某笔记的附件记录（**仅元数据**，不含 blob——网格缩略图按 id 经
 * useAttachmentImgSrc 按需解析，几十张图的笔记不再把全部 blob 常驻内存）。
 * 需要 blob 的操作（预览/下载）按 id 单独 getRecord。
 */
export function useAttachmentMetaRecords(noteId: string | null) {
  const [records, setRecords] = useState<AttachmentRecord[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!noteId) {
      setRecords([]);
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    const load = () => {
      attachmentRepo.listMetaByNote(noteId).then((list) => {
        if (!active) return;
        setRecords(list);
        setLoading(false);
      });
    };
    const scheduleLoad = debounce(load, EVENT_MERGE_MS);
    load();
    const unsub = subscribe("attachments", scheduleLoad);
    return () => {
      active = false;
      scheduleLoad.cancel();
      unsub();
    };
  }, [noteId]);

  return { records, loading };
}

/**
 * 某笔记的附件记录（含 blob，抽屉缩略图用）。
 * 订阅 attachments 变更，上传/删除/重命名后自动刷新。
 */
export function useAttachmentRecords(noteId: string | null) {
  const [records, setRecords] = useState<AttachmentRecord[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!noteId) {
      setRecords([]);
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    const load = () => {
      attachmentRepo.listRecordsByNote(noteId).then((list) => {
        if (!active) return;
        setRecords(list);
        setLoading(false);
      });
    };
    const scheduleLoad = debounce(load, EVENT_MERGE_MS);
    load();
    const unsub = subscribe("attachments", scheduleLoad);
    return () => {
      active = false;
      scheduleLoad.cancel();
      unsub();
    };
  }, [noteId]);

  return { records, loading };
}
