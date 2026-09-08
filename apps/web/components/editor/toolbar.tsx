"use client";

import {
  forwardRef,
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import type { Editor } from "@tiptap/react";
import {
  Bold,
  Code,
  FileCode2,
  Heading1,
  Heading2,
  Image as ImageIcon,
  Italic,
  Link2,
  List,
  ListOrdered,
  ListTodo,
  Quote,
  Redo2,
  RemoveFormatting,
  Settings2,
  Strikethrough,
  Table as TableIcon,
  Undo2,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { insertImageIntoEditor } from "@/lib/images";
import { LinkDialog } from "./link-dialog";

interface ToolbarProps {
  editor: Editor | null;
  className?: string;
}

const ToolButton = forwardRef<
  HTMLButtonElement,
  {
    onClick?: () => void;
    active?: boolean;
    disabled?: boolean;
    label: string;
    children: ReactNode;
  } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick">
>(function ToolButton({ onClick, active, disabled, label, children, ...rest }, ref) {
  return (
    <button
      type="button"
      ref={ref}
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={cn(
        "inline-flex h-10 w-10 items-center justify-center rounded-md text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-40 lg:h-8 lg:w-8",
        active && "bg-accent text-accent-foreground"
      )}
      {...rest}
    >
      {children}
    </button>
  );
});

const Divider = () => (
  <div className="mx-1 h-5 w-px self-center bg-border" aria-hidden />
);

export function Toolbar({ editor, className }: ToolbarProps) {
  // Tiptap v2 中需手动触发重渲染以刷新按钮激活状态
  const [, setTick] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [linkOpen, setLinkOpen] = useState(false);

  useEffect(() => {
    if (!editor) return;
    const update = () => setTick((t) => t + 1);
    editor.on("transaction", update);
    editor.on("selectionUpdate", update);
    return () => {
      editor.off("transaction", update);
      editor.off("selectionUpdate", update);
    };
  }, [editor]);

  if (!editor) return null;

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    await insertImageIntoEditor(editor, Array.from(files));
  };

  const openLinkDialog = () => setLinkOpen(true);

  const applyLink = (url: string) => {
    const chain = editor.chain().focus();
    if (editor.state.selection.empty) {
      // 无选区：插入 URL 文本后选中它再加链接标记
      // （insertContent 之后选区停在文本之后，直接 setLink 会落空）
      const from = editor.state.selection.from;
      chain
        .insertContent(url)
        .setTextSelection({ from, to: from + url.length })
        .setLink({ href: url });
    } else {
      chain.extendMarkRange("link").setLink({ href: url });
    }
    chain.run();
  };

  const removeLink = () => {
    editor.chain().focus().extendMarkRange("link").unsetLink().run();
  };

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-0.5 border-b bg-background px-2 py-1.5",
        className
      )}
    >
      <ToolButton
        label="撤销"
        disabled={!editor.can().undo()}
        onClick={() => editor.chain().focus().undo().run()}
      >
        <Undo2 className="h-4 w-4" />
      </ToolButton>
      <ToolButton
        label="重做"
        disabled={!editor.can().redo()}
        onClick={() => editor.chain().focus().redo().run()}
      >
        <Redo2 className="h-4 w-4" />
      </ToolButton>

      <Divider />

      <ToolButton
        label="加粗"
        active={editor.isActive("bold")}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <Bold className="h-4 w-4" />
      </ToolButton>
      <ToolButton
        label="斜体"
        active={editor.isActive("italic")}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <Italic className="h-4 w-4" />
      </ToolButton>
      <ToolButton
        label="删除线"
        active={editor.isActive("strike")}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      >
        <Strikethrough className="h-4 w-4" />
      </ToolButton>
      <ToolButton
        label="行内代码"
        active={editor.isActive("code")}
        onClick={() => editor.chain().focus().toggleCode().run()}
      >
        <Code className="h-4 w-4" />
      </ToolButton>

      <Divider />

      <ToolButton
        label="一级标题"
        active={editor.isActive("heading", { level: 1 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
      >
        <Heading1 className="h-4 w-4" />
      </ToolButton>
      <ToolButton
        label="二级标题"
        active={editor.isActive("heading", { level: 2 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      >
        <Heading2 className="h-4 w-4" />
      </ToolButton>

      <Divider />

      <ToolButton
        label="无序列表"
        active={editor.isActive("bulletList")}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        <List className="h-4 w-4" />
      </ToolButton>
      <ToolButton
        label="有序列表"
        active={editor.isActive("orderedList")}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        <ListOrdered className="h-4 w-4" />
      </ToolButton>
      <ToolButton
        label="任务清单"
        active={editor.isActive("taskList")}
        onClick={() => editor.chain().focus().toggleTaskList().run()}
      >
        <ListTodo className="h-4 w-4" />
      </ToolButton>
      <ToolButton
        label="引用"
        active={editor.isActive("blockquote")}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      >
        <Quote className="h-4 w-4" />
      </ToolButton>
      <ToolButton
        label="代码块"
        active={editor.isActive("codeBlock")}
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
      >
        <FileCode2 className="h-4 w-4" />
      </ToolButton>

      <Divider />

      <ToolButton
        label="插入图片"
        onClick={() => fileInputRef.current?.click()}
      >
        <ImageIcon className="h-4 w-4" />
      </ToolButton>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        aria-hidden
        tabIndex={-1}
        onChange={async (e) => {
          await handleFiles(e.target.files);
          // 允许重复选择同一文件
          e.target.value = "";
        }}
      />
      <ToolButton
        label="插入链接"
        active={editor.isActive("link")}
        onClick={openLinkDialog}
      >
        <Link2 className="h-4 w-4" />
      </ToolButton>
      <ToolButton
        label="插入表格"
        disabled={editor.isActive("table")}
        onClick={() =>
          editor
            .chain()
            .focus()
            .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
            .run()
        }
      >
        <TableIcon className="h-4 w-4" />
      </ToolButton>
      {editor.isActive("table") && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <ToolButton label="表格操作" active>
              <Settings2 className="h-4 w-4" />
            </ToolButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onClick={() => editor.chain().focus().addRowBefore().run()}>
              在上方插入行
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => editor.chain().focus().addRowAfter().run()}>
              在下方插入行
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => editor.chain().focus().addColumnBefore().run()}>
              在左侧插入列
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => editor.chain().focus().addColumnAfter().run()}>
              在右侧插入列
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => editor.chain().focus().deleteRow().run()}>
              删除当前行
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => editor.chain().focus().deleteColumn().run()}>
              删除当前列
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => editor.chain().focus().deleteTable().run()}
            >
              删除表格
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <Divider />

      <ToolButton
        label="清除格式"
        disabled={!editor.can().clearNodes()}
        onClick={() => editor.chain().focus().clearNodes().unsetAllMarks().run()}
      >
        <RemoveFormatting className="h-4 w-4" />
      </ToolButton>

      <LinkDialog
        open={linkOpen}
        onOpenChange={setLinkOpen}
        initialUrl={(editor.getAttributes("link").href as string) ?? ""}
        hasLink={editor.isActive("link")}
        onSubmit={applyLink}
        onRemove={removeLink}
      />
    </div>
  );
}
