/**
 * sync-engine 测试基建：极简 PostgREST 查询构造器 + Supabase 客户端替身。
 * 语义对齐 supabase-js：链式收集过滤条件，await 时执行并返回
 * { data, error }；服务端触发器（version 自增 / server_updated_at 时钟）
 * 用可控的 FakeClock 模拟，测试完全确定性。
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Row = Record<string, any>;

/** 服务端时钟：从固定基准开始每 tick 前进 1s，可派生固定时间戳 */
export class FakeClock {
  private t = 0;
  constructor(private base = Date.UTC(2026, 0, 1)) {}
  tick(): string {
    this.t += 1000;
    return new Date(this.base + this.t).toISOString();
  }
  at(ms: number): string {
    return new Date(this.base + ms).toISOString();
  }
}

/** 解析 PostgREST or() 表达式：顶层逗号分句（括号内不分），支持 and(...) 嵌套 */
function makeOr(expr: string): (r: Row) => boolean {
  const clauses: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of expr) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) {
      clauses.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur) clauses.push(cur);

  const condition = (c: string): ((r: Row) => boolean) => {
    const i1 = c.indexOf(".");
    const i2 = c.indexOf(".", i1 + 1);
    const col = c.slice(0, i1);
    const op = c.slice(i1 + 1, i2);
    const value = c.slice(i2 + 1);
    if (op === "eq") return (r) => String(r[col]) === value;
    if (op === "gt") return (r) => String(r[col]) > value;
    throw new Error(`fake-postgrest: 不支持的操作符 ${op}`);
  };

  return (r: Row) =>
    clauses.some((clause) => {
      if (clause.startsWith("and(") && clause.endsWith(")")) {
        const inner = clause.slice(4, -1).split(",");
        return inner.every((c) => condition(c)(r));
      }
      return condition(clause)(r);
    });
}

export interface FakePostgrestHooks {
  /** 非 null 时所有请求返回 error（毒丸/网络故障注入） */
  fail: string | null;
  /** 每次请求执行前回调；返回 promise 可挂起该请求，
   *  用于构造「网络请求悬而未决期间本地继续编辑/删除」的交错场景 */
  beforeExecute?: (req: {
    mode: "select" | "insert" | "update";
    table: string;
  }) => Promise<void> | void;
}

export class FakePostgrest {
  private mode: "select" | "insert" | "update" = "select";
  private values: Row[] = [];
  private filters: Array<(r: Row) => boolean> = [];
  private orders: Array<[string, boolean]> = [];
  private limitN: number | null = null;

  constructor(
    private store: Row[],
    private clock: FakeClock,
    private hooks: FakePostgrestHooks,
    private table: string
  ) {}

  select(_cols = "*"): this {
    return this; // mode 不变：insert/update 后的 .select() 只表示返回行
  }
  insert(values: Row | Row[]): this {
    this.mode = "insert";
    this.values = Array.isArray(values) ? values : [values];
    return this;
  }
  update(values: Row): this {
    this.mode = "update";
    this.values = [values];
    return this;
  }
  eq(col: string, v: any): this {
    this.filters.push((r) => r[col] === v);
    return this;
  }
  gt(col: string, v: any): this {
    this.filters.push((r) => String(r[col]) > String(v));
    return this;
  }
  or(expr: string): this {
    this.filters.push(makeOr(expr));
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }): this {
    this.orders.push([col, opts?.ascending !== false]);
    return this;
  }
  limit(n: number): this {
    this.limitN = n;
    return this;
  }
  maybeSingle(): Promise<{ data: Row | null; error: { message: string } | null }> {
    return this.then(({ data, error }) => ({
      data: data && data.length > 0 ? data[0] : null,
      error,
    }));
  }

  private async execute(): Promise<{
    data: Row[] | null;
    error: { message: string } | null;
  }> {
    await this.hooks.beforeExecute?.({ mode: this.mode, table: this.table });
    if (this.hooks.fail) return { data: null, error: { message: this.hooks.fail } };

    if (this.mode === "insert") {
      const saved = this.values.map((v) => ({
        ...v,
        version: 1,
        server_updated_at: this.clock.tick(),
      }));
      this.store.push(...saved);
      return { data: saved, error: null };
    }

    if (this.mode === "update") {
      const hit = this.store.filter((r) => this.filters.every((f) => f(r)));
      for (const r of hit) {
        Object.assign(r, ...this.values, {
          version: (r.version ?? 0) + 1,
          server_updated_at: this.clock.tick(),
        });
      }
      return { data: hit, error: null };
    }

    let rows = this.store.filter((r) => this.filters.every((f) => f(r)));
    for (const [col, asc] of [...this.orders].reverse()) {
      rows = [...rows].sort((a, b) =>
        asc
          ? String(a[col]).localeCompare(String(b[col]))
          : String(b[col]).localeCompare(String(a[col]))
      );
    }
    if (this.limitN != null) rows = rows.slice(0, this.limitN);
    return { data: rows, error: null };
  }

  then<TResult1 = any, TResult2 = never>(
    onfulfilled?: ((value: { data: Row[] | null; error: { message: string } | null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }
}

export const USER_ID = "u1";

/** 创建与 supabase-js 表面兼容的客户端替身（from/storage/auth/channel） */
export function createFakeSupabase(clock: FakeClock, tables: Record<string, Row[]>) {
  const hooks: FakePostgrestHooks = { fail: null };
  const sb: any = {
    from(table: string) {
      return new FakePostgrest(
        tables[table] ?? (tables[table] = []),
        clock,
        hooks,
        table
      );
    },
    storage: {
      from(_bucket: string) {
        return {
          upload: async () => ({ data: null, error: null }),
          remove: async () => ({ data: null, error: null }),
          createSignedUrl: async () => ({
            data: { signedUrl: "https://signed.example/obj" },
            error: null,
          }),
          getPublicUrl: () => ({ data: { publicUrl: "https://public.example/obj" } }),
        };
      },
    },
    channel(_name: string) {
      const ch: any = {
        on() {
          return ch;
        },
        subscribe(_cb?: (status: string) => void) {
          return ch;
        },
      };
      return ch;
    },
    removeChannel() {},
    auth: {
      getSession: async () => ({
        data: { session: { user: { id: USER_ID, email: "t@example.com" } } },
      }),
      onAuthStateChange() {
        return { data: { subscription: { unsubscribe() {} } } };
      },
    },
  };
  return { sb, hooks };
}
