"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Check,
  CloudOff,
  Github,
  KeyRound,
  Link2,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase/client";
import { getSyncState, subscribeSync, type SyncState } from "@/lib/sync/sync-engine";

const PROVIDER_LABEL: Record<string, string> = {
  email: "邮箱",
  github: "GitHub",
};

/**
 * 账号管理：查看登录方式、设置/修改密码、绑定 GitHub。
 * 同一邮箱的密码 / 邮箱链接 / GitHub 在 Supabase 侧归属同一账号。
 */
export default function AccountPage() {
  const router = useRouter();
  const [sync, setSync] = useState<SyncState>(() => getSyncState());
  const [identities, setIdentities] = useState<string[]>([]);
  const [idLoading, setIdLoading] = useState(true);

  // 设置密码表单
  const [pwd, setPwd] = useState("");
  const [pwd2, setPwd2] = useState("");
  const [pwdBusy, setPwdBusy] = useState(false);
  const [pwdMsg, setPwdMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // 绑定 GitHub
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkMsg, setLinkMsg] = useState<string | null>(null);

  useEffect(() => subscribeSync(setSync), []);

  // status 离开 disabled 即视为同步引擎完成初始化（已配置前提下）
  const ready = sync.status !== "disabled";
  const signedIn = Boolean(sync.userId);

  // 未登录访问：跳回登录页
  useEffect(() => {
    if (ready && !signedIn) router.replace("/login");
  }, [ready, signedIn, router]);

  // 加载已绑定的登录方式
  useEffect(() => {
    if (!signedIn) return;
    let active = true;
    setIdLoading(true);
    getSupabase()
      ?.auth.getUserIdentities()
      .then(({ data }) => {
        if (!active) return;
        setIdentities((data?.identities ?? []).map((i) => i.provider));
        setIdLoading(false);
      })
      .catch(() => {
        if (active) setIdLoading(false);
      });
    return () => {
      active = false;
    };
  }, [signedIn]);

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
      } else {
        setPwdMsg({ ok: true, text: "密码已设置，下次可用邮箱 + 密码直接登录。" });
        setPwd("");
        setPwd2("");
      }
    } finally {
      setPwdBusy(false);
    }
  };

  const linkGithub = async () => {
    const sb = getSupabase();
    if (!sb) return;
    setLinkMsg(null);
    setLinkBusy(true);
    try {
      const origin = window.location.origin;
      const { error } = await sb.auth.linkIdentity({
        provider: "github",
        options: { redirectTo: `${origin}/login` },
      });
      if (error) {
        setLinkMsg(
          `绑定失败：${error.message}。可退出后在登录页点击 GitHub 登录，同邮箱会自动关联为同一账号。`
        );
      }
      // 成功时页面会跳转 GitHub 授权，无需就地处理
    } finally {
      setLinkBusy(false);
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
            管理登录方式：同一邮箱的密码、邮箱链接、GitHub 归属同一账号。
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
            <div className="flex items-start justify-between gap-2">
              <span className="shrink-0 text-muted-foreground">登录方式</span>
              <div className="flex flex-wrap justify-end gap-1.5">
                {idLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                ) : identities.length > 0 ? (
                  identities.map((p) => (
                    <Badge key={p} variant="secondary">
                      {PROVIDER_LABEL[p] ?? p}
                    </Badge>
                  ))
                ) : (
                  <span className="text-xs text-muted-foreground">加载失败</span>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* 设置 / 修改密码 */}
        <section className="rounded-lg border bg-card p-5">
          <h2 className="flex items-center gap-1.5 text-sm font-medium">
            <KeyRound className="h-4 w-4" />
            设置密码
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            设置后可用邮箱 + 密码直接登录；已有密码时此处即为修改密码。
          </p>
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
            {pwdMsg && (
              <p
                className={
                  pwdMsg.ok
                    ? "text-xs text-green-600 dark:text-green-400"
                    : "text-xs text-destructive"
                }
              >
                {pwdMsg.text}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={pwdBusy}>
              {pwdBusy ? "处理中…" : "保存密码"}
            </Button>
          </form>
        </section>

        {/* 绑定 GitHub */}
        <section className="rounded-lg border bg-card p-5">
          <h2 className="flex items-center gap-1.5 text-sm font-medium">
            <Link2 className="h-4 w-4" />
            绑定 GitHub
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            绑定后可直接用 GitHub 登录本账号（GitHub 邮箱需与账号邮箱一致）。
          </p>
          {linkMsg && <p className="mt-2 text-xs text-destructive">{linkMsg}</p>}
          <div className="mt-3">
            {identities.includes("github") ? (
              <span className="inline-flex items-center gap-1.5 text-sm text-green-600 dark:text-green-400">
                <Check className="h-4 w-4" />
                已绑定 GitHub
              </span>
            ) : (
              <Button
                type="button"
                variant="outline"
                className="w-full gap-2"
                disabled={linkBusy}
                onClick={() => void linkGithub()}
              >
                <Github className="h-4 w-4" />
                {linkBusy ? "跳转中…" : "绑定 GitHub"}
              </Button>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
