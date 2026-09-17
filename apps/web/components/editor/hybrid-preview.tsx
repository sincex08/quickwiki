"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { Check, Copy } from "lucide-react";
import {
  splitMarkdownBlocks,
  joinMarkdownBlocks,
} from "@/lib/markdown-blocks";
import { extractHeadings, headingAnchor, type HeadingItem } from "@/lib/headings";
import { MarkdownImg } from "./markdown-img";
import { noteUrlTransform } from "./url-transform";
import { cn } from "@/lib/utils";

/** 提取 React 子节点中的纯文本（标题锚点要用原始文本，两侧必须一致） */
function childrenToText(children: ReactNode): string {
  if (typeof children !== "object" || children === null) return String(children ?? "");
  if (!Array.isArray(children)) {
    // 单个元素/字符串
    if (typeof children === "string" || typeof children === "number") return String(children);
    const props = (children as { props?: { children?: ReactNode } }).props;
    return childrenToText(props?.children);
  }
  return children.map((c) => childrenToText(c as ReactNode)).join("");
}

/** 标题渲染：写入稳定锚点 id，[toc] 与大纲跳转依赖它 */
function headingRenderer(Tag: "h1" | "h2" | "h3") {
  return function HeadingAnchor(props: { children?: ReactNode }) {
    const id = headingAnchor(childrenToText(props.children).trim());
    return <Tag id={id}>{props.children}</Tag>;
  };
}

/** 代码块预览：右上角悬浮复制按钮 */
function PreWithCopy({
  children,
  node: _node,
  ...rest
}: React.HTMLAttributes<HTMLPreElement> & { node?: unknown }) {
  const ref = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  return (
    <div className="group/pre relative">
      <button
        type="button"
        title="复制代码"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(ref.current?.textContent ?? "");
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            // 剪贴板不可用：静默失败
          }
        }}
        className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded-md border bg-background px-1.5 py-0.5 text-xs text-muted-foreground transition-opacity hover:text-foreground lg:opacity-0 lg:group-hover/pre:opacity-100"
      >
        {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
        {copied ? "已复制" : "复制"}
      </button>
      <pre ref={ref} {...rest}>
        {children}
      </pre>
    </div>
  );
}

/** 协议引用 / 外链 / 存量 data URL 统一解析渲染 + 代码高亮 + 标题锚点 */
const markdownComponents = {
  img: (props: { src?: string; alt?: string }) => (
    <MarkdownImg src={props.src} alt={props.alt} />
  ),
  h1: headingRenderer("h1"),
  h2: headingRenderer("h2"),
  h3: headingRenderer("h3"),
  pre: PreWithCopy,
};

/** [toc] 块：渲染全文档标题目录 */
function TocBlock({ headings }: { headings: HeadingItem[] }) {
  if (headings.length === 0) {
    return (
      <p className="my-3 rounded-lg border border-dashed px-4 py-3 text-sm text-muted-foreground">
        [toc]：文中还没有标题（# 开头），加入标题后此处会生成目录。
      </p>
    );
  }
  return (
    <nav className="my-3 rounded-lg border bg-muted/30 px-4 py-3">
      <p className="mb-1.5 text-xs font-medium text-muted-foreground">目录</p>
      <ul className="space-y-1 text-sm">
        {headings.map((h, i) => (
          <li key={i} style={{ paddingLeft: (h.level - 1) * 16 }}>
            <a
              href={`#${headingAnchor(h.text)}`}
              onClick={(e) => {
                e.preventDefault();
                document
                  .getElementById(headingAnchor(h.text))
                  ?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
              className="text-foreground/80 transition-colors hover:text-primary hover:underline"
            >
              {h.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

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

  // [toc] 与大纲的数据源：以本地 blocks 为准（提交后与 content 短暂不一致属预期）
  const liveMarkdown = useMemo(() => joinMarkdownBlocks(blocks), [blocks]);
  const headings = useMemo(() => extractHeadings(liveMarkdown), [liveMarkdown]);

  return (
    <div
      className={cn(
        "md-preview h-full overflow-y-auto px-4 py-3 md:px-6 lg:px-8",
        className
      )}
    >
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
        ) : source.trim().toLowerCase() === "[toc]" ? (
          <div key={i} className="-mx-2 px-2">
            <TocBlock headings={headings} />
          </div>
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
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeHighlight]}
              urlTransform={noteUrlTransform}
              components={markdownComponents}
            >
              {source}
            </ReactMarkdown>
          </div>
        ) : (
          <div key={i} className="-mx-2 px-2">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeHighlight]}
              urlTransform={noteUrlTransform}
              components={markdownComponents}
            >
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
