"use client";

import { BookMarked, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNoteActions } from "@/hooks/use-note-actions";

/**
 * 未选择笔记本时的默认页。
 *
 * 应用不再强制「始终处在某个笔记本下」：既没选中笔记本、也没打开笔记时就显示这一页
 * （左侧侧栏照常可用）。此状态下新建笔记会落到「未分类」——没有当前位置可继承。
 */
export function EmptyWorkspace() {
  const { createNote } = useNoteActions();

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        <BookMarked className="h-6 w-6" />
      </div>
      <div>
        <h2 className="text-sm font-medium">未选择笔记本</h2>
        <p className="mt-1 max-w-xs text-xs leading-relaxed text-muted-foreground">
          从左侧选一个笔记本看它的笔记；也可以直接新建一篇，会存到「未分类」。
        </p>
      </div>
      <Button size="sm" className="gap-1.5" onClick={() => void createNote()}>
        <Plus className="h-4 w-4" />
        新建笔记
      </Button>
    </div>
  );
}
