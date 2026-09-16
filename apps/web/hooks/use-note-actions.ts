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

  const createNote = useCallback(
    async (options?: { notebookId?: string | null }) => {
      // 显式传参（含 null）以参数为准：侧栏树节点上的「新建笔记」直达目标笔记本。
      // 未传参时取当前视图过滤；"none" 是「仅未分类」这一过滤条件而非
      // 笔记本 id，此时新建笔记应为未分类
      const notebookId =
        options && options.notebookId !== undefined
          ? options.notebookId
          : notebookFilter && notebookFilter !== "none"
            ? notebookFilter
            : null;
      const id = await noteRepo.create({ notebookId });
      openNote(id);
      // 仅从其他页面创建时跳转；已在 /notes 时跳转会堆叠历史记录并与 URL 同步竞争
      if (
        typeof window !== "undefined" &&
        window.location.pathname !== "/notes"
      ) {
        router.push("/notes");
      }
      return id;
    },
    [notebookFilter, openNote, router]
  );

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
    // 取消置顶：只去掉标记（手动顺序容器里位置由编号决定，不回到原位）
    if (pinned) {
      await noteRepo.update(id, { pinned: false });
      return;
    }
    // 置顶 = 移到容器最前：手动顺序的容器里 pinned 不决定位置，需一并重排编号
    await noteRepo.pinToTop(id);
  }, []);

  const moveToNotebook = useCallback(
    async (id: string, notebookId: string | null) => {
      // 落入手动顺序的容器时仓库层会置于最前（见 noteRepo.moveToNotebook）
      await noteRepo.moveToNotebook(id, notebookId);
    },
    []
  );

  /** 拖拽落定：放到目标容器第 index 位（跨容器即同时改分类） */
  const moveNoteToPosition = useCallback(
    async (id: string, notebookId: string | null, index: number) => {
      await noteRepo.moveToPosition(id, notebookId, index);
    },
    []
  );

  /** 上移 / 下移一位（菜单微调，手机与键盘用户的主路径）；已在边界返回 false */
  const moveNote = useCallback(async (id: string, direction: -1 | 1) => {
    return noteRepo.moveBy(id, direction);
  }, []);

  /** 恢复该容器的默认顺序（置顶 + 更新时间倒序） */
  const resetOrder = useCallback(async (notebookId: string | null) => {
    await noteRepo.resetOrder(notebookId);
  }, []);

  return {
    createNote,
    deleteNote,
    togglePin,
    moveToNotebook,
    moveNoteToPosition,
    moveNote,
    resetOrder,
  };
}
