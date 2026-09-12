"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  splitMarkdownBlocks,
  joinMarkdownBlocks,
} from "@/lib/markdown-blocks";
import { MarkdownImg } from "./markdown-img";
import { cn } from "@/lib/utils";

/** 协议引用 / 外链 / 存量 data URL 统一解析渲染 */
const markdownComponents = {
  img: (props: { src?: string; alt?: string }) => (
    <MarkdownImg src={props.src} alt={props.alt} />
  ),
};

export interface HybridPreviewProps {
  /** 原始 Markdown */
  content: string;
  /** 提交块编辑后的完整 Markdown */
  onChange: (markdown: string) => void;
  /** 是否允许点击块进入源码编辑（头部开关控制） */
  editable?: boolean;
  className?: string;
}

/**
 * 块级混合编辑（Qoder 计划查看器同款模式）：
 * 渲染态点击任意块 → 切换为显示该块原始源码的编辑框；
 * 失焦或 Ctrl/Cmd+Enter 提交，Esc 取消。
 * 块状态本地维护，提交即刻生效（不等待自动保存回显）。
 */
export function HybridPreview({
  content,
  onChange,
  editable = true,
  className,
}: HybridPreviewProps) {
  const [blocks, setBlocks] = useState<string[]>(() =>
    splitMarkdownBlocks(content)
  );
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [draft, setDraft] = useState("");

  const startEdit = (index: number) => {
    setDraft(blocks[index]);
    setEditingIndex(index);
  };

  const commit = () => {
    if (editingIndex === null) return;
    const next = [...blocks];
    next[editingIndex] = draft;
    const normalized = next
      .map((b) => b.replace(/^\s+/, "").replace(/\s+$/, ""))
      .filter((b) => b !== "");
    setBlocks(normalized);
    onChange(joinMarkdownBlocks(normalized));
    setEditingIndex(null);
  };

  const cancel = () => setEditingIndex(null);

  return (
    <div className={cn("md-preview h-full overflow-y-auto px-4 py-3", className)}>
      {blocks.length === 0 && (
        <p className="text-sm text-muted-foreground">
          空笔记。切换到「编辑」模式开始写作。
        </p>
      )}
      {blocks.map((source, i) =>
        editingIndex === i ? (
          <textarea
            key={i}
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                cancel();
              } else if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                e.preventDefault();
                commit();
              }
            }}
            rows={Math.max(2, draft.split("\n").length + 1)}
            aria-label="块源码编辑"
            className="my-1 w-full resize-none rounded-md border border-primary/50 bg-background p-2 font-mono text-sm leading-relaxed outline-none ring-2 ring-primary/20"
          />
        ) : editable ? (
          <div
            key={i}
            role="button"
            tabIndex={0}
            title="点击编辑此块的 Markdown 源码"
            onClick={() => startEdit(i)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                startEdit(i);
              }
            }}
            className="-mx-2 cursor-text rounded-md px-2 transition-colors hover:bg-accent/40 focus:bg-accent/40 focus:outline-none"
          >
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
              {source}
            </ReactMarkdown>
          </div>
        ) : (
          <div key={i} className="-mx-2 px-2">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
              {source}
            </ReactMarkdown>
          </div>
        )
      )}
      {/* 末尾追加区：点击在文末新建块 */}
      {editable && (
        <div
          role="button"
          tabIndex={0}
          title="在文末追加新块"
          onClick={() => {
            setBlocks((b) => [...b, ""]);
            setDraft("");
            setEditingIndex(blocks.length);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              setBlocks((b) => [...b, ""]);
              setDraft("");
              setEditingIndex(blocks.length);
            }
          }}
          className="-mx-2 mt-2 min-h-10 cursor-text rounded-md px-2 text-sm text-muted-foreground/60 transition-colors hover:bg-accent/40"
        >
          ＋ 点击追加内容
        </div>
      )}
    </div>
  );
}
