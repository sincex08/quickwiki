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
      // 不开 resizable：Markdown（GFM 管道表）不序列化 colwidth，
      // 拖完刷新即丢，误导性手柄不如不给
      Table,
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
      const markdown = e.storage.markdown.getMarkdown();
      lastEmittedRef.current = markdown;
      onChange?.(markdown);
    },
  });

  // ===== 外部内容同步（与 MarkdownSource/HybridPreview 同款三段式） =====
  // content 只在创建编辑器时用一次；云同步回写 / 附件抽屉改写正文后 prop 变化，
  // 不同步的话编辑器 DOM 仍是旧内容，下一次敲键以旧基底全文序列化——静默
  // 覆盖外部修改。判定：与最近一次本组件发出的 Markdown 不一致且 300ms 后
  // 仍不一致（跳过落盘回读的瞬时回退窗口）；聚焦中暂存、失焦应用（不打断输入）。
  const lastEmittedRef = useRef(content);
  const pendingExternalRef = useRef<string | null>(null);

  useEffect(() => {
    if (!editor) return;
    if (content === lastEmittedRef.current) {
      // 回读已追平本组件内容：早期回退窗口暂存的外部快照作废
      pendingExternalRef.current = null;
      return;
    }
    const timer = setTimeout(() => {
      if (content === lastEmittedRef.current) return;
      if (editor.isFocused) {
        pendingExternalRef.current = content;
        return;
      }
      lastEmittedRef.current = content;
      pendingExternalRef.current = null;
      // emitUpdate:false——外部应用不是用户编辑，不触发 onChange 回环
      editor.commands.setContent(content, false);
    }, 300);
    return () => clearTimeout(timer);
  }, [content, editor]);

  useEffect(() => {
    if (!editor) return;
    const applyPending = () => {
      const pending = pendingExternalRef.current;
      if (pending === null) return;
      pendingExternalRef.current = null;
      if (pending === lastEmittedRef.current) return;
      lastEmittedRef.current = pending;
      editor.commands.setContent(pending, false);
    };
    editor.on("blur", applyPending);
    return () => {
      editor.off("blur", applyPending);
    };
  }, [editor]);

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
