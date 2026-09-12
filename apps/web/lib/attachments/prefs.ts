/**
 * 附件上传偏好：压缩开关（默认压缩），localStorage 记忆。
 * 所有上传入口（工具栏/粘贴/拖拽/抽屉）共用同一开关值。
 */

const COMPRESS_KEY = "quickwiki.attachments.compress";

export function readCompressPref(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(COMPRESS_KEY) !== "0";
  } catch {
    return true;
  }
}

export function writeCompressPref(on: boolean): void {
  try {
    window.localStorage.setItem(COMPRESS_KEY, on ? "1" : "0");
  } catch {
    // 忽略隐私模式等存储失败
  }
}
