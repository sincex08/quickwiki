"use client";

import { useEffect } from "react";
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
 * 注意：Portal 挂到 body 后，覆盖层虽然视觉上全屏，
 * 但点击仍需依赖该元素自身命中。为保证「点击遮罩关闭」在
 * 移动端和任意布局下都可靠，这里用 onPointerDown/onClick 双保险，
 * 并在关闭按钮上 stopPropagation，避免与遮罩关闭重复触发。
 */
export function Lightbox({ src, alt, onClose }: LightboxProps) {
  useEffect(() => {
    if (!src) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey, true);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = prevOverflow;
    };
  }, [src, onClose]);

  if (!src || typeof document === "undefined") return null;

  const stop = (e: React.SyntheticEvent) => {
    e.stopPropagation();
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={alt || "图片预览"}
      className="fixed inset-0 z-[100] flex items-center justify-center overscroll-contain bg-black/90 p-4 animate-in fade-in duration-200"
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
        onPointerDown={stop}
        onClick={stop}
      />
    </div>,
    document.body
  );
}
