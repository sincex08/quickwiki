"use client";

import { useEffect, useRef } from "react";
import { EditorContent, useEditor, ReactNodeViewRenderer, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { Markdown } from "tiptap-markdown";
import Link from "@tiptap/extension-link";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Table from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableHeader from "@tiptap/extension-table-header";
import TableCell from "@tiptap/extension-table-cell";
import { MarkdownInlineShortcuts } from "./markdown-shortcuts";
import { Toolbar } from "./toolbar";
import { AttachmentImage } from "./attachment-image";
import { CodeBlockView } from "./code-block-view";
import { lowlight } from "@/lib/code-languages";
import { insertFilesAsAttachments } from "@/lib/images";
import { registerActiveEditor } from "@/lib/attachments/refs";
import { useUIStore } from "@/stores/use-ui-store";
import { cn } from "@/lib/utils";

export interface TipTapEditorProps {
  /** Markdown 内容（由 tiptap-markdown 解析） */
  content: string;
  /** 变更回调，始终发出 Markdown */
  onChange?: (markdown: string) => void;
  editable?: boolean;
  autofocus?: boolean;
  placeholder?: string;
  showToolbar?: boolean;
  className?: string;
}

function pickImageFiles(
  list: FileList | null | undefined
): File[] {
  if (!list) return [];
  return Array.from(list).filter((f) => f.type.startsWith("image/"));
}

/** 代码块：lowlight 高亮 + 自定义 NodeView（语言下拉/复制按钮） */
const CodeBlock = CodeBlockLowlight.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockView);
  },
});

export function TipTapEditor({
  content,
  onChange,
  editable = true,
  autofocus = false,
  placeholder = "开始写作…（支持 Markdown：# 标题、- 列表、- [ ] 任务，可直接粘贴图片）",
  showToolbar = false,
  className,
}: TipTapEditorProps) {
  // editorProps 的粘贴/拖放处理器在创建时闭包，事件发生时通过 ref 拿实例
  const editorRef = useRef<Editor | null>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        // 关闭内置 codeBlock，换用下方 lowlight 版（同名扩展不能重复注册）
        codeBlock: false,
      }),
      CodeBlock.configure({ lowlight, defaultLanguage: "plaintext" }),
      Placeholder.configure({ placeholder }),
      MarkdownInlineShortcuts,
      Markdown.configure({
        // 无 legacy HTML 需求；ProseMirror schema 之外的原始 HTML 一律按文本处理
        html: false,
        tightLists: true,
        bulletListMarker: "-",
        linkify: false,
        breaks: false,
        // 粘贴 Markdown 文本自动转富文本；复制输出 Markdown
        transformPastedText: true,
        transformCopiedText: true,
      }),
      AttachmentImage.configure({ inline: false, allowBase64: true }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { target: "_blank", rel: "noopener noreferrer" },
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
    ],
    content,
    editable,
    // Next.js 环境下显式关闭立即渲染，避免水合不一致与 SSR 警告
    immediatelyRender: false,
    autofocus: editable && autofocus ? "end" : false,
    editorProps: {
      attributes: {
        class: "tiptap",
        spellcheck: "false",
      },
      handlePaste: (_view, event) => {
        const files = pickImageFiles(event.clipboardData?.files);
        const noteId = useUIStore.getState().activeNoteId;
        if (files.length > 0 && editorRef.current && noteId) {
          event.preventDefault();
          void insertFilesAsAttachments(editorRef.current, files, noteId);
          return true;
        }
        // 文本/富文本走默认路径（transformPastedText 负责 Markdown 解析）
        return false;
      },
      handleDrop: (_view, event, _slice, moved) => {
        if (moved) return false;
        const files = pickImageFiles(event.dataTransfer?.files);
        const noteId = useUIStore.getState().activeNoteId;
        if (files.length > 0 && editorRef.current && noteId) {
          event.preventDefault();
          void insertFilesAsAttachments(editorRef.current, files, noteId);
          return true;
        }
        return false;
      },
    },
    onCreate: ({ editor: e }) => {
      editorRef.current = e;
    },
    onUpdate: ({ editor: e }) => {
      onChange?.(e.storage.markdown.getMarkdown());
    },
  });

  // 注册活动编辑器（附件抽屉等外部组件跨组件插入引用）
  useEffect(() => {
    registerActiveEditor(editor ?? null);
    return () => registerActiveEditor(null);
  }, [editor]);

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", className)}>
      {editable && showToolbar && <Toolbar editor={editor} />}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

export default TipTapEditor;
