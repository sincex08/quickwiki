import { Extension, markInputRule } from "@tiptap/core";

/**
 * 补充 StarterKit 未内置的 Markdown 行内快捷键（直接键入路径）：
 * - **文本** → 加粗
 * - `文本` → 行内代码
 * （# / ## / ### / - / 1. / > 由 StarterKit 内置输入规则支持；
 *   - [ ] 任务清单可用工具栏按钮或粘贴 Markdown 文本）
 *
 * 已知限制：中文输入法「整段提交含 * 符号」时不触发输入规则
 * （ProseMirror 平台行为），此时可用工具栏、源码模式或粘贴 Markdown。
 */
export const MarkdownInlineShortcuts = Extension.create({
  name: "markdownInlineShortcuts",

  addInputRules() {
    const rules = [];
    const { bold, code } = this.editor.schema.marks;
    if (bold) {
      rules.push(
        markInputRule({
          find: /\*\*([^*]+)\*\*$/,
          type: bold,
        })
      );
    }
    if (code) {
      rules.push(
        markInputRule({
          find: /`([^`]+)`$/,
          type: code,
        })
      );
    }
    return rules;
  },
});
