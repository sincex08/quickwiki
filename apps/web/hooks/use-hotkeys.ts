"use client";

import { useEffect } from "react";
import { useUIStore, requestNewNoteConfirm } from "@/stores/use-ui-store";

/** 全局快捷键在哪个断点以上启用（与 Tailwind md 一致；移动端无物理键盘） */
function isDesktop(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches;
}

/** 编辑模式循环顺序：编辑 → 源码 → 预览 */
const MODE_CYCLE = ["edit", "source", "preview"] as const;

/**
 * 全局键盘快捷键（桌面端）：
 * - Ctrl/Cmd+K  命令面板
 * - Ctrl/Cmd+N  新建笔记（走落点确认流程，与顶部按钮 / FAB 一致）
 * - Ctrl/Cmd+F  聚焦搜索框（搜索框内监听 quickwiki:focus-search 事件）
 * - Ctrl/Cmd+S  立即保存（编辑器监听 quickwiki:flush-save 事件，flush 防抖草稿）
 * - Ctrl/Cmd+E  循环切换 编辑/源码/预览
 * - Ctrl/Cmd+/  功能说明（含快捷键速查）
 *
 * 全部带 ctrl/meta 修饰，不会与普通打字冲突；Tiptap 自有的 Ctrl+B/I 等不经过这里。
 */
export function useHotkeys(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!isDesktop()) return;
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;

      const store = useUIStore.getState();
      const key = e.key.toLowerCase();

      const handled = (() => {
        switch (key) {
          case "k":
            store.setCommandPaletteOpen(!store.commandPaletteOpen);
            return true;
          case "n":
            requestNewNoteConfirm();
            return true;
          case "f":
            window.dispatchEvent(new CustomEvent("quickwiki:focus-search"));
            return true;
          case "s": {
            e.preventDefault();
            window.dispatchEvent(new CustomEvent("quickwiki:flush-save"));
            return true;
          }
          case "e": {
            const next =
              MODE_CYCLE[(MODE_CYCLE.indexOf(store.editorMode) + 1) % MODE_CYCLE.length];
            store.setEditorMode(next);
            return true;
          }
          case "/":
            store.setHelpOpen(true);
            return true;
          default:
            return false;
        }
      })();

      // Ctrl+S/N 等有浏览器默认行为，必须阻止；Ctrl+K 会聚焦地址栏同理
      if (handled) e.preventDefault();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
