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

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={alt || "图片预览"}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 p-4 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <button
        type="button"
        aria-label="关闭预览"
        className="absolute right-4 top-4 inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
        onClick={onClose}
      >
        <X className="h-5 w-5" />
      </button>
      {/* 阻断冒泡：点击图片本身不关闭 */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt ?? ""}
        className="max-h-full max-w-full select-none object-contain"
        onClick={(e) => e.stopPropagation()}
      />
    </div>,
    document.body
  );
}
