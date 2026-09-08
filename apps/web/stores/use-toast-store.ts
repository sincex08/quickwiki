import { create } from "zustand";

/**
 * 轻量 toast（无第三方依赖）：图片插入失败等场景的用户反馈。
 * 组件外可直接 useToastStore.getState().show(...) 调用。
 */

export interface ToastItem {
  id: number;
  message: string;
  variant: "error" | "success";
}

interface ToastState {
  toasts: ToastItem[];
  show: (message: string, variant?: ToastItem["variant"]) => void;
  dismiss: (id: number) => void;
}

let nextId = 1;

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  show: (message, variant = "error") => {
    const id = nextId++;
    set((s) => ({ toasts: [...s.toasts, { id, message, variant }] }));
    setTimeout(() => get().dismiss(id), 3000);
  },
  dismiss: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
