"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

/**
 * 拖动笔记调整顺序（侧栏树 + 手机卡片列表共用）。
 *
 * 两种输入走两套激活方式，因为要抢的手势不一样：
 * - **鼠标**：移动超过 4px 即进入拖动（点击与拖动靠位移区分）。
 * - **触摸**：按住约 400ms 才进入拖动；长按期间手指移动超过 8px 视为「用户在滚列表」，
 *   直接放弃 —— 手机上按住滑动默认是滚动，长按才是拖动（iOS 列表重排 / Notion 同款）。
 *   进入拖动后会 `preventDefault` 掉 touchmove 并给该行锁 `touch-action: none`，
 *   避免页面跟着手指滚；同时压掉长按呼出的右键菜单。
 *
 * 用 pointer 事件而不是 HTML5 拖放：拖放 API 在 React 树里要处理
 * dragenter/dragover 一堆默认行为，且在触摸设备上根本不可用。
 *
 * DOM 约定（由渲染方写入，见 noteRowDragProps）：
 * - 笔记行 / 卡片：`data-note-id` / `data-note-container`（notebookId ?? ""）/ `data-note-index`
 * - 可作为「移入这个容器」落点的行：`data-note-drop-container`
 * - 不做拖拽起点的交互元素：`data-no-drag`（如行尾操作按钮）
 * - 滚动容器（自动滚动用）：`data-note-drag-scroll`
 */

/** 落点：插入到某容器的第 index 位（0 = 最前） */
export interface DropTarget {
  /** 容器 key（notebookId ?? ""）；仅用于渲染插入指示线 */
  containerKey: string;
  /** 目标笔记本，null = 未分类 */
  notebookId: string | null;
  /** 插入位置（移除被拖项之前的基准下标） */
  index: number;
}

/** 可拖动的对象：Note 与 NoteIndexItem 都满足 */
export interface DraggableNote {
  id: string;
  notebookId: string | null;
}

/** 鼠标：位移超过它即算拖动 */
const MOUSE_THRESHOLD_PX = 4;
/** 触摸：按住多久进入拖动 */
const LONG_PRESS_MS = 400;
/** 触摸：长按期间允许的抖动，超过即认为在滚动 */
const LONG_PRESS_TOLERANCE_PX = 8;
/** 靠近滚动容器上下边缘时的自动滚动 */
const EDGE_SCROLL_PX = 56;
const EDGE_SCROLL_STEP = 24;

interface Pending {
  id: string;
  containerKey: string;
  /** 被拖对象在其容器内当前的下标 */
  fromIndex: number;
  startX: number;
  startY: number;
  pointerType: string;
}

