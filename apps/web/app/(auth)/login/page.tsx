"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { CloudOff, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase/client";
import { getSyncState, subscribeSync } from "@/lib/sync/sync-engine";

/**
 * 登录 / 注册（仅邮箱：链接免密 + 密码）。
 *
 * 注册刻意**不提供密码**：填邮箱收一封登录链接即可完成注册（首次点击即建号），
 * 密码留到登录后在「账号管理」里设置，之后才能用邮箱 + 密码登录。
 * 这样注册路径只有一个（邮箱链接），少一条会卡在「收不到确认邮件」的分支。
 *
 * 不提供任何第三方（OAuth）登录入口：服务端未开启时它只会带来一句点了才出现的
 * 英文报错，删掉后登录方式收敛为邮箱一条链路。
 */
export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [userId, setUserId] = useState(getSyncState().userId);

  useEffect(() => subscribeSync((s) => setUserId(s.userId)), []);

  useEffect(() => {
    if (userId) router.replace("/notes");
  }, [userId, router]);

  if (!isSupabaseConfigured) {
    return (
      <main className="flex min-h-dvh items-center justify-center p-6">
        <div className="w-full max-w-md rounded-lg border bg-card p-6 text-center">
          <CloudOff className="mx-auto h-8 w-8 text-muted-foreground" />
          <h1 className="mt-3 text-lg font-semibold">云同步未配置</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            请先在 Supabase 控制台创建项目（建议新加坡区域），执行仓库根目录
            <code className="mx-1 rounded bg-muted px-1 py-0.5 font-mono text-xs">
              supabase/schema.sql
            </code>
            ，然后把 Project URL 与 anon 公钥填入
            <code className="mx-1 rounded bg-muted px-1 py-0.5 font-mono text-xs">
              apps/web/.env.local
            </code>
            （模板见 .env.example），重启 dev 服务器后回到本页。
          </p>
        </div>
      </main>
    );
  }

  const origin = typeof window !== "undefined" ? window.location.origin : undefined;

  /** 邮箱链接：注册与登录同一条通道（首次点击即建号，无需密码） */
  const sendMagicLink = async () => {
    const sb = getSupabase();
    if (!sb) return;
    if (!email) {
      setError("请先填写邮箱");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const { error: err } = await sb.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: `${origin}/login`, shouldCreateUser: true },
      });
      if (err) throw err;
      setOtpSent(true);
      setNotice(
        mode === "signup"
          ? "注册链接已发送：点开邮件里的链接即完成注册并登录。若收到的是 6 位验证码，可在下方输入完成。"
          : "已发送登录链接到邮箱：点击即自动登录。若收到的是 6 位验证码，可在下方输入完成登录。"
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  /** 邮箱 + 密码登录：仅对「已在账号管理里设置过密码」的账号有效 */
  const signInWithPassword = async () => {
    const sb = getSupabase();
    if (!sb) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const { error: err } = await sb.auth.signInWithPassword({ email, password });
      if (err) throw err;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(
        /invalid login credentials/i.test(message)
          ? "邮箱或密码不正确。若还没设过密码，请改用「发送登录链接（无需密码）」，登录后在「账号管理」里设置密码。"
          : message
      );
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (mode === "signin") void signInWithPassword();
    else void sendMagicLink();
  };

  const verifyCode = async () => {
    const sb = getSupabase();
    if (!sb) return;
    setBusy(true);
    setError(null);
    try {
      const { error: err } = await sb.auth.verifyOtp({
        email,
        token: code,
        type: "email",
      });
      if (err) throw err;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-dvh items-center justify-center overflow-y-auto p-6">
      <form
        onSubmit={submit}
        className="w-full max-w-md space-y-4 rounded-lg border bg-card p-6"
      >
        <div>
          <h1 className="text-lg font-semibold">
            {mode === "signin" ? "登录后开始使用" : "注册 QuickWiki"}
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            {mode === "signin"
              ? "笔记按账号隔离存储；登录后自动在多设备间同步。"
              : "注册无需设置密码：填邮箱收链接即可建号，密码可稍后在「账号管理」里设置。"}
          </p>
        </div>

        <Input
          type="email"
          required
          placeholder="邮箱"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-label="邮箱"
        />

        {/* 密码只用于「已设置过密码」的账号登录；注册路径不出现密码 */}
        {mode === "signin" && (
          <Input
            type="password"
            required
            minLength={6}
            placeholder="密码（至少 6 位）"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-label="密码"
          />
        )}

        {error && <p className="text-xs text-destructive">{error}</p>}
        {notice && (
          <p className="text-xs text-green-600 dark:text-green-400">{notice}</p>
        )}

        <Button type="submit" className="w-full" disabled={busy}>
          {busy
            ? "处理中…"
            : mode === "signup"
              ? "发送注册链接（无需密码）"
              : "登录"}
        </Button>

        {/* 无密码通道：注册模式的主操作已经是它，这里只给登录模式留入口 */}
        {mode === "signin" && (
          <div className="space-y-2 rounded-md border p-3">
            <p className="text-xs text-muted-foreground">
              没有密码，或忘了密码？用邮箱链接登录，无需密码。
            </p>
            <Button
              type="button"
              variant="outline"
              className="w-full gap-2"
              disabled={busy}
              onClick={() => void sendMagicLink()}
              title="向邮箱发送一次性登录链接，无需密码"
            >
              <Mail className="h-4 w-4" />
              发送登录链接（无需密码）
            </Button>
          </div>
        )}

        {/* 6 位验证码兜底：邮件里给的是验证码而非链接时用（两种模式共用） */}
        {otpSent && (
          <div className="flex gap-2">
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="6 位验证码（可选）"
              aria-label="验证码"
              inputMode="numeric"
            />
            <Button
              type="button"
              variant="outline"
              disabled={busy || code.length < 6}
              onClick={() => void verifyCode()}
            >
              验证
            </Button>
          </div>
        )}

        <button
          type="button"
          className="w-full text-center text-xs text-muted-foreground hover:text-foreground"
          onClick={() => {
            setMode(mode === "signin" ? "signup" : "signin");
            setError(null);
            setNotice(null);
            setOtpSent(false);
          }}
        >
          {mode === "signin" ? "没有账号？注册" : "已有账号？登录"}
        </button>
      </form>
    </main>
  );
}
