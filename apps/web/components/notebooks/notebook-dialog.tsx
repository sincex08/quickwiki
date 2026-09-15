"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { canSetParent, notebookRepo } from "@/lib/data/repository";
import { useNotebooks } from "@/hooks/use-data";
import { useToastStore } from "@/stores/use-toast-store";
import type { Notebook } from "@quickwiki/shared";
import { NOTEBOOK_COLORS } from "@quickwiki/shared";
import { cn } from "@/lib/utils";

interface NotebookDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = 新建；否则为该笔记本 id */
  editingId: string | null;
  initialName: string;
  initialColor: string;
  /** 编辑时的当前父级；新建时的默认父级（null = 顶层） */
  initialParentId?: string | null;
}

/** 新建/编辑笔记本对话框（含父级选择：支持先建容器再建，也可直接选父级） */
export function NotebookDialog({
  open,
  onOpenChange,
  editingId,
  initialName,
  initialColor,
  initialParentId = null,
}: NotebookDialogProps) {
  const [name, setName] = useState(initialName);
  const [color, setColor] = useState(initialColor);
  const [parentId, setParentId] = useState<string | null>(initialParentId);
  const { notebooks } = useNotebooks();

  useEffect(() => {
    if (open) {
      setName(initialName);
      setColor(initialColor);
      setParentId(initialParentId ?? null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editingId]);

  /** 父级候选：排除自身及其后代（会成环） */
  const eligibleParents = useMemo(() => {
    const childrenOf = new Map<string | null, Notebook[]>();
    for (const nb of notebooks) {
      const arr = childrenOf.get(nb.parentId ?? null);
      if (arr) arr.push(nb);
      else childrenOf.set(nb.parentId ?? null, [nb]);
    }
    const excluded = new Set<string>();
    if (editingId) {
      const stack = [editingId];
      while (stack.length > 0) {
        const cur = stack.pop()!;
        excluded.add(cur);
        for (const child of childrenOf.get(cur) ?? []) stack.push(child.id);
      }
    }
    return notebooks.filter((nb) => !excluded.has(nb.id));
  }, [notebooks, editingId]);

  const submit = async () => {
    if (!name.trim()) return;
    const nextParent = parentId ?? null;
    try {
      if (editingId) {
        if (
          nextParent &&
          !(await canSetParent(editingId, nextParent))
        ) {
          useToastStore.getState().show("不能把笔记本移动到它自己的子级", "error");
          return;
        }
        await notebookRepo.update(editingId, {
          name: name.trim(),
          color,
          parentId: nextParent,
        });
      } else {
        await notebookRepo.create({
          name: name.trim(),
          color,
          parentId: nextParent,
        });
      }
      onOpenChange(false);
    } catch (e) {
      useToastStore
        .getState()
        .show(e instanceof Error ? e.message : "保存失败", "error");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editingId ? "编辑笔记本" : "新建笔记本"}</DialogTitle>
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
          <div className="space-y-1.5">
            <label
              htmlFor="notebook-parent"
              className="text-xs text-muted-foreground"
            >
              父级笔记本（可当作文件夹分组，留空为顶层）
            </label>
            <select
              id="notebook-parent"
              value={parentId ?? ""}
              onChange={(e) => setParentId(e.target.value || null)}
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="">无（顶层）</option>
              {eligibleParents.map((nb) => (
                <option key={nb.id} value={nb.id}>
                  {nb.name}
                </option>
              ))}
            </select>
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
