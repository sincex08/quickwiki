"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { normalizeTag } from "@/lib/utils";
import { TagBadge } from "@/components/common/tag-badge";
import { ConfirmDialog } from "@/components/common/confirm-dialog";

interface TagEditorProps {
  tags: string[];
  onChange: (tags: string[]) => void;
}

/** 编辑器内的标签编辑：回车/逗号添加；退格不删除，仅点 × 并二次确认后移除 */
export function TagEditor({ tags, onChange }: TagEditorProps) {
  const [input, setInput] = useState("");
  const [pendingRemove, setPendingRemove] = useState<string | null>(null);

  const addTag = () => {
    const tag = normalizeTag(input);
    if (tag && !tags.includes(tag)) {
      onChange([...tags, tag]);
    }
    setInput("");
  };

  const confirmRemove = () => {
    if (pendingRemove) {
      onChange(tags.filter((t) => t !== pendingRemove));
    }
    setPendingRemove(null);
  };

  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
      {tags.map((tag) => (
        <span
          key={tag}
          className="inline-flex items-center gap-0.5 rounded-full bg-secondary py-0.5 pl-1.5 pr-0.5 text-[11px] text-secondary-foreground"
        >
          <TagBadge tag={tag} className="bg-transparent p-0" />
          <button
            type="button"
            aria-label={`移除标签 ${tag}`}
            title={`移除标签 ${tag}`}
            className="rounded-full p-0.5 hover:bg-background/60"
            // 不让按钮抢走输入框焦点，避免半输入的文本在失焦时被误提交为标签
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setPendingRemove(tag)}
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            addTag();
          }
        }}
        onBlur={() => input && addTag()}
        placeholder={tags.length === 0 ? "添加标签…" : ""}
        aria-label="添加标签"
        className="h-6 min-w-16 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
      />
      <ConfirmDialog
        open={pendingRemove !== null}
        title={`移除标签「${pendingRemove}」？`}
        description="该标签仅从当前笔记移除，不影响其他笔记，可随时重新添加。"
        confirmLabel="移除"
        onConfirm={confirmRemove}
        onCancel={() => setPendingRemove(null)}
      />
    </div>
  );
}
