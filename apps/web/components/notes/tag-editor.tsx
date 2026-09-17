"use client";

import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { normalizeTag } from "@/lib/utils";
import { TagBadge } from "@/components/common/tag-badge";
import { ConfirmDialog } from "@/components/common/confirm-dialog";

interface TagEditorProps {
  tags: string[];
  onChange: (tags: string[]) => void;
  /** 挂载时聚焦输入框（从折叠入口展开时使用） */
  autoFocus?: boolean;
  /** 全部标签字典（用于输入时的自动补全建议） */
  suggestions?: string[];
}

/**
 * 编辑器内的标签编辑：回车/逗号添加；退格不删除，仅点 × 并二次确认后移除。
 * 输入时按已有标签给出补全建议：前缀匹配优先、其次包含，排除已有标签，最多 8 条。
 */
export function TagEditor({
  tags,
  onChange,
  autoFocus = false,
  suggestions = [],
}: TagEditorProps) {
  const [input, setInput] = useState("");
  const [pendingRemove, setPendingRemove] = useState<string | null>(null);
  const /** 建议高亮下标（-1 = 未选，Enter 提交原始输入） */
    [highlight, setHighlight] = useState(-1);

  const matches = useMemo(() => {
    const q = normalizeTag(input);
    if (!q) return [];
    const own = new Set(tags);
    const starts: string[] = [];
    const includes: string[] = [];
    for (const s of suggestions) {
      if (own.has(s)) continue;
      if (s.startsWith(q)) starts.push(s);
      else if (s.includes(q)) includes.push(s);
    }
    return [...starts, ...includes].slice(0, 8);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, suggestions]);

  const suggestionsOpen = matches.length > 0;

  const commit = (raw: string) => {
    const tag = normalizeTag(raw);
    if (tag && !tags.includes(tag)) {
      onChange([...tags, tag]);
    }
    setInput("");
    setHighlight(-1);
  };

  const addTag = () => commit(input);

  const acceptHighlightedOrCommit = () => {
    commit(highlight >= 0 && highlight < matches.length ? matches[highlight] : input);
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
      <div className="relative min-w-16 flex-1">
        <input
          value={input}
          autoFocus={autoFocus}
          onChange={(e) => {
            setInput(e.target.value);
            setHighlight(-1);
          }}
          onKeyDown={(e) => {
            if (suggestionsOpen) {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setHighlight((h) => (h + 1) % matches.length);
                return;
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setHighlight((h) => (h - 1 + matches.length) % matches.length);
                return;
              }
              // Tab/Enter：有高亮项则采纳建议，否则按原逻辑提交原始输入
              if ((e.key === "Enter" || e.key === ",") && highlight >= 0) {
                e.preventDefault();
                acceptHighlightedOrCommit();
                return;
              }
              if (e.key === "Tab" && highlight >= 0) {
                e.preventDefault();
                acceptHighlightedOrCommit();
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setHighlight(-1);
                setInput("");
                return;
              }
            }
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              addTag();
            }
          }}
          onBlur={() => input && addTag()}
          placeholder={tags.length === 0 ? "添加标签…" : ""}
          aria-label="添加标签"
          role="combobox"
          aria-expanded={suggestionsOpen}
          aria-controls="tag-suggestions"
          className="h-6 w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground"
        />
        {suggestionsOpen && (
          <ul
            id="tag-suggestions"
            role="listbox"
            className="absolute left-0 top-full z-20 mt-1 max-h-48 w-48 overflow-y-auto rounded-md border bg-popover py-1 shadow-md"
          >
            {matches.map((s, i) => (
              <li key={s}>
                <button
                  type="button"
                  role="option"
                  aria-selected={i === highlight}
                  // 按下时保持输入框焦点，避免失焦误提交
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => commit(s)}
                  onMouseEnter={() => setHighlight(i)}
                  className={
                    "flex w-full items-center px-2.5 py-1 text-left text-xs hover:bg-accent " +
                    (i === highlight ? "bg-accent" : "")
                  }
                >
                  {s}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
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
