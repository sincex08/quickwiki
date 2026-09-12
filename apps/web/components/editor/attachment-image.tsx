"use client";

import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import Image from "@tiptap/extension-image";
import { ImageOff } from "lucide-react";
import { useAttachmentImgSrc } from "@/lib/attachments/resolve";

/**
 * 图片节点视图：src 无论协议串（quickwiki-att://）还是外部 URL / 存量 data URL，
 * 统一经 useAttachmentImgSrc 解析后渲染；解析失败显示占位卡片。
 * 序列化仍由 tiptap-markdown 按节点属性输出 ![alt](src)，协议串零改写。
 */
function AttachmentImageView({ node }: NodeViewProps) {
  const src = node.attrs.src as string | undefined;
  const alt = node.attrs.alt as string | undefined;
  const title = node.attrs.title as string | undefined;
  const resolved = useAttachmentImgSrc(src);

  if (!resolved) {
    return (
      <NodeViewWrapper as="div" className="attachment-image">
        <span className="attachment-image__placeholder">
          <ImageOff className="h-4 w-4 shrink-0" />
          <span className="truncate">{alt || "图片暂不可用"}</span>
        </span>
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper as="div" className="attachment-image">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={resolved} alt={alt ?? ""} title={title} draggable />
    </NodeViewWrapper>
  );
}

export const AttachmentImage = Image.extend({
  addNodeView() {
    return ReactNodeViewRenderer(AttachmentImageView);
  },
});
