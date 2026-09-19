import type { Notebook } from "@quickwiki/shared";

/**
 * 笔记本 id → 完整层级路径（「笔记本A / 子笔记本B / 子笔记本C」）。
 *
 * 同名子笔记本可能出现在多个父级下（如「工作 / 归档」与「个人 / 归档」），
 * 只显示名称时无法判断选的是哪一个 —— 父级下拉与「新建笔记」确认提示
 * 都依赖完整路径来唯一指明目标（2026-09-19）。
 *
 * 父链成环或父级已不存在时按已有段截断，保证不无限递归。
 */
export function buildNotebookPaths(
  notebooks: readonly Notebook[]
): Map<string, string> {
  const byId = new Map(notebooks.map((nb) => [nb.id, nb]));
  const paths = new Map<string, string>();
  for (const nb of notebooks) {
    const parts: string[] = [];
    const seen = new Set<string>();
    let cur: Notebook | undefined = nb;
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      parts.unshift(cur.name);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    paths.set(nb.id, parts.join(" / "));
  }
  return paths;
}

/**
 * 按树的先序（根 → 子 → 孙）排列，让下拉里相邻的条目就是层级上相邻的笔记本。
 * 父级不在传入集合内（被排除或已删除）的节点按根级处理，保证可达。
 */
export function sortNotebooksByTree(
  notebooks: readonly Notebook[]
): Notebook[] {
  const ids = new Set(notebooks.map((nb) => nb.id));
  const childrenOf = new Map<string | null, Notebook[]>();
  for (const nb of notebooks) {
    const key = nb.parentId && ids.has(nb.parentId) ? nb.parentId : null;
    const arr = childrenOf.get(key);
    if (arr) arr.push(nb);
    else childrenOf.set(key, [nb]);
  }
  const out: Notebook[] = [];
  const walk = (key: string | null) => {
    for (const nb of childrenOf.get(key) ?? []) {
      out.push(nb);
      walk(nb.id);
    }
  };
  walk(null);
  return out;
}
