"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Note } from "@quickwiki/shared";
import { noteRepo } from "@/lib/data/repository";
import { notebookPathLabel } from "@/lib/data/notebook-tree";
import { getSearchManager } from "@/lib/search/search-manager";
import { useNotebooks } from "@/hooks/use-data";

/** 命中项：笔记本体 + 索引层算好的命中摘要（摘要来自 SearchResult，不在 Note 上） */
interface SearchHit {
  note: Note;
  snippet?: string;
}

/**
 * 全局搜索（MiniSearch 索引，按排名排序，不受笔记本/标签过滤限制）。
 * 150ms 防抖避免逐键全量检索。
 */
function useSearchHits(query: string) {
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  /** 搜索管线异常（索引库损坏等）：面板显示错误提示而非永远「无结果」 */
  const [error, setError] = useState(false);
  /** 请求序号：只有最新一次搜索允许回写，防止快速输入时旧的异步结果覆盖新结果 */
  const seqRef = useRef(0);

  useEffect(() => {
    const q = query.trim();
    const seq = ++seqRef.current;
    if (!q) {
      setHits(null);
      setSearching(false);
      setError(false);
      return;
    }
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const results = await getSearchManager().search(q);
        if (seqRef.current !== seq) return;
        const notes = await noteRepo.listByIds(results.map((r) => r.id));
        if (seqRef.current !== seq) return;
        const noteMap = new Map(notes.map((n) => [n.id, n]));
        // 保持搜索排名顺序；结果按现存笔记过滤（陈旧索引条目不会出现）
        setHits(
          results.flatMap((r) => {
            const note = noteMap.get(r.id);
            return note ? [{ note, snippet: r.snippet }] : [];
          })
        );
        setError(false);
      } catch (err) {
        // 无 catch 时 rejection 直接逃逸成 unhandled rejection，UI 停在
        // 「无结果」且无任何提示。标记错误态让面板给出可操作的反馈。
        console.warn("search failed:", err);
        if (seqRef.current === seq) {
          setHits([]);
          setError(true);
        }
      } finally {
        // 成功、过期、异常都收尾，避免异常路径让 searching 永远卡在 true
        if (seqRef.current === seq) setSearching(false);
      }
    }, 150);
    return () => clearTimeout(timer);
  }, [query]);

  return { hits, searching, error };
}

/** 一条搜索结果：笔记 + 摘要 + 展示用的笔记本信息 */
export interface SearchPanelItem {
  note: Note;
  /** 命中位置的上下文摘要（已折叠空白、两端按需带省略号） */
  snippet?: string;
  /** 笔记本展示名：嵌套时含父级路径（「技术 / 前端」）；未分类为「未分类」 */
  notebookLabel: string;
  /** 笔记本颜色（hex）；未分类为 null */
  notebookColor: string | null;
}

/**
 * 悬浮搜索结果面板的数据源。
 *
 * 搜索是全局的（不受当前笔记本 / 标签过滤影响），因此每条结果都要明确
 * 标出它属于哪个笔记本——否则用户不知道这条为什么出现在当前视图里。
 */
export function useSearchPanel(query: string) {
  const { hits, searching, error } = useSearchHits(query);
  const { notebooks } = useNotebooks();

  const items = useMemo<SearchPanelItem[]>(() => {
    if (!hits || hits.length === 0) return [];

    return hits.map(({ note, snippet }) => {
      const path = notebookPathLabel(notebooks, note.notebookId);
      return {
        note,
        snippet,
        // 未分类（或笔记本尚未同步过来）都按「未分类」展示
        notebookLabel: path || "未分类",
        notebookColor: note.notebookId
          ? (notebooks.find((nb) => nb.id === note.notebookId)?.color ?? null)
          : null,
      };
    });
  }, [hits, notebooks]);

  return { items, searching, error, isSearching: query.trim().length > 0 };
}
