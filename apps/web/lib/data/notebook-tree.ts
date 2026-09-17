/**
 * 笔记本层级路径（纯函数）。
 *
 * 供两处共用：
 * - 搜索结果面板标注「这条笔记属于哪个笔记本」（嵌套时显示「技术 / 前端」）；
 * - 搜索跳转时把侧栏树展开到目标笔记本（需要祖先 id 链）。
 *
 * 刻意不依赖 repository：传进来的是已加载的笔记本列表，纯计算、可单测。
 */

export interface NotebookLike {
  id: string;
  name: string;
  parentId?: string | null;
}

/**
 * 目标笔记本到根的祖先链，返回顺序为「根 → 自身」。
 * 找不到该 id 时返回空数组；父级已不存在（远端先同步了删除）时链到此为止；
 * 带 seen 防环（同步层 LWW 可能造出环）。
 */
export function notebookAncestors(
  notebooks: readonly NotebookLike[],
  id: string | null | undefined
): NotebookLike[] {
  if (!id) return [];
  const byId = new Map(notebooks.map((nb) => [nb.id, nb]));
  const chain: NotebookLike[] = [];
  const seen = new Set<string>();
  let current = byId.get(id);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    chain.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return chain;
}

/** 展示用路径：嵌套时为「父 / 子」；无父级时就是笔记本名；无法解析时返回空串 */
export function notebookPathLabel(
  notebooks: readonly NotebookLike[],
  id: string | null | undefined
): string {
  return notebookAncestors(notebooks, id)
    .map((nb) => nb.name)
    .join(" / ");
}
