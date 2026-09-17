"use client";

import { ListTree } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { useUIStore } from "@/stores/use-ui-store";
import { extractHeadings, headingAnchor, type HeadingItem } from "@/lib/headings";
import { gotoSourceLine } from "./markdown-source";

/**
 * 大纲跳转：预览按锚点 id 滚动；编辑模式在 Tiptap DOM 里找同文本标题；
 * 源码模式发事件给 textarea 按行号定位。
 */
function jumpToHeading(h: HeadingItem): void {
  const mode = useUIStore.getState().editorMode;
  if (mode === "source") {
    gotoSourceLine(h.line);
    return;
  }
  if (mode === "preview") {
    document
      .getElementById(headingAnchor(h.text))
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  const nodes = document.querySelectorAll(".tiptap h1, .tiptap h2, .tiptap h3");
  for (const node of nodes) {
    if (node.textContent?.trim() === h.text) {
      node.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
  }
}

function OutlineItems({
  headings,
  onSelect,
}: {
  headings: HeadingItem[];
  onSelect: () => void;
}) {
  return (
    <>
      {headings.map((h, i) => (
        <DropdownMenuItem
          key={i}
          style={{ paddingLeft: 8 + (h.level - 1) * 16 }}
          onClick={() => {
            jumpToHeading(h);
            onSelect();
          }}
          className={h.level === 1 ? "font-medium" : "text-foreground/85"}
        >
          <span className="truncate">{h.text}</span>
        </DropdownMenuItem>
      ))}
    </>
  );
}

function useOutline(markdown: string): { headings: HeadingItem[]; empty: boolean } {
  const headings = extractHeadings(markdown);
  return { headings, empty: headings.length === 0 };
}

/** 桌面端头部「大纲」按钮（编辑/源码/预览三模式通用） */
export function OutlineMenuButton({ markdown }: { markdown: string }) {
  const { headings, empty } = useOutline(markdown);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="hidden md:inline-flex"
          aria-label="大纲"
          title="大纲（标题跳转）"
          disabled={empty}
        >
          <ListTree className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-80 w-64 overflow-y-auto">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          大纲
        </DropdownMenuLabel>
        <OutlineItems headings={headings} onSelect={() => {}} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** 移动端「…」菜单里的大纲子菜单 */
export function OutlineSubmenu({
  markdown,
  onNavigate,
}: {
  markdown: string;
  onNavigate: () => void;
}) {
  const { headings, empty } = useOutline(markdown);
  if (empty) return null;
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <ListTree className="mr-2 h-4 w-4" />
        大纲
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="max-h-80 w-64 overflow-y-auto">
        <OutlineItems headings={headings} onSelect={onNavigate} />
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
