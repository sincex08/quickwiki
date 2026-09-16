"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, CloudOff, KeyRound, ShieldOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getSessionAuthMethod, getSupabase, isSupabaseConfigured } from "@/lib/supabase/client";
import { getSyncState, subscribeSync, type SyncState } from "@/lib/sync/sync-engine";

/** 会话签发方式 → 展示名（登录方式只有邮箱：密码 or 邮箱链接） */
const METHOD_LABEL: Record<string, string> = {
  password: "邮箱 + 密码",
  otp: "邮箱链接",
  email: "邮箱链接",
};

/**
 * 「是否设置过密码」本机记录。
 *
 * 服务端不暴露「该用户是否设过密码」（identities 里只有 provider，密码与邮箱链接
 * 同属 email 身份），所以这里在**本机**记一笔：设置成功的时刻。
 * 另外，本次会话若是用密码签发的（JWT 的 amr=password），那也证明有密码。
 * 两者都没有时显示「未设置」——换设备后可能显示不准，但按钮动作一样（都是设置/覆盖密码），
 * 不会做出错误操作。
 */
const PWD_MARKER_PREFIX = "quickwiki.pwd-set.";

/** 读取登录方式的最长等待：auth 请求可能卡在令牌刷新上，不能让状态区永远停在「读取中」 */
const METHOD_TIMEOUT_MS = 8000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`读取超时（${Math.round(ms / 1000)}s）`)), ms)
    ),
  ]);
}

function readPasswordMarker(uid: string | null): string | null {
  if (!uid || typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(PWD_MARKER_PREFIX + uid);
  } catch {
    return null;
  }
}

function writePasswordMarker(uid: string | null): string | null {
  if (!uid || typeof window === "undefined") return null;
  const at = new Date().toISOString();
  try {
    window.localStorage.setItem(PWD_MARKER_PREFIX + uid, at);
    return at;
  } catch {
    return null;
  }
}

/**
 * 账号管理：看得到「有没有设过密码」，并就地设置 / 修改。
 * 登录方式只有邮箱一条链路：邮箱链接（免密）与邮箱 + 密码归属同一账号。
 */
