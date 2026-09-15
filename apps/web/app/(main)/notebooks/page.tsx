"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { zhCN } from "date-fns/locale";
import type { Notebook } from "@quickwiki/shared";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { NotebookDialog } from "@/components/notebooks/notebook-dialog";
import { EmptyState } from "@/components/notes/empty-state";
import { useNotebooks, useNoteCounts } from "@/hooks/use-data";
import { useUIStore } from "@/stores/use-ui-store";
import { notebookRepo } from "@/lib/data/repository";
import { cn } from "@/lib/utils";
import { NOTEBOOK_COLORS } from "@quickwiki/shared";

export default function NotebooksPage() {
  const router = useRouter();
  const { notebooks, loading } = useNotebooks();
  const counts = useNoteCounts();
  const notebookFilter = useUIStore((s) => s.notebookFilter);
  const setNotebookFilter = useUIStore((s) => s.setNotebookFilter);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Notebook | null>(null);

  const openNotebook = (id: string) => {
    setNotebookFilter(id);
    router.push("/notes");
  };

  const confirmDelete = async () => {
    if (pendingDelete) {
      await notebookRepo.delete(pendingDelete.id);
      setPendingDelete(null);
    }
  };

  const editing = notebooks.find((n) => n.id === editingId);
  const nameById = new Map(notebooks.map((n) => [n.id, n.name]));
  /** 父级缺失（远端删除先到）时不显示上级行 */
  const parentNameOf = (nb: Notebook) =>
    nb.parentId ? nameById.get(nb.parentId) ?? null : null;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl p-4 md:p-6">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-lg font-semibold">笔记本</h1>
          <Button
            size="sm"
            className="gap-1.5"
            onClick={() => {
              setEditingId(null);
              setDialogOpen(true);
            }}
          >
            <Plus className="h-4 w-4" />
            新建笔记本
          </Button>
        </div>

        {!loading && notebooks.length === 0 ? (
          <EmptyState
            title="还没有笔记本"
            description="创建笔记本来整理你的笔记"
            actionLabel="新建笔记本"
            onAction={() => {
              setEditingId(null);
              setDialogOpen(true);
            }}
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {notebooks.map((nb) => (
              <div
                key={nb.id}
                className={cn(
                  "group relative rounded-lg border bg-card p-4 transition-colors hover:border-primary/40",
                  notebookFilter === nb.id && "border-primary ring-1 ring-primary/30"
                )}
              >
                <button
                  type="button"
                  className="w-full text-left"
                  onClick={() => openNotebook(nb.id)}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="h-3 w-3 rounded-full"
                      style={{ backgroundColor: nb.color }}
                    />
                    <span className="truncate font-medium">{nb.name}</span>
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground">
                    {counts.byNotebook[nb.id] ?? 0} 篇笔记 · 创建于{" "}
                    {format(nb.createdAt, "yyyy-MM-dd", { locale: zhCN })}
                  </div>
                  {parentNameOf(nb) && (
                    <div className="mt-1 text-xs text-muted-foreground">
                      上级：{parentNameOf(nb)}
                    </div>
                  )}
                </button>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label={`笔记本 ${nb.name} 操作`}
                      title={`笔记本「${nb.name}」：重命名 / 删除`}
                      className="absolute right-1.5 top-1.5 rounded p-3 text-muted-foreground transition-opacity hover:bg-accent lg:right-2 lg:top-2 lg:p-1 lg:opacity-0 lg:group-hover:opacity-100 lg:focus:opacity-100"
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onClick={() => {
                        setEditingId(nb.id);
                        setDialogOpen(true);
                      }}
                    >
                      <Pencil className="h-4 w-4" />
                      重命名
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={() => setPendingDelete(nb)}
                    >
                      <Trash2 className="h-4 w-4" />
                      删除
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ))}
          </div>
        )}
      </div>

      <NotebookDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editingId={editingId}
        initialName={editing?.name ?? ""}
        initialColor={editing?.color ?? NOTEBOOK_COLORS[0]}
        initialParentId={editing?.parentId ?? null}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        title="删除笔记本？"
        description={`「${pendingDelete?.name ?? ""}」将被删除，其中的笔记会保留并移动到「全部笔记」。此操作无法撤销。`}
        confirmLabel="删除"
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
