"use client";

import { useEffect, useRef, useState } from "react";
import { format } from "date-fns";
import { zhCN } from "date-fns/locale";
import {
  Download,
  Images,
  ImageOff,
  ImagePlus,
  MoreVertical,
  Pencil,
  Trash2,
  Upload,
} from "lucide-react";
import type { Note } from "@quickwiki/shared";
import { ATT_PROTOCOL } from "@quickwiki/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { MiniSwitch } from "@/components/common/mini-switch";
import { Lightbox } from "./lightbox";
import { useAttachmentRecords } from "@/hooks/use-data";
import { useUIStore } from "@/stores/use-ui-store";
import { useToastStore } from "@/stores/use-toast-store";
import { attachmentRepo } from "@/lib/data/attachment-repository";
import { createAttachmentsFromFiles } from "@/lib/images";
import {
  readCompressPref,
  writeCompressPref,
} from "@/lib/attachments/prefs";
import {
  attachmentPublicUrl,
  registerBlobUrl,
  useAttachmentImgSrc,
} from "@/lib/attachments/resolve";
import {
  appendRefsToMarkdown,
  extractAttachmentIds,
  insertRefsViaActiveEditor,
  removeRefViaActiveEditor,
  removeRefsFromMarkdown,
} from "@/lib/attachments/refs";
import { cn } from "@/lib/utils";
import type { AttachmentRecord } from "@/lib/db";

type FilterChip = "all" | "used" | "unused";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** 移动端（<768px）抽屉从底部滑出，其余从右侧 */
function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const update = () => setMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return mobile;
}

