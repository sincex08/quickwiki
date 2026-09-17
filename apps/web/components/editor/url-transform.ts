import { defaultUrlTransform } from "react-markdown";

/**
 * 预览（ReactMarkdown）用 URL 过滤。
 *
 * react-markdown v10 默认只放行 http/https/irc/ircs/mailto/xmpp 等安全协议，
 * 会把本应用的附件协议 quickwiki-att:// 与存量 data:image 图片清空，
 * 导致预览图不显示。这里定向放行这两类前缀，其余一律交给默认安全策略
 * （javascript: 等危险协议仍被拦截、非图片的 data: 也不放行）。
 */
export function noteUrlTransform(value: string): string {
  if (/^quickwiki-att:/i.test(value)) return value;
  if (/^data:image\//i.test(value)) return value;
  return defaultUrlTransform(value);
}
