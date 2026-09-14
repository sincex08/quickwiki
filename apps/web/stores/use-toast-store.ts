import { create } from "zustand";

/**
 * 轻量 toast（无第三方依赖）：图片插入失败等场景的用户反馈。
 * 组件外可直接 useToastStore.getState().show(...) 调用。
 */

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastItem {
  id: number;
  message: string;
  variant: "error" | "success";
  action?: ToastAction;
}

export interface ShowToastOptions {
  action?: ToastAction;
  /** 自动消失毫秒数；默认 3000，带操作按钮时 6000 */
  duration?: number;
}

interface ToastState {
  toasts: ToastItem[];
  show: (
    message: string,
    variant?: ToastItem["variant"],
    options?: ShowToastOptions
  ) => number;
  dismiss: (id: number) => void;
}

let nextId = 1;

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  show: (message, variant = "error", options) => {
    const id = nextId++;
    set((s) => ({
      toasts: [...s.toasts, { id, message, variant, action: options?.action }],
    }));
    // 带操作按钮（如撤销）的 toast 给用户留足反应时间
    const duration = options?.duration ?? (options?.action ? 6000 : 3000);
    setTimeout(() => get().dismiss(id), duration);
    return id;
  },
  dismiss: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
