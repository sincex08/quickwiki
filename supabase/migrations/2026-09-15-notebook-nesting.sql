-- ============================================================
-- QuickWiki 笔记本嵌套（文件夹）迁移（2026-09）
-- 在 Supabase 控制台 SQL Editor 中整体执行一次即可，可重复执行（幂等）。
--
-- 目的：
--   笔记本支持挂到另一个笔记本下（「文件夹」就是当作容器用的笔记本）。
--   新增自引用列 parent_id，on delete set null 作为服务端兜底——
--   客户端删除时会先把子笔记本上移到被删者的父级并推平，正常路径
--   不会触发该默认行为。
--
-- 说明：
--   * 同步协议（游标 / 乐观锁 / Realtime）按表与 server_updated_at 工作，
--     对新增列天然透明，无需其他改动。
--   * 层级环由客户端防止（创建/移动时沿父链检测；同步 apply 侧兜底断环）。
-- ============================================================

alter table public.notebooks
  add column if not exists parent_id uuid
  references public.notebooks (id) on delete set null;

-- 按父级查子笔记本（客户端树构建走全量，此索引主要服务后续管理查询）
create index if not exists notebooks_user_parent_idx
  on public.notebooks (user_id, parent_id);
