"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { CloudOff, Github, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase/client";
import { getSyncState, subscribeSync } from "@/lib/sync/sync-engine";

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
          <Button className="mt-4" variant="outline" onClick={() => router.push("/notes")}>
            返回本地使用
          </Button>
        </div>
      </main>
    );
  }

  const origin = typeof window !== "undefined" ? window.location.origin : undefined;

  const submitPassword = async (e: FormEvent) => {
    e.preventDefault();
    const sb = getSupabase();
    if (!sb) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === "signin") {
        const { error: err } = await sb.auth.signInWithPassword({ email, password });
        if (err) throw err;
      } else {
        const { data, error: err } = await sb.auth.signUp({ email, password });
        if (err) throw err;
        if (!data.session) {
          setNotice("注册成功：请查收确认邮件，验证后再登录。");
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

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
        options: { emailRedirectTo: `${origin}/login` },
      });
      if (err) throw err;
      setOtpSent(true);
      setNotice(
        "已发送登录链接到邮箱：点击即自动登录。若收到的是 6 位验证码，可在下方输入完成登录。"
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
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

  const oauth = async (provider: "google" | "github") => {
    const sb = getSupabase();
    if (!sb) return;
    setError(null);
    const { error: err } = await sb.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${origin}/login` },
    });
    if (err) setError(err.message);
  };

  return (
    <main className="flex min-h-dvh items-center justify-center overflow-y-auto p-6">
      <form
        onSubmit={submitPassword}
        className="w-full max-w-md space-y-4 rounded-lg border bg-card p-6"
      >
        <div>
          <h1 className="text-lg font-semibold">登录以启用云同步</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            数据仍优先保存在本地；登录后自动在多设备间同步。
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
        <Input
          type="password"
          required
          minLength={6}
          placeholder="密码（至少 6 位）"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-label="密码"
        />

        {error && <p className="text-xs text-destructive">{error}</p>}
        {notice && (
          <p className="text-xs text-green-600 dark:text-green-400">{notice}</p>
        )}

        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? "处理中…" : mode === "signin" ? "登录" : "注册"}
        </Button>

        {/* 无密码登录：Magic Link + 验证码兜底 */}
        <div className="space-y-2 rounded-md border p-3">
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
        </div>

        {/* 第三方登录 */}
        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => void oauth("google")}
            title="使用 Google 账号登录"
          >
            Google
          </Button>
          <Button
            type="button"
            variant="outline"
            className="gap-2"
            disabled={busy}
            onClick={() => void oauth("github")}
            title="使用 GitHub 账号登录"
          >
            <Github className="h-4 w-4" />
            GitHub
          </Button>
        </div>

        <button
          type="button"
          className="w-full text-center text-xs text-muted-foreground hover:text-foreground"
          onClick={() => {
            setMode(mode === "signin" ? "signup" : "signin");
            setError(null);
            setNotice(null);
          }}
        >
          {mode === "signin" ? "没有账号？注册" : "已有账号？登录"}
        </button>

        <button
          type="button"
          className="w-full text-center text-xs text-muted-foreground hover:text-foreground"
          onClick={() => router.push("/notes")}
        >
          暂不同步，返回本地使用
        </button>
      </form>
    </main>
  );
}
