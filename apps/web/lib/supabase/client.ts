import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Supabase 客户端（安全初始化）。
 * 未配置环境变量时返回 null，应用保持完全本地可用（同步功能禁用）。
 * 静态导出下 NEXT_PUBLIC_* 在构建时内联：填写 .env.local 后需重新构建/重启 dev。
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && anonKey);

let client: SupabaseClient | null = null;

/**
 * 会话持久化说明（移动端「第二天要重新登录」的关键）：
 * - Supabase 默认 JWT 有效期 1 小时，refresh token 长期有效；
 *   客户端库会在过期前自动刷新，正常情况下会话可长期保持。
 * - 移动端浏览器（尤其 iOS Safari）会在后台回收标签页并可能清理
 *   localStorage；恢复时若持有一个已过期的 access token，需要主动
 *   refreshSession() 才能续期，否则会被判定为未登录。
 * - 解析 auth 回调（Magic Link / OAuth）时用 PKCE 流程，比 implicit 更能
 *   抵御 URL fragment 在移动端被截断/丢失的问题。
 * - storageKey 显式固定，避免不同子域/预览域名共用导致互相覆盖。
 */
export function getSupabase(): SupabaseClient | null {
  if (!isSupabaseConfigured) return null;
  if (!client) {
    client = createClient(url!, anonKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: "pkce",
        storageKey: "quickwiki-auth",
        // 不传自定义 lock：客户端库已内置单飞刷新（single-flight）+
        // 提交守卫，并依赖 GoTrue 处理跨标签页竞态；自定义 lock 会退化到
        // 旧的兼容路径，反而更容易出现并发刷新的问题。
      },
    });
  }
  return client;
}

/**
 * 恢复/续期会话。移动端浏览器切回前台或页面重新可见时调用：
 * 若本地存有会话但 access token 已过期，主动刷新一次，
 * 避免长时间后台后打开就要求重新登录。
 * 返回是否处于已登录状态。
 */
export async function ensureFreshSession(): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  try {
    const { data } = await sb.auth.getSession();
    const session = data.session;
    if (!session) return false;

    // expires_at 为秒级时间戳；留 60s 余量，避免临界过期
    const expiresAt = session.expires_at ?? 0;
    const nowSec = Math.floor(Date.now() / 1000);
    if (expiresAt - nowSec < 60) {
      const { data: refreshed, error } = await sb.auth.refreshSession();
      if (error || !refreshed.session) return false;
    }
    return true;
  } catch {
    // 网络异常等：保留现有会话，交由后续自动刷新重试
    return false;
  }
}
