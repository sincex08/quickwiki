import type { Editor } from "@tiptap/react";
import { ATT_PROTOCOL } from "@quickwiki/shared";
import { attachmentRef } from "@/lib/data/attachment-repository";

/**
 * 附件引用扫描与「插入正文」桥接。
 * content 中协议引用的增删只发生在编辑器 onChange 后的落盘时刻，
 * 引用集合按笔记缓存增量维护，避免每次渲染全量正则。
 */

/** 提取 markdown 中全部附件 id 引用（协议串按 uuid 匹配） */
export function extractAttachmentIds(markdown: string): string[] {
  if (!markdown.includes(ATT_PROTOCOL)) return [];
  const ids = new Set<string>();
  const re = /quickwiki-att:\/\/([A-Za-z0-9-]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown)) !== null) {
    ids.add(m[1]);
  }
  return [...ids];
}

/**
 * 把已有附件的引用追加到 Markdown 文末（预览/源码模式下抽屉的插入动作）。
 * 追加前保证与现有内容之间有空行分隔。
 */
export function appendRefsToMarkdown(
  markdown: string,
  refs: Array<{ id: string; filename: string }>
): string {
  const lines = refs.map((r) => {
    const alt = r.filename.replace(/\.[^.]+$/, "") || "图片";
    return `![${alt}](${attachmentRef(r.id)})`;
  });
  const trimmed = markdown.replace(/\s+$/, "");
  return trimmed ? `${trimmed}\n\n${lines.join("\n\n")}\n` : `${lines.join("\n\n")}\n`;
}

/** 通过编辑器实例在光标处插入引用（编辑模式）；无实例时返回 false */
export function tryInsertViaEditor(
  editor: Editor | null | undefined,
  refs: Array<{ id: string; filename: string }>
): boolean {
  if (!editor) return false;
  for (const r of refs) {
    editor
      .chain()
      .focus()
      .setImage({
        src: attachmentRef(r.id),
        alt: r.filename.replace(/\.[^.]+$/, "") || undefined,
      })
      .run();
  }
  return true;
}

// ---------- 活动编辑器注册（抽屉等编辑器外部组件的插入桥） ----------

let activeEditor: Editor | null = null;

/** TipTapEditor 挂载/卸载时注册自身，供抽屉跨组件插入 */
export function registerActiveEditor(editor: Editor | null): void {
  activeEditor = editor;
}

/** 编辑模式下的插入：走活动编辑器在光标处插入；不在编辑模式返回 false */
export function insertRefsViaActiveEditor(
  refs: Array<{ id: string; filename: string }>
): boolean {
  return tryInsertViaEditor(activeEditor, refs);
}

/**
 * 编辑模式下删除附件时同步移除正文引用：直接删除编辑器内该图片节点，
 * 经 onChange → 自动保存落盘，避免与编辑器防抖保存的内容竞态。
 * 无活动编辑器或未找到节点返回 false（调用方回退到仓库路径改写）。
 */
export function removeRefViaActiveEditor(id: string): boolean {
  if (!activeEditor) return false;
  const ref = attachmentRef(id);
  const { state, dispatch } = activeEditor.view;

  // 先收集全部匹配位置，再倒序删除：tr.delete 会让其后位置整体前移，
  // 边遍历边删（位置取自原文档）会在同一附件被引用多处时删错区间。
  const ranges: Array<{ from: number; to: number }> = [];
  state.doc.descendants((node, pos) => {
    if (node.type.name === "image" && node.attrs.src === ref) {
      ranges.push({ from: pos, to: pos + node.nodeSize });
    }
  });
  if (ranges.length === 0) return false;

  const tr = state.tr;
  for (let i = ranges.length - 1; i >= 0; i--) {
    tr.delete(ranges[i].from, ranges[i].to);
  }
  dispatch(tr);
  return true;
}

/** 从 Markdown 中移除某附件的全部引用（删除附件时清理正文） */
export function removeRefsFromMarkdown(markdown: string, id: string): string {
  const esc = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return markdown.replace(
    new RegExp(`!\\[[^\\]]*\\]\\(${ATT_PROTOCOL.replace(/[/${}]/g, "\\$&")}${esc}\\)`, "g"),
    ""
  );
}
