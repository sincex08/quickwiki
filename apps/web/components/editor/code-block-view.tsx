"use client";

import { useState } from "react";
import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { Check, Copy } from "lucide-react";
import { CODE_LANGUAGES, languageLabel } from "@/lib/code-languages";

/**
 * 代码块的 Tiptap NodeView：聚焦/悬浮时右上角浮出
 * 「语言下拉 + 复制」工具条；高亮由 code-block-lowlight 的
 * ProseMirror 插件对 NodeViewContent 内的 code 元素完成。
 */
export function CodeBlockView({ node, updateAttributes }: NodeViewProps) {
  const language = (node.attrs.language as string) || "plaintext";
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(node.textContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // 剪贴板不可用（权限/非安全上下文）：静默失败，不打断编辑
    }
  };

  return (
    <NodeViewWrapper className="group/code relative">
      <div
        contentEditable={false}
        className="absolute right-2 top-1.5 z-10 flex items-center gap-1 transition-opacity focus-within:opacity-100 lg:opacity-0 lg:group-hover/code:opacity-100"
      >
        <select
          value={CODE_LANGUAGES.some((l) => l.id === language) ? language : ""}
          title="代码语言"
          onChange={(e) => updateAttributes({ language: e.target.value })}
          className="h-6 rounded-md border bg-background px-1 text-xs text-muted-foreground outline-none"
        >
          {!CODE_LANGUAGES.some((l) => l.id === language) && (
            <option value="">{languageLabel(language)}</option>
          )}
          {CODE_LANGUAGES.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={copy}
          title="复制代码"
          className="flex h-6 items-center gap-1 rounded-md border bg-background px-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? "已复制" : "复制"}
        </button>
      </div>
      <pre>
        <NodeViewContent as="code" className={`language-${language}`} />
      </pre>
    </NodeViewWrapper>
  );
}
