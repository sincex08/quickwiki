"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

/**
 * URL 规范化与安全白名单：
 * - 允许 http(s): / mailto: / tel: / 相对路径（# 或 / 开头）
 * - 无协议地址自动补 https://
 * - 拒绝 javascript: / data: / vbscript: 及其他未知协议
 * 非法返回 null。
 */
export function normalizeUrl(raw: string): string | null {
  const u = raw.trim();
  if (!u) return null;
  if (/^(javascript|data|vbscript):/i.test(u)) return null;
  if (/^(https?:|mailto:|tel:)/i.test(u)) return u;
  if (/^(#|\/)/.test(u)) return u;
  if (u.includes(":")) return null;
  return `https://${u}`;
}

export interface LinkDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialUrl: string;
  /** 当前选区已在链接上时显示「移除链接」 */
  hasLink: boolean;
  onSubmit: (url: string) => void;
  onRemove: () => void;
}

export function LinkDialog({
  open,
  onOpenChange,
  initialUrl,
  hasLink,
  onSubmit,
  onRemove,
}: LinkDialogProps) {
  const [url, setUrl] = useState(initialUrl);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setUrl(initialUrl);
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submit = () => {
    const normalized = normalizeUrl(url);
    if (!normalized) {
      setError(
        url.trim()
          ? "链接不合法：仅支持 http(s)、mailto、tel 或相对路径"
          : "请输入链接地址"
      );
      return;
    }
    onSubmit(normalized);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{hasLink ? "编辑链接" : "插入链接"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <Input
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="https://example.com"
            aria-label="链接地址"
            autoFocus
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
          <p className="text-xs text-muted-foreground">
            无协议地址自动补全 https://；支持 mailto: 与 tel:
          </p>
        </div>
        <DialogFooter className="items-center gap-2 sm:justify-between">
          {hasLink ? (
            <Button
              variant="outline"
              className="text-destructive hover:text-destructive"
              onClick={() => {
                onRemove();
                onOpenChange(false);
              }}
            >
              移除链接
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button onClick={submit}>确定</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
