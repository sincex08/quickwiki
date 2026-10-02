"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

interface LightboxProps {
  src: string | null;
  alt?: string;
  onClose: () => void;
}

/**
 * 全屏图片预览（点击遮罩/Esc/关闭按钮退出）。
 * 用 Portal + 自管状态实现，不占用 Radix Dialog 栈，
 * 避免与抽屉/确认框嵌套时的焦点管理冲突。
 *
 * 自管焦点：打开时初始聚焦关闭按钮，Tab 在层内循环（不穿透到被遮罩的
 * 背景），关闭后焦点归还打开前的元素——绕开 Radix 就得自己补这三件事。
 *
 * 注意：Portal 挂到 body 后，覆盖层虽然视觉上全屏，
 * 但点击仍需依赖该元素自身命中。为保证「点击遮罩关闭」在
 * 移动端和任意布局下都可靠，这里用 onPointerDown/onClick 双保险，
 * 并在关闭按钮上 stopPropagation，避免与遮罩关闭重复触发。
 */
export function Lightbox({ src, alt, onClose }: LightboxProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!src) return;
    // 打开时记录来源焦点并初始聚焦关闭按钮（键盘用户 Esc/Enter 直接可控）
    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      } else if (e.key === "Tab") {
        // 简易焦点陷阱：在本层可聚焦元素间循环，不穿透到背景
        const root = rootRef.current;
        if (!root) return;
        const focusables = root.querySelectorAll<HTMLElement>(
          "button[href], button:not([disabled])"
        );
        if (focusables.length === 0) return;
        e.preventDefault();
        const current = document.activeElement;
        const idx = Array.prototype.indexOf.call(focusables, current);
        const next = e.shiftKey
          ? (idx <= 0 ? focusables.length - 1 : idx - 1)
          : (idx === focusables.length - 1 ? 0 : idx + 1);
        focusables[next]?.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = prevOverflow;
      // 焦点归还：关闭后键盘位置回到打开预览的地方（缩略图/预览按钮）
      previouslyFocused?.focus?.();
    };
  }, [src, onClose]);

  if (!src || typeof document === "undefined") return null;

  const stop = (e: React.SyntheticEvent) => {
    e.stopPropagation();
  };

  return createPortal(
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label={alt || "图片预览"}
      className="pointer-events-auto fixed inset-0 z-[100] flex items-center justify-center overscroll-contain bg-black/90 p-4 animate-in fade-in duration-200"
      // 本组件挂在 body 上，而 Radix 模态（抽屉等）打开时 react-remove-scroll
      // 会给 body 加 pointer-events:none（仅恢复自身弹层的交互）。
      // 不显式声明 pointer-events:auto 的话，本层会被命中测试跳过，
      // 点击穿透到底下的抽屉按钮上。
      // 关闭逻辑放在按下阶段：预览层出现前若已有按压，click 会被下层元素捕获
      onPointerDown={(e) => {
        // 仅当按压起点就在遮罩自身（而非图片/按钮）时才关闭
        if (e.target === e.currentTarget) {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
      }}
      // 兜底：键盘触发的 click / 事件被其它层拦截时仍可关闭
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          e.stopPropagation();
          onClose();
        }
      }}
      onPointerUp={stop}
    >
      <button
        ref={closeRef}
        type="button"
        aria-label="关闭预览"
        className="absolute right-4 top-4 inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
        onPointerDown={stop}
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      >
        <X className="h-5 w-5" />
      </button>
      {/* 阻断冒泡：点击图片本身不关闭 */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt ?? ""}
        className="max-h-full max-w-full select-none object-contain"
        draggable={false}
        onPointerDown={stop}
        onClick={stop}
      />
    </div>,
    document.body
  );
}
