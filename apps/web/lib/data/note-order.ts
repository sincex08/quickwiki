import type { Note } from "@quickwiki/shared";

/**
 * 笔记手动顺序的纯计算部分（不依赖 Dexie，便于单测）。
 *
 * 模型：**容器** = 一个笔记本或「未分类」，各自独立维护顺序。
 * - 容器内全部 `sortOrder == null` → 未手动排序，按 `pinned` + `updatedAt` 倒序（默认行为）
 * - 容器内存在任意一条已编号 → 该容器进入「手动顺序」模式，
 *   顺序完全由 `sortOrder` 升序决定（`pinned` 不再影响位置，只作为可见标记）
 *
 * 跨容器的混合视图（历史上的「全部笔记」列表、搜索结果）不存在全局手动顺序：
 * 按容器**分块**呈现，块内遵守各自顺序，块间按块内最近更新时间倒序。
 */

/** 手动顺序的编号步长（留出插入余量，相邻交换无需整组重写） */
export const SORT_ORDER_STEP = 1024;

/** 未分类容器的 key（`notebookId == null`）；与 Dexie 的 cat 派生索引同语义 */
export const UNCATEGORIZED_CONTAINER = "";

/** 排序所需的最小字段集：`Note` 与 `NoteIndexItem` 都满足 */
export interface OrderableRow {
  id: string;
  notebookId: string | null;
  pinned: boolean;
  updatedAt: number;
  sortOrder?: number | null;
}

export function containerKeyOf(
  notebookId: string | null | undefined
): string {
  return notebookId ?? UNCATEGORIZED_CONTAINER;
}

/** 该容器是否已进入手动顺序模式（存在任意一条已编号的笔记） */
export function isManualOrder(rows: readonly OrderableRow[]): boolean {
  return rows.some((r) => r.sortOrder != null);
}

/** 容器内排序：手动模式看 sortOrder，否则置顶优先 + 更新时间倒序 */
export function compareWithinContainer(
  a: OrderableRow,
  b: OrderableRow,
  manual: boolean
): number {
  if (manual) {
    // 未编号的（异常数据）排最后，用更新时间兜底
    const av = a.sortOrder ?? Number.POSITIVE_INFINITY;
    const bv = b.sortOrder ?? Number.POSITIVE_INFINITY;
    if (av !== bv) return av - bv;
    if (a.updatedAt !== b.updatedAt) return b.updatedAt - a.updatedAt;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  }
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
  if (a.updatedAt !== b.updatedAt) return b.updatedAt - a.updatedAt;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** 按容器分组（保持传入顺序，组内顺序由调用方再排） */
export function groupByContainer<T extends OrderableRow>(
  rows: readonly T[]
): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const key = containerKeyOf(row.notebookId);
    const arr = map.get(key);
    if (arr) arr.push(row);
    else map.set(key, [row]);
  }
  return map;
}

/** 单个容器内排序（返回新数组，不改原数组） */
export function sortContainer<T extends OrderableRow>(rows: readonly T[]): T[] {
  const manual = isManualOrder(rows);
  return [...rows].sort((a, b) => compareWithinContainer(a, b, manual));
}

/**
 * 展示排序：容器分块 + 块内排序 + 块间按「块内最近更新时间」倒序。
 * 同一容器的笔记在结果中连续，块内顺序即用户排定的顺序。
 */
export function sortNotesForDisplay<T extends OrderableRow>(
  rows: readonly T[]
): T[] {
  const buckets = groupByContainer(rows);
  const blocks = [...buckets.entries()].map(([key, list]) => {
    const sorted = sortContainer(list);
    const latest = sorted.reduce((max, r) => Math.max(max, r.updatedAt), 0);
    return { key, sorted, latest };
  });
  blocks.sort((a, b) => {
    if (a.latest !== b.latest) return b.latest - a.latest;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
  return blocks.flatMap((b) => b.sorted);
}

/** 按给定顺序编号：0, STEP, 2*STEP …（用于首次进入手动模式与拖拽后重排） */
export function numberSequence(ids: readonly string[]): Map<string, number> {
  const map = new Map<string, number>();
  ids.forEach((id, index) => map.set(id, index * SORT_ORDER_STEP));
  return map;
}

/**
 * 把 `movingId` 移动到 `targetIndex`（移动后新数组中的目标下标）。
 * 用于拖拽落点：先算出新的完整顺序，再整体编号。
 */
export function moveIdTo(
  ids: readonly string[],
  movingId: string,
  targetIndex: number
): string[] {
  const without = ids.filter((id) => id !== movingId);
  const clamped = Math.max(0, Math.min(targetIndex, without.length));
  const next = [...without];
  next.splice(clamped, 0, movingId);
  return next;
}

/** 相邻交换（上移 / 下移）；已在边界返回 null 表示无变化 */
export function swapAdjacent(
  ids: readonly string[],
  movingId: string,
  direction: -1 | 1
): string[] | null {
  const index = ids.indexOf(movingId);
  if (index < 0) return null;
  const target = index + direction;
  if (target < 0 || target >= ids.length) return null;
  const next = [...ids];
  next[index] = ids[target];
  next[target] = ids[index];
  return next;
}

/**
 * 「插到最前」的编号值：优先沿用容器内已有的间距（取最小值的更小一档），
 * 没有已编号的笔记时从 0 开始。新建笔记 / 移入手动容器时使用，
 * 与默认列表「最新在最上」的直觉一致。
 */
export function topOrderValue(rows: readonly OrderableRow[]): number {
  const values = rows
    .map((r) => r.sortOrder)
    .filter((v): v is number => v != null);
  if (values.length === 0) return 0;
  return Math.min(...values) - SORT_ORDER_STEP;
}

/**
 * 远端行与本地的手动顺序该取谁。
 *
 * 关键区分：`undefined`（服务端没有这个字段 —— 未执行迁移，或旧客户端写入）
 * **不等于** `null`（服务端明确表示「没有手动顺序」）。
 * 前者必须保留本地值，否则「本地排序 → push → 回环 pull」会用「无信息」把
 * 本地刚排好的顺序抹掉（表现为：拖完/上移下移后顺序又自己回去了）。
 */
export function resolveRemoteSortOrder(
  remoteValue: number | null | undefined,
  localValue: number | null | undefined
): number | null {
  if (remoteValue === undefined) return localValue ?? null;
  return remoteValue ?? null;
}

/** 从 Note 上取排序所需的字段（避免把正文/标签带进排序逻辑） */
export function toOrderable(note: Note): OrderableRow {
  return {
    id: note.id,
    notebookId: note.notebookId,
    pinned: note.pinned,
    updatedAt: note.updatedAt,
    sortOrder: note.sortOrder ?? null,
  };
}