export function useNoteDrag(
  onDrop: (id: string, notebookId: string | null, index: number) => void
) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const pendingRef = useRef<Pending | null>(null);
  const activeRef = useRef<Pending | null>(null);
  const dropRef = useRef<DropTarget | null>(null);
  const rowElRef = useRef<HTMLElement | null>(null);
  const longPressRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onDropRef = useRef(onDrop);
  onDropRef.current = onDrop;

  const preventContextMenu = useCallback((e: Event) => {
    e.preventDefault();
  }, []);

  const clearLongPress = useCallback(() => {
    if (longPressRef.current !== null) {
      clearTimeout(longPressRef.current);
      longPressRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    clearLongPress();
    pendingRef.current = null;
    activeRef.current = null;
    dropRef.current = null;
    setDraggingId(null);
    setDropTarget(null);
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
    if (rowElRef.current) {
      rowElRef.current.style.touchAction = "";
      rowElRef.current = null;
    }
    document.removeEventListener("contextmenu", preventContextMenu, {
      capture: true,
    });
  }, [clearLongPress, preventContextMenu]);

  /** 进入拖动状态（鼠标位移达标 / 触摸长按到点） */
  const activate = useCallback((pending: Pending) => {
    activeRef.current = { ...pending };
    setDraggingId(pending.id);
    document.body.style.userSelect = "none";
    document.body.style.cursor = "grabbing";
    if (rowElRef.current) rowElRef.current.style.touchAction = "none";
    document.addEventListener("contextmenu", preventContextMenu, {
      capture: true,
    });
  }, [preventContextMenu]);

  /** 指针下的滚动容器：取「包含指针」且可见的那个（隐藏的侧栏/抽屉不算） */
  const findScroller = (x: number, y: number): HTMLElement | null => {
    const all = Array.from(
      document.querySelectorAll<HTMLElement>("[data-note-drag-scroll]")
    ).filter((el) => el.getClientRects().length > 0);
    for (const el of all) {
      const r = el.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return el;
    }
    return all[0] ?? null;
  };

  /** 计算指针下方的落点 */
  const resolveTarget = useCallback((x: number, y: number): DropTarget | null => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    if (!el) return null;

    const noteRow = el.closest<HTMLElement>("[data-note-id]");
    if (noteRow) {
      const id = noteRow.dataset.noteId!;
      if (id === activeRef.current?.id) return null; // 悬停在自己身上：保持上一个落点
      const rect = noteRow.getBoundingClientRect();
      const after = y > rect.top + rect.height / 2;
      const containerKey = noteRow.dataset.noteContainer ?? "";
      const index = Number(noteRow.dataset.noteIndex ?? "0") + (after ? 1 : 0);
      return {
        containerKey,
        notebookId: containerKey === "" ? null : containerKey,
        index,
      };
    }

    // 笔记本行 / 未分类行：拖上去即移入该容器，置于最前
    const containerRow = el.closest<HTMLElement>("[data-note-drop-container]");
    if (containerRow) {
      const containerKey = containerRow.dataset.noteDropContainer ?? "";
      return {
        containerKey,
        notebookId: containerKey === "" ? null : containerKey,
        index: 0,
      };
    }
    return null;
  }, []);

  const commit = useCallback(() => {
    const active = activeRef.current;
    const target = dropRef.current;
    reset();
    if (!active || !target) return;
    const sameContainer = target.containerKey === active.containerKey;
    if (sameContainer) {
      // 同容器内索引换算：移除自身后下标会前移一位
      const finalIndex =
        target.index > active.fromIndex ? target.index - 1 : target.index;
      if (finalIndex === active.fromIndex) return; // 落回原位：不写库
    }
    onDropRef.current(active.id, target.notebookId, target.index);
  }, [reset]);

  /** 行 / 卡片上的 pointerdown：记录起点；触摸走长按倒计时 */
  const startDrag = useCallback(
    (e: ReactPointerEvent<HTMLElement>, note: DraggableNote) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      if (target.closest("[data-no-drag]")) return;

      const row = e.currentTarget;
      const pending: Pending = {
        id: note.id,
        containerKey: row.dataset.noteContainer ?? "",
        fromIndex: Number(row.dataset.noteIndex ?? "0"),
        startX: e.clientX,
        startY: e.clientY,
        pointerType: e.pointerType,
      };
      pendingRef.current = pending;
      rowElRef.current = row;

      if (pending.pointerType === "touch" || pending.pointerType === "pen") {
        clearLongPress();
        longPressRef.current = setTimeout(() => {
          longPressRef.current = null;
          if (!pendingRef.current) return;
          activate(pendingRef.current);
          // 轻振动提示「已进入拖动」（不支持的浏览器静默忽略）
          const nav = navigator as Navigator & { vibrate?: (p: number) => boolean };
          try {
            nav.vibrate?.(10);
          } catch {
            /* 忽略 */
          }
        }, LONG_PRESS_MS);
      }
    },
    [activate, clearLongPress]
  );

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const pending = pendingRef.current;
      if (!pending) return;

      if (!activeRef.current) {
        const dx = Math.abs(e.clientX - pending.startX);
        const dy = Math.abs(e.clientY - pending.startY);
        if (pending.pointerType === "touch" || pending.pointerType === "pen") {
          // 长按倒计时期间手指移动过多：用户在滚列表，放弃拖动
          if (dx > LONG_PRESS_TOLERANCE_PX || dy > LONG_PRESS_TOLERANCE_PX) {
            clearLongPress();
            pendingRef.current = null;
            rowElRef.current = null;
          }
          return;
        }
        if (dx < MOUSE_THRESHOLD_PX && dy < MOUSE_THRESHOLD_PX) return;
        activate(pending);
      }

      // 靠近滚动容器上下边缘时自动滚动（长列表拖动不必先滚到目标位置）
      const scroller = findScroller(e.clientX, e.clientY);
      if (scroller) {
        const rect = scroller.getBoundingClientRect();
        if (e.clientY < rect.top + EDGE_SCROLL_PX) {
          scroller.scrollTop -= EDGE_SCROLL_STEP;
        } else if (e.clientY > rect.bottom - EDGE_SCROLL_PX) {
          scroller.scrollTop += EDGE_SCROLL_STEP;
        }
      }

      const next = resolveTarget(e.clientX, e.clientY);
      if (next) {
        dropRef.current = next;
        setDropTarget(next);
      }
    };

    /** 拖动中拦掉页面滚动（触摸）：pointermove 的 preventDefault 管不了滚动 */
    const onTouchMove = (e: TouchEvent) => {
      if (activeRef.current) e.preventDefault();
    };

    const onUp = () => {
      clearLongPress();
      if (activeRef.current) {
        // 吞掉紧随其后的一次 click（拖拽结束不该打开笔记）
        const swallow = (ev: MouseEvent) => {
          ev.stopPropagation();
          ev.preventDefault();
        };
        window.addEventListener("click", swallow, { capture: true, once: true });
        setTimeout(
          () => window.removeEventListener("click", swallow, { capture: true }),
          0
        );
        commit();
        return;
      }
      pendingRef.current = null;
      rowElRef.current = null;
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && (activeRef.current || pendingRef.current)) reset();
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("keydown", onKey);
    };
  }, [activate, clearLongPress, commit, reset, resolveTarget]);

  // 卸载时别把 body / 行的样式留在拖拽态
  useEffect(() => () => reset(), [reset]);

  return { draggingId, dropTarget, startDrag };
}

/** 生成可拖拽行 / 卡片的数据属性（与 useNoteDrag 的约定配套） */
export function noteRowDragProps(
  note: DraggableNote,
  index: number
): Record<string, string> {
  return {
    "data-note-id": note.id,
    "data-note-container": note.notebookId ?? "",
    "data-note-index": String(index),
  };
}
