"use client";

import { useEffect, useState } from "react";
import type { Note } from "@quickwiki/shared";
import { noteRepo } from "@/lib/data/repository";
import { getSearchManager } from "@/lib/search/search-manager";

/**
 * 全局搜索（MiniSearch 索引，按排名排序，不受笔记本/标签过滤限制）。
 * 桌面侧栏树与移动端列表栏共用；150ms 防抖避免逐键全量检索。
 */
export function useSearchResults(query: string) {
  const [results, setResults] = useState<Note[] | null>(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = setTimeout(async () => {
      const hits = await getSearchManager().search(q);
      const notes = await noteRepo.listByIds(hits.map((h) => h.id));
      const noteMap = new Map(notes.map((n) => [n.id, n]));
      // 保持搜索排名顺序
      setResults(
        hits
          .map((h) => noteMap.get(h.id))
          .filter((n): n is Note => Boolean(n))
      );
      setSearching(false);
    }, 150);
    return () => clearTimeout(timer);
  }, [query]);

  const isSearching = query.trim().length > 0;
  return { results, searching, isSearching };
}
