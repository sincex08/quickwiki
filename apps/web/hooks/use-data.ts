"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  notebookRepo,
  noteRepo,
  tagRepo,
} from "@/lib/data/repository";
import { attachmentRepo } from "@/lib/data/attachment-repository";
import type { AttachmentRecord } from "@/lib/db";
import { subscribe } from "@/lib/events";
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
    load();
    const unsub = subscribe("notebooks", load);
    return () => {
      active = false;
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
    load();
    const unsub = subscribe("notes", load);
    return () => {
      active = false;
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
        if (seqRef.current !== seq) return;
        setNote(n);
        setLoading(false);
        setLoaded(true);
      });
    };
    load();
    const unsub = subscribe("notes", load);
    return () => {
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
    load();
    const unsubTags = subscribe("tags", load);
    const unsubNotes = subscribe("notes", load);
    return () => {
      active = false;
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
    load();
    const unsubNotes = subscribe("notes", load);
    const unsubNotebooks = subscribe("notebooks", load);
    return () => {
      active = false;
      unsubNotes();
      unsubNotebooks();
    };
  }, []);

  return counts;
}

/**
 * 侧栏树索引：全量笔记的轻量行（不含正文），任何笔记变更后自动刷新。
 * 客户端按笔记本分组渲染，规模为本地库全量（千条级无压力）。
 */
export function useNotesIndex() {
  const [items, setItems] = useState<NoteIndexItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const load = () => {
      noteRepo.listIndex().then((list) => {
        if (!active) return;
        setItems(list);
        setLoading(false);
      });
    };
    load();
    const unsub = subscribe("notes", load);
    return () => {
      active = false;
      unsub();
    };
  }, []);

  return { items, loading };
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
    load();
    const unsub = subscribe("attachments", load);
    return () => {
      active = false;
      unsub();
    };
  }, [noteId]);

  return { records, loading };
}
