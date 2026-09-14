"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { noteRepo } from "@/lib/data/repository";
import { attachmentRepo } from "@/lib/data/attachment-repository";
import type { AttachmentRecord } from "@/lib/db";
import { useToastStore } from "@/stores/use-toast-store";
import { useUIStore } from "@/stores/use-ui-store";
import type { Note } from "@quickwiki/shared";

/**
 * 删除笔记并开启撤销窗口：删除前缓存笔记与附件（含 blob），
 * toast 内点「撤销」按原 id 完整恢复。同步语义见 sync-engine 复活路径：
 * 墓碑未推送时 outbox 覆盖为 upsert；已推送时恢复走「本地更新晚于删除意图」复活。
 */
async function undoDelete(note: Note, attachments: AttachmentRecord[]) {
  await noteRepo.restore(note);
  await attachmentRepo.restore(attachments);
}

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
      const note = await noteRepo.findById(id);
      if (!note) return;
      const attachments = await attachmentRepo.listRecordsByNote(id);

      // 先删附件再删笔记：笔记删除事件会触发同步层的附件级联删除，
      // 附件先删空后级联成为 no-op，撤销恢复时不存在竞态
      await attachmentRepo.deleteByIds(attachments.map((a) => a.id));
      await noteRepo.delete(id);
      if (activeNoteId === id) {
        openNote(null);
      }

      useToastStore.getState().show(`已删除「${note.title}」`, "success", {
        action: {
          label: "撤销",
          onClick: () => void undoDelete(note, attachments),
        },
      });
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
