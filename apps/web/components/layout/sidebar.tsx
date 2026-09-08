"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Book,
  FileText,
  MoreHorizontal,
  Pencil,
  Plus,
  Tag as TagIcon,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { NotebookDialog } from "@/components/notebooks/notebook-dialog";
import { useNotebooks, useNoteCounts, useTags } from "@/hooks/use-data";
import { useUIStore } from "@/stores/use-ui-store";
import { notebookRepo } from "@/lib/data/repository";
import { NOTEBOOK_COLORS } from "@quickwiki/shared";

/** 侧边栏主体：全部笔记 / 笔记本 / 标签 */
export function SidebarContent() {
  const router = useRouter();
  const { notebooks } = useNotebooks();
  const counts = useNoteCounts();
  const { tags } = useTags();
  const {
    notebookFilter,
    tagFilter,
    setNotebookFilter,
    setTagFilter,
    setSidebarOpen,
  } = useUIStore();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const goNotes = () => {
    setSidebarOpen(false);
    router.push("/notes");
  };

  const selectNotebook = (id: string | null) => {
    setNotebookFilter(id);
    goNotes();
  };

  const selectTag = (tag: string) => {
    setTagFilter(tagFilter === tag ? null : tag);
    goNotes();
  };

  const confirmDelete = async () => {
    if (deleteId) {
      if (notebookFilter === deleteId) setNotebookFilter(null);
      await notebookRepo.delete(deleteId);
    }
    setDeleteId(null);
  };

  return (
    <div className="flex h-full flex-col">
      {/* 品牌区 */}
      <div className="flex h-14 items-center gap-2 border-b px-4">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Book className="h-4 w-4" />
        </div>
        <span className="font-semibold">QuickWiki</span>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {/* 新建笔记本 */}
        <Button
          variant="outline"
          size="sm"
          className="mb-4 w-full justify-start gap-2"
          onClick={() => {
            setEditingId(null);
            setDialogOpen(true);
          }}
        >
          <Plus className="h-4 w-4" />
          新建笔记本
        </Button>

        {/* 全部笔记 */}
        <button
          type="button"
          onClick={() => selectNotebook(null)}
          className={cn(
            "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent",
            notebookFilter === null && !tagFilter && "bg-accent text-accent-foreground"
          )}
        >
          <FileText className="h-4 w-4 text-muted-foreground" />
          <span className="flex-1 text-left">全部笔记</span>
          <span className="text-xs text-muted-foreground">{counts.all}</span>
        </button>

        {/* 笔记本列表 */}
        <div className="mt-4">
          <div className="mb-1 px-2 text-xs font-medium text-muted-foreground">
            笔记本
          </div>
          {notebooks.length === 0 && (
            <div className="px-2 py-1 text-xs text-muted-foreground">
              暂无笔记本
            </div>
          )}
          {notebooks.map((nb) => (
            <div
              key={nb.id}
              className={cn(
                "group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent",
                notebookFilter === nb.id && "bg-accent text-accent-foreground"
              )}
            >
              <button
                type="button"
                onClick={() => selectNotebook(nb.id)}
                className="flex flex-1 items-center gap-2 overflow-hidden text-left"
              >
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: nb.color }}
                />
                <span className="truncate">{nb.name}</span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {counts.byNotebook[nb.id] ?? 0}
                </span>
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label={`笔记本 ${nb.name} 操作`}
                    title={`笔记本「${nb.name}」：重命名 / 删除`}
                    className="rounded p-2.5 text-muted-foreground transition-opacity hover:bg-background hover:text-foreground lg:p-0.5 lg:opacity-0 lg:group-hover:opacity-100 lg:focus:opacity-100"
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
                    onClick={() => setDeleteId(nb.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                    删除
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))}
        </div>

        {/* 标签 */}
        {tags.length > 0 && (
          <div className="mt-4">
            <div className="mb-1 flex items-center gap-1 px-2 text-xs font-medium text-muted-foreground">
              <TagIcon className="h-3 w-3" />
              标签
            </div>
            <div className="flex flex-wrap gap-1.5 px-2">
              {tags.map((tag) => (
                <button
                  key={tag.name}
                  type="button"
                  onClick={() => selectTag(tag.name)}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors hover:bg-accent",
                    tagFilter === tag.name
                      ? "border-primary bg-primary text-primary-foreground"
                      : "text-muted-foreground"
                  )}
                >
                  {tag.name}
                  <span className="opacity-70">{tag.count}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <NotebookDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editingId={editingId}
        initialName={
          editingId ? notebooks.find((n) => n.id === editingId)?.name ?? "" : ""
        }
        initialColor={
          editingId
            ? notebooks.find((n) => n.id === editingId)?.color ?? NOTEBOOK_COLORS[0]
            : NOTEBOOK_COLORS[0]
        }
      />

      <AlertDialog
        open={deleteId !== null}
        onOpenChange={(o) => !o && setDeleteId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除笔记本？</AlertDialogTitle>
            <AlertDialogDescription>
              笔记本将被删除，其中的笔记会保留并移动到「全部笔记」。此操作无法撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={confirmDelete}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
