"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { noteRepo } from "@/lib/data/repository";
import { useUIStore } from "@/stores/use-ui-store";

/** 笔记动作：创建后跳转、删除后清理选中态 */
export function useNoteActions() {
  const router = useRouter();
  const notebookFilter = useUIStore((s) => s.notebookFilter);
  const openNote = useUIStore((s) => s.openNote);
  const activeNoteId = useUIStore((s) => s.activeNoteId);

  const createNote = useCallback(async () => {
    // "none" 是「仅未分类」这一视图过滤条件，不是笔记本 id：此时新建笔记应为未分类
    const notebookId =
      notebookFilter && notebookFilter !== "none" ? notebookFilter : null;
    const id = await noteRepo.create({ notebookId });
    openNote(id);
    // 仅从其他页面创建时跳转；已在 /notes 时跳转会堆叠历史记录并与 URL 同步竞争
    if (typeof window !== "undefined" && window.location.pathname !== "/notes") {
      router.push("/notes");
    }
    return id;
  }, [notebookFilter, openNote, router]);

  const deleteNote = useCallback(
    async (id: string) => {
      await noteRepo.delete(id);
      if (activeNoteId === id) {
        openNote(null);
      }
    },
    [activeNoteId, openNote]
  );

  const togglePin = useCallback(async (id: string, pinned: boolean) => {
    await noteRepo.update(id, { pinned: !pinned });
  }, []);

  const moveToNotebook = useCallback(async (id: string, notebookId: string | null) => {
    await noteRepo.update(id, { notebookId });
  }, []);

  return { createNote, deleteNote, togglePin, moveToNotebook };
}
