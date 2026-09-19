"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { noteRepo } from "@/lib/data/repository";
import { attachmentRepo } from "@/lib/data/attachment-repository";
import type { AttachmentRecord } from "@/lib/db";
import { useToastStore } from "@/stores/use-toast-store";
import { useUIStore } from "@/stores/use-ui-store";
import type { Note, NotebookFilter } from "@quickwiki/shared";

/**
 * 删除笔记并开启撤销窗口：删除前缓存笔记与附件（含 blob），
 * toast 内点「撤销」按原 id 完整恢复。同步语义见 sync-engine 复活路径：
 * 墓碑未推送时 outbox 覆盖为 upsert；已推送时恢复走「本地更新晚于删除意图」复活。
 */
async function undoDelete(note: Note, attachments: AttachmentRecord[]) {
  await noteRepo.restore(note);
  await attachmentRepo.restore(attachments);
}

/**
 * 新建笔记的归属：显式参数 > 当前打开笔记所属笔记本 > 侧栏选中的笔记本 > 未分类。
 *
 * 为什么让「打开的笔记」优先：顶部「新建笔记」是最常用入口，而侧栏的选中态
 * 往往还是「上次点开的那个笔记本」，与正在写的内容无关 —— 按它落位就会出现
 * 「正文是 A 的、新建却进了 B」。要明确建到某个笔记本，走侧栏该笔记本行上的
 * 「新建笔记」（显式参数），或建完在编辑区头部的「移动到笔记本」里改。
 */
async function resolveTargetNotebook(
  options: { notebookId?: string | null } | undefined,
  activeNoteId: string | null,
  notebookFilter: NotebookFilter | null
): Promise<string | null> {
  if (options && options.notebookId !== undefined) return options.notebookId;
  if (activeNoteId) {
    const active = await noteRepo.findById(activeNoteId);
    if (active) return active.notebookId ?? null;
  }
  // "none" 是「未分类」这一筛选条件而非真实笔记本 id
  if (notebookFilter && notebookFilter !== "none") return notebookFilter;
  return null;
}

/** 笔记动作：创建后跳转、删除后清理选中态 */
export function useNoteActions() {
  const router = useRouter();
  const notebookFilter = useUIStore((s) => s.notebookFilter);
  const openNote = useUIStore((s) => s.openNote);
  const activeNoteId = useUIStore((s) => s.activeNoteId);

  const createNote = useCallback(
    async (options?: { notebookId?: string | null }) => {
      const notebookId = await resolveTargetNotebook(
        options,
        activeNoteId,
        notebookFilter
      );
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
    [activeNoteId, notebookFilter, openNote, router]
  );

  /**
   * 顶部「新建笔记」的落点解析：与 createNote 共用同一套优先级。
   * 供二次确认弹窗展示「将建到哪个笔记本」——确认后再按这个结果显式创建，
   * 避免用户在弹窗里看到的落点与真正落点不一致（2026-09-19）。
   */
  const resolveNewNoteTarget = useCallback(
    () => resolveTargetNotebook(undefined, activeNoteId, notebookFilter),
    [activeNoteId, notebookFilter]
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
    // 置顶 = 移到容器最前：pinned 永远最前，这里再重排编号，保证取消置顶后也留在最前
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

  /** 恢复该容器的默认顺序（置顶 + 创建时间升序，早创建的在前） */
  const resetOrder = useCallback(async (notebookId: string | null) => {
    await noteRepo.resetOrder(notebookId);
  }, []);

  return {
    createNote,
    resolveNewNoteTarget,
    deleteNote,
    togglePin,
    moveToNotebook,
    moveNoteToPosition,
    moveNote,
    resetOrder,
  };
}
