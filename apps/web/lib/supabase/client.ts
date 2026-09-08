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

export function getSupabase(): SupabaseClient | null {
  if (!isSupabaseConfigured) return null;
  if (!client) {
    client = createClient(url!, anonKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
    });
  }
  return client;
}