/** 网格缩略图：blob 直读 or 公开 URL 回退；无 blob 无回退显示占位 */
function Thumb({ record }: { record: AttachmentRecord }) {
  const src = useAttachmentImgSrc(`${ATT_PROTOCOL}${record.id}`);
  if (!src) {
    return (
      <div className="flex h-full w-full items-center justify-center text-muted-foreground">
        <ImageOff className="h-5 w-5" />
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={record.filename}
      loading="lazy"
      className="h-full w-full object-cover"
      draggable={false}
    />
  );
}

interface AttachmentDrawerProps {
  note: Note;
  /** 编辑器最新内容（含防抖期未落盘部分），用于引用状态判定与文末追加 */
  content: string;
  /**
   * 非编辑模式下改写正文的唯一通道（由编辑器面板实现）：
   * 负责取消待落盘的防抖内容、接管内容并重挂源码视图，然后异步落盘。
   * 抽屉不直接写仓库，否则会与编辑器的防抖保存互相覆盖、且源码视图不刷新。
   */
  onExternalContentChange: (markdown: string) => void;
}

export function AttachmentDrawer({
  note,
  content,
  onExternalContentChange,
}: AttachmentDrawerProps) {
  const open = useUIStore((s) => s.attachmentsDrawerOpen);
  const setOpen = useUIStore((s) => s.setAttachmentsDrawerOpen);
  const editorMode = useUIStore((s) => s.editorMode);
  const { records, loading } = useAttachmentRecords(open ? note.id : null);
  const toast = useToastStore((s) => s.show);

  const isMobile = useIsMobile();
  const [compress, setCompress] = useState(true);
  const [filter, setFilter] = useState<FilterChip>("all");
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [preview, setPreview] = useState<AttachmentRecord | null>(null);
  const [confirmSimple, setConfirmSimple] = useState<AttachmentRecord | null>(null);
  const [confirmReferenced, setConfirmReferenced] = useState<AttachmentRecord | null>(null);
  const [confirmCleanup, setConfirmCleanup] = useState(false);
  const [renameTarget, setRenameTarget] = useState<AttachmentRecord | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) setCompress(readCompressPref());
  }, [open]);

  const referencedIds = extractAttachmentIds(content);

  const referenced = records.filter((r) => referencedIds.includes(r.id));
  const visible =
    filter === "all"
      ? records
      : records.filter((r) =>
          filter === "used"
            ? referencedIds.includes(r.id)
            : !referencedIds.includes(r.id)
        );
  const totalSize = records.reduce((sum, r) => sum + r.size, 0);

  const handleFiles = async (files: FileList | File[] | null) => {
    if (!files) return;
    const list = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (list.length === 0) return;
    setUploading(true);
    try {
      const { created } = await createAttachmentsFromFiles(list, note.id, {
        compress,
      });
      if (created.length > 0) toast(`已上传 ${created.length} 张图片`, "success");
    } finally {
      setUploading(false);
    }
  };

  /** 插入正文：编辑模式光标处插入；预览/源码模式追加文末 */
  const insertRefs = (targets: AttachmentRecord[]) => {
    if (targets.length === 0) return;
    const refs = targets.map((r) => ({ id: r.id, filename: r.filename }));
    if (editorMode === "edit" && insertRefsViaActiveEditor(refs)) {
      setOpen(false);
      return;
    }
    onExternalContentChange(appendRefsToMarkdown(content, refs));
    toast("已追加到文末", "success");
    setOpen(false);
  };

  const download = (record: AttachmentRecord) => {
    if (!record.blob) return;
    const url = URL.createObjectURL(record.blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = record.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  /** 删除附件；cleanRef 时同步移除正文引用。
   *  编辑模式优先走编辑器节点删除（避免与防抖保存竞态），
   *  预览/源码模式经面板外部写入通道改写正文并重挂载源码视图。 */
  const doDelete = async (record: AttachmentRecord, cleanRef: boolean) => {
    if (cleanRef && referencedIds.includes(record.id)) {
      if (editorMode === "edit" && removeRefViaActiveEditor(record.id)) {
        // 编辑器 onChange → 自动保存负责落盘
      } else {
        onExternalContentChange(removeRefsFromMarkdown(content, record.id));
      }
    }
    await attachmentRepo.delete(record.id);
  };

  const cleanupUnreferenced = async () => {
    const unused = records.filter((r) => !referencedIds.includes(r.id));
    await attachmentRepo.deleteByIds(unused.map((r) => r.id));
    toast(`已清理 ${unused.length} 张未引用附件`, "success");
  };

  const saveRename = async () => {
    if (!renameTarget) return;
    const name = renameDraft.trim();
    if (name) await attachmentRepo.rename(renameTarget.id, name);
    setRenameTarget(null);
  };

  const previewSrc = preview
    ? preview.blob
      ? registerBlobUrl(preview.id, preview.blob)
      : attachmentPublicUrl(preview)
    : null;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent
        side={isMobile ? "bottom" : "right"}
        className={cn(
          "flex flex-col gap-0 p-0",
          isMobile
            ? "h-[85vh] rounded-t-xl"
            : "w-[420px] sm:max-w-[85vw] md:w-[min(420px,60vw)] md:max-w-none lg:w-[420px]"
        )}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          void handleFiles(e.dataTransfer.files);
        }}
      >
        {/* 移动端把手 */}
        {isMobile && (
          <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-muted-foreground/30" />
        )}

        <SheetHeader className="shrink-0 border-b px-4 pb-3 pt-3">
          <div className="flex items-center gap-2">
            <SheetTitle className="flex items-center gap-2 text-base">
              <Images className="h-4 w-4" />
              附件 · {records.length}
            </SheetTitle>
            <div className="flex-1" />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="附件操作">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  disabled={records.length === 0}
                  onClick={() => {
                    const withBlob = records.filter((r) => r.blob);
                    if (withBlob.length === 0) return;
                    withBlob.forEach((r) => download(r));
                  }}
                >
                  <Download className="mr-2 h-4 w-4" />
                  全部下载
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  disabled={records.length === referenced.length}
                  onClick={() => setConfirmCleanup(true)}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  清理未引用（{records.length - referenced.length}）
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </SheetHeader>

        {/* 上传条：压缩开关 + 上传按钮 */}
        <div className="flex shrink-0 items-center gap-2 border-b px-4 py-2.5">
          <MiniSwitch
            checked={compress}
            onCheckedChange={(on) => {
              setCompress(on);
              writeCompressPref(on);
            }}
            label="压缩后上传"
          />
          <span className="text-xs text-muted-foreground">
            {compress ? "压缩后上传（推荐）" : "保留原图（≤10MB）"}
          </span>
          <div className="flex-1" />
          <Button
            size="sm"
            className="h-8 gap-1.5 text-xs"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="h-3.5 w-3.5" />
            {uploading ? "上传中…" : "上传图片"}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            aria-hidden
            tabIndex={-1}
            onChange={(e) => {
              void handleFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>

        {/* 过滤 chips */}
        <div className="flex shrink-0 items-center gap-1 px-4 py-2">
          {(
            [
              ["all", `全部 ${records.length}`],
              ["used", `已引用 ${referenced.length}`],
              ["unused", `未引用 ${records.length - referenced.length}`],
            ] as Array<[FilterChip, string]>
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs transition-colors",
                filter === key
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-transparent text-muted-foreground hover:bg-accent"
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {/* 网格区 */}
        <div
          className={cn(
            "min-h-0 flex-1 overflow-y-auto px-4 pb-2",
            dragOver && "ring-2 ring-inset ring-primary/50"
          )}
        >
          {loading ? null : visible.length === 0 ? (
            <div className="flex h-full min-h-40 flex-col items-center justify-center gap-2 text-center text-muted-foreground">
              <Images className="h-8 w-8 opacity-50" />
              <p className="text-sm">
                {records.length === 0
                  ? "还没有附件，上传或拖拽图片到此处"
                  : "该过滤条件下没有附件"}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {visible.map((record) => {
                const used = referencedIds.includes(record.id);
                return (
                  <div
                    key={record.id}
                    className="group relative overflow-hidden rounded-lg border bg-muted/40"
                  >
                    <button
                      type="button"
                      aria-label={`预览 ${record.filename}`}
                      className="block aspect-square w-full cursor-zoom-in"
                      onClick={() => setPreview(record)}
                    >
                      <Thumb record={record} />
                    </button>
                    {/* 角标：原图 / 未引用 */}
                    <div className="pointer-events-none absolute left-1 top-1 flex gap-1">
                      {!record.compressed && (
                        <span
                          title="原图未压缩"
                          className="rounded bg-black/60 px-1 py-0.5 text-[10px] leading-none text-white"
                        >
                          原
                        </span>
                      )}
                      {!used && (
                        <span
                          title="未被正文引用"
                          className="rounded bg-black/60 px-1 py-0.5 text-[10px] leading-none text-white"
                        >
                          未引用
                        </span>
                      )}
                    </div>
                    {/* 卡片菜单 */}
                    <div className="absolute right-1 top-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 max-md:opacity-100">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="secondary"
                            size="icon"
                            className="h-6 w-6 bg-black/60 text-white hover:bg-black/80 hover:text-white"
                            aria-label={`${record.filename} 操作`}
                          >
                            <MoreVertical className="h-3.5 w-3.5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => insertRefs([record])}>
                            <ImagePlus className="mr-2 h-4 w-4" />
                            插入正文
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={!record.blob}
                            onClick={() => download(record)}
                          >
                            <Download className="mr-2 h-4 w-4" />
                            下载
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => {
                              setRenameTarget(record);
                              setRenameDraft(record.filename);
                            }}
                          >
                            <Pencil className="mr-2 h-4 w-4" />
                            重命名
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() =>
                              used
                                ? setConfirmReferenced(record)
                                : setConfirmSimple(record)
                            }
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            删除
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    {/* 文件名 + 大小 */}
                    <div className="border-t px-1.5 py-1">
                      <p className="truncate text-[11px]" title={record.filename}>
                        {record.filename}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        {formatBytes(record.size)} ·{" "}
                        {format(record.createdAt, "MM-dd HH:mm", { locale: zhCN })}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* 底部状态 */}
        <div className="shrink-0 border-t px-4 py-2 text-xs text-muted-foreground">
          {records.length} 张 · 共 {formatBytes(totalSize)}
          {editorMode !== "edit" && " · 插入将追加到文末"}
        </div>
      </SheetContent>

      {/* lightbox 预览 */}
      <Lightbox
        src={previewSrc}
        alt={preview?.filename}
        onClose={() => setPreview(null)}
      />

      {/* 重命名 */}
      <Sheet open={renameTarget !== null} onOpenChange={(o) => !o && setRenameTarget(null)}>
        <SheetContent side="bottom" className="mx-auto max-w-md rounded-t-xl">
          <SheetHeader>
            <SheetTitle className="text-base">重命名附件</SheetTitle>
          </SheetHeader>
          <div className="mt-3 flex gap-2">
            <Input
              autoFocus
              value={renameDraft}
              onChange={(e) => setRenameDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void saveRename();
              }}
              aria-label="附件文件名"
            />
            <Button onClick={() => void saveRename()}>保存</Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* 删除：未引用（简单确认） */}
      <ConfirmDialog
        open={confirmSimple !== null}
        title="删除这张附件？"
        description={`「${confirmSimple?.filename ?? ""}」将被永久删除，此操作无法撤销。`}
        confirmLabel="删除"
        onConfirm={() => {
          if (confirmSimple) void doDelete(confirmSimple, false);
          setConfirmSimple(null);
        }}
        onCancel={() => setConfirmSimple(null)}
      />

      {/* 删除：已被正文引用（双选） */}
      <ConfirmDialog
        open={confirmReferenced !== null}
        title="附件正被正文引用"
        description={`「${confirmReferenced?.filename ?? ""}」已插入正文。确认将同时删除附件并移除正文中的引用（正文显示为空缺）。`}
        confirmLabel="删除并移除引用"
        onConfirm={() => {
          if (confirmReferenced) void doDelete(confirmReferenced, true);
          setConfirmReferenced(null);
        }}
        onCancel={() => setConfirmReferenced(null)}
      />

      {/* 清理未引用 */}
      <ConfirmDialog
        open={confirmCleanup}
        title="清理未引用附件？"
        description={`将删除 ${records.length - referenced.length} 张未被正文引用的附件，此操作无法撤销。`}
        confirmLabel="清理"
        onConfirm={() => {
          setConfirmCleanup(false);
          void cleanupUnreferenced();
        }}
        onCancel={() => setConfirmCleanup(false)}
      />
    </Sheet>
  );
}
