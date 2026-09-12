"use client";

import { ImageOff } from "lucide-react";
import { useAttachmentImgSrc } from "@/lib/attachments/resolve";

/**
 * 预览（ReactMarkdown）用图片组件：
 * quickwiki-att:// 协议串解析为本地 blob / 公开 URL 回退；
 * data: / https: 原样透传（存量数据与外链兼容）。
 */
export function MarkdownImg({ src, alt }: { src?: string; alt?: string }) {
  const resolved = useAttachmentImgSrc(src);

  if (!resolved) {
    return (
      <span className="md-img-missing" title={alt || "图片缺失"}>
        <ImageOff className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{alt || "图片缺失"}</span>
      </span>
    );
  }

  // eslint-disable-next-line @next/next/no-img-element
  return <img src={resolved} alt={alt ?? ""} loading="lazy" />;
}

export default MarkdownImg;
