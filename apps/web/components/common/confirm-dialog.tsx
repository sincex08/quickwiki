"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  /**
   * 确认按钮是否用危险色。删除类操作保持默认 true；
   * 新建 / 移动等普通操作传 false，用主色按钮（红色会让人以为要删东西）。
   */
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** 通用二次确认对话框（删除等不可逆操作，以及「新建到哪里」这类落点确认） */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "确认",
  destructive = true,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction
            className={cn(
              destructive &&
                "bg-destructive text-destructive-foreground hover:bg-destructive/90"
            )}
            onClick={onConfirm}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