export default function AccountPage() {
  const router = useRouter();
  const [sync, setSync] = useState<SyncState>(() => getSyncState());
  /** 本次会话的签发方式：password / otp */
  const [method, setMethod] = useState<string | null>(null);
  const [methodLoaded, setMethodLoaded] = useState(false);

  // 密码
  const [pwdSetAt, setPwdSetAt] = useState<string | null>(null);
  const [pwdOpen, setPwdOpen] = useState(false);
  const [pwd, setPwd] = useState("");
  const [pwd2, setPwd2] = useState("");
  const [pwdBusy, setPwdBusy] = useState(false);
  const [pwdMsg, setPwdMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => subscribeSync(setSync), []);

  // status 离开 disabled 即视为同步引擎完成初始化（已配置前提下）
  const ready = sync.status !== "disabled";
  const signedIn = Boolean(sync.userId);

  // 未登录访问：跳回登录页
  useEffect(() => {
    if (ready && !signedIn) router.replace("/login");
  }, [ready, signedIn, router]);

  // 加载「本次登录方式」与密码状态（登录后才请求）
  useEffect(() => {
    if (!signedIn) return;
    setPwdSetAt(readPasswordMarker(sync.userId));
    void (async () => {
      try {
        setMethod(await withTimeout(getSessionAuthMethod(), METHOD_TIMEOUT_MS));
      } catch {
        // 读不到就留空，界面显示「—」；它只用于展示，不影响任何动作
        setMethod(null);
      } finally {
        setMethodLoaded(true);
      }
    })();
  }, [signedIn, sync.userId]);

  if (!isSupabaseConfigured) {
    return (
      <main className="flex h-full items-center justify-center p-6">
        <div className="w-full max-w-md rounded-lg border bg-card p-6 text-center">
          <CloudOff className="mx-auto h-8 w-8 text-muted-foreground" />
          <h1 className="mt-3 text-lg font-semibold">云同步未配置</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            填写 Supabase 配置后即可管理账号（见登录页说明）。
          </p>
        </div>
      </main>
    );
  }

  // 初始化中或等待跳转登录页
  if (!signedIn) {
    return <div className="h-full" />;
  }

  /** 本次会话是密码签发的，就一定有密码；否则看本机记录 */
  const hasPassword = pwdSetAt !== null || method === "password";

  const submitPassword = async (e: FormEvent) => {
    e.preventDefault();
    const sb = getSupabase();
    if (!sb) return;
    setPwdMsg(null);
    if (pwd.length < 6) {
      setPwdMsg({ ok: false, text: "密码至少 6 位。" });
      return;
    }
    if (pwd !== pwd2) {
      setPwdMsg({ ok: false, text: "两次输入的密码不一致。" });
      return;
    }
    setPwdBusy(true);
    try {
      const { error } = await sb.auth.updateUser({ password: pwd });
      if (error) {
        setPwdMsg({ ok: false, text: error.message });
        return;
      }
      setPwdSetAt(writePasswordMarker(sync.userId) ?? new Date().toISOString());
      setMethod("password");
      setPwd("");
      setPwd2("");
      setPwdOpen(false);
      setPwdMsg({
        ok: true,
        text: hasPassword
          ? "密码已更新，下次可用邮箱 + 密码登录。"
          : "密码已设置，下次可用邮箱 + 密码登录。",
      });
    } finally {
      setPwdBusy(false);
    }
  };

  return (
    <main className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-lg space-y-4 p-4 md:p-6">
        <div>
          <Button
            variant="ghost"
            size="sm"
            className="-ml-2 mb-1 gap-1 px-2 text-muted-foreground"
            onClick={() => router.push("/notes")}
          >
            <ArrowLeft className="h-4 w-4" />
            返回笔记
          </Button>
          <h1 className="text-lg font-semibold">账号管理</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            管理登录方式：邮箱链接与邮箱 + 密码归属同一账号。
          </p>
        </div>

        {/* 账号信息 */}
        <section className="rounded-lg border bg-card p-5">
          <h2 className="text-sm font-medium">账号信息</h2>
          <div className="mt-3 space-y-2.5 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="shrink-0 text-muted-foreground">邮箱</span>
              <span className="truncate">{sync.userEmail}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="shrink-0 text-muted-foreground">本次登录方式</span>
              <span className="truncate">
                {methodLoaded ? (method ? METHOD_LABEL[method] ?? method : "—") : "读取中…"}
              </span>
            </div>
          </div>
        </section>

        {/* 密码：状态 + 设置/修改 */}
        <section className="rounded-lg border bg-card p-5">
          <h2 className="flex items-center gap-1.5 text-sm font-medium">
            <KeyRound className="h-4 w-4" />
            密码
          </h2>
          <div className="mt-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              {hasPassword ? (
                <span className="inline-flex items-center gap-1.5 text-sm text-green-600 dark:text-green-400">
                  <Check className="h-4 w-4" />
                  已设置
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                  <ShieldOff className="h-4 w-4" />
                  未设置
                </span>
              )}
              <p className="mt-1 text-xs text-muted-foreground">
                {hasPassword
                  ? "可用邮箱 + 密码直接登录，无需等邮件。"
                  : "当前只能用邮箱链接登录；设置密码后可用邮箱 + 密码登录。"}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={() => {
                setPwdMsg(null);
                setPwdOpen((open) => !open);
              }}
            >
              {pwdOpen ? "收起" : hasPassword ? "修改密码" : "设置密码"}
            </Button>
          </div>

          {pwdOpen && (
            <form onSubmit={submitPassword} className="mt-3 space-y-2">
              <Input
                type="password"
                required
                minLength={6}
                placeholder="新密码（至少 6 位）"
                value={pwd}
                onChange={(e) => setPwd(e.target.value)}
                aria-label="新密码"
              />
              <Input
                type="password"
                required
                minLength={6}
                placeholder="确认新密码"
                value={pwd2}
                onChange={(e) => setPwd2(e.target.value)}
                aria-label="确认新密码"
              />
              <Button type="submit" className="w-full" disabled={pwdBusy}>
                {pwdBusy ? "处理中…" : "保存密码"}
              </Button>
            </form>
          )}

          {pwdMsg && (
            <p
              className={
                pwdMsg.ok
                  ? "mt-2 text-xs text-green-600 dark:text-green-400"
                  : "mt-2 text-xs text-destructive"
              }
            >
              {pwdMsg.text}
            </p>
          )}
          <p className="mt-2 text-[11px] text-muted-foreground">
            密码状态按本机记录与本次登录方式判断；在其它设备设过密码时这里可能显示为未设置，
            点「设置密码」重设即可。
          </p>
        </section>
      </div>
    </main>
  );
}
