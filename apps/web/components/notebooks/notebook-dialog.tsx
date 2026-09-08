"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { notebookRepo } from "@/lib/data/repository";
import { NOTEBOOK_COLORS } from "@quickwiki/shared";
import { cn } from "@/lib/utils";

interface NotebookDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = 新建；否则为该笔记本 id */
  editingId: string | null;
  initialName: string;
  initialColor: string;
}

/** 新建/重命名笔记本对话框 */
export function NotebookDialog({
  open,
  onOpenChange,
  editingId,
  initialName,
  initialColor,
}: NotebookDialogProps) {
  const [name, setName] = useState(initialName);
  const [color, setColor] = useState(initialColor);

  useEffect(() => {
    if (open) {
      setName(initialName);
      setColor(initialColor);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editingId]);

  const submit = async () => {
    if (!name.trim()) return;
    if (editingId) {
      await notebookRepo.update(editingId, { name: name.trim(), color });
    } else {
      await notebookRepo.create(name.trim(), color);
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editingId ? "重命名笔记本" : "新建笔记本"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="笔记本名称"
            autoFocus
          />
          <div className="flex flex-wrap gap-2">
            {NOTEBOOK_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`选择颜色 ${c}`}
                onClick={() => setColor(c)}
                className={cn(
                  "h-7 w-7 rounded-full transition-transform",
                  color === c &&
                    "scale-110 ring-2 ring-foreground ring-offset-2 ring-offset-background"
                )}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={submit}>{editingId ? "保存" : "创建"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
