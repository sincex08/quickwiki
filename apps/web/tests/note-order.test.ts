/**
 * 手动顺序的纯计算测试：容器判定、容器内排序、混合视图分块、
 * 编排序号、拖拽落点换算。不依赖 Dexie。
 */
import { describe, expect, it } from "vitest";
import {
  SORT_ORDER_STEP,
  compareWithinContainer,
  containerKeyOf,
  isManualOrder,
  moveIdTo,
  numberSequence,
  resolveRemoteSortOrder,
  sortNotesForDisplay,
  swapAdjacent,
  topOrderValue,
  type OrderableRow,
} from "@/lib/data/note-order";

function row(
  id: string,
  overrides: Partial<OrderableRow> = {}
): OrderableRow {
  return {
    id,
    notebookId: null,
    pinned: false,
    createdAt: 1000,
    updatedAt: 1000,
    sortOrder: null,
    ...overrides,
  };
}

describe("容器与手动模式判定", () => {
  it("未分类与笔记本各自成容器", () => {
    expect(containerKeyOf(null)).toBe("");
    expect(containerKeyOf(undefined)).toBe("");
    expect(containerKeyOf("nb1")).toBe("nb1");
  });

  it("只有存在已编号的笔记才算手动顺序", () => {
    expect(isManualOrder([row("a"), row("b")])).toBe(false);
    expect(isManualOrder([row("a"), row("b", { sortOrder: 0 })])).toBe(true);
  });
});

describe("容器内排序", () => {
  it("未手动排序：置顶优先，其次创建时间升序（早创建的在前）", () => {
    const a = row("a", { createdAt: 100 });
    const b = row("b", { createdAt: 300 });
    const c = row("c", { createdAt: 200, pinned: true });
    const sorted = [a, b, c].sort((x, y) => compareWithinContainer(x, y, false));
    expect(sorted.map((r) => r.id)).toEqual(["c", "a", "b"]);
  });

  it("手动排序：置顶仍排最前（优先级高于 sortOrder），其余按 sortOrder", () => {
    const a = row("a", { sortOrder: 2 * SORT_ORDER_STEP, pinned: true });
    const b = row("b", { sortOrder: 0 });
    const c = row("c", { sortOrder: SORT_ORDER_STEP });
    const sorted = [a, b, c].sort((x, y) => compareWithinContainer(x, y, true));
    expect(sorted.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("手动容器里未编号的笔记排最后（异常数据兜底）", () => {
    const a = row("a", { sortOrder: 5, updatedAt: 100 });
    const b = row("b", { updatedAt: 999 });
    const sorted = [b, a].sort((x, y) => compareWithinContainer(x, y, true));
    expect(sorted.map((r) => r.id)).toEqual(["a", "b"]);
  });
});

describe("混合视图（跨容器）分块", () => {
  it("同一容器连续成块，块内遵守各自顺序，块间按块内最早创建升序", () => {
    const rows = [
      row("nb1-a", { notebookId: "nb1", createdAt: 1000, sortOrder: SORT_ORDER_STEP }),
      row("nb1-b", { notebookId: "nb1", createdAt: 500, sortOrder: 0 }),
      row("none-a", { createdAt: 800 }),
      row("nb1-c", { notebookId: "nb1", sortOrder: 2 * SORT_ORDER_STEP }),
    ];
    const sorted = sortNotesForDisplay(rows);
    // nb1 块内按 sortOrder：b → a → c；未分类自成一块。
    // 块间：nb1 的块内最早 createdAt 是 500（b）< 未分类 800，故 nb1 块在前
    expect(sorted.map((r) => r.id)).toEqual(["nb1-b", "nb1-a", "nb1-c", "none-a"]);
  });

  it("未手动排序的容器仍按创建时间升序，且不与其他容器交错", () => {
    const rows = [
      row("nb1-old", { notebookId: "nb1", createdAt: 100 }),
      row("nb1-new", { notebookId: "nb1", createdAt: 700 }),
      row("nb2-old", { notebookId: "nb2", createdAt: 200 }),
    ];
    const sorted = sortNotesForDisplay(rows);
    // nb1 块内升序：old → new；块间 nb1 earliest 100 < nb2 200，故 nb1 块在前
    expect(sorted.map((r) => r.id)).toEqual(["nb1-old", "nb1-new", "nb2-old"]);
  });
});

describe("编号与落点换算", () => {
  it("numberSequence 按步长递增", () => {
    const map = numberSequence(["a", "b", "c"]);
    expect(map.get("a")).toBe(0);
    expect(map.get("b")).toBe(SORT_ORDER_STEP);
    expect(map.get("c")).toBe(2 * SORT_ORDER_STEP);
  });

  it("moveIdTo 把项目放到目标下标（先移除自身）", () => {
    // [a,b,c] 拖 a 到 c 之后
    expect(moveIdTo(["a", "b", "c"], "a", 3)).toEqual(["b", "c", "a"]);
    // [a,b,c] 拖 c 到最前
    expect(moveIdTo(["a", "b", "c"], "c", 0)).toEqual(["c", "a", "b"]);
    // 越界下标被夹紧
    expect(moveIdTo(["a", "b"], "a", 99)).toEqual(["b", "a"]);
  });

  it("swapAdjacent 在边界返回 null", () => {
    expect(swapAdjacent(["a", "b"], "a", -1)).toBeNull();
    expect(swapAdjacent(["a", "b"], "b", 1)).toBeNull();
    expect(swapAdjacent(["a", "b", "c"], "a", 1)).toEqual(["b", "a", "c"]);
    expect(swapAdjacent(["a", "b"], "zzz", 1)).toBeNull();
  });

  it("topOrderValue 取当前最小值再减一档（新建 / 移入时置最前）", () => {
    expect(topOrderValue([])).toBe(0);
    expect(topOrderValue([row("a"), row("b")])).toBe(0);
    expect(topOrderValue([row("a", { sortOrder: 0 }), row("b", { sortOrder: 2048 })])).toBe(
      -SORT_ORDER_STEP
    );
  });
});

describe("远端 / 本地的顺序取舍", () => {
  it("服务端没有该字段（undefined）时保留本地顺序 —— 否则回环 pull 会抹掉刚排好的顺序", () => {
    expect(resolveRemoteSortOrder(undefined, 2048)).toBe(2048);
    expect(resolveRemoteSortOrder(undefined, 0)).toBe(0);
    expect(resolveRemoteSortOrder(undefined, null)).toBeNull();
    expect(resolveRemoteSortOrder(undefined, undefined)).toBeNull();
  });

  it("服务端明确返回 null 表示「已重置」，此时清空本地顺序", () => {
    expect(resolveRemoteSortOrder(null, 2048)).toBeNull();
  });

  it("服务端有值时以服务端为准", () => {
    expect(resolveRemoteSortOrder(1024, 2048)).toBe(1024);
    expect(resolveRemoteSortOrder(0, null)).toBe(0);
  });
});
