-- ============================================================
-- 2026-09-13 note-images 私有化迁移（存量库执行；全新安装执行
-- supabase/schema.sql 即可）。幂等：可重复执行。
--
-- 背景：
--   1. 原公开桶 + 全桶无主 select 策略 = 任何登录用户可通过 storage API
--      读取其他用户对象（公开 URL 只是其一）；
--   2. 改私有桶 + select 收紧为属主目录；客户端渲染兜底改用短时效
--      签名 URL，懒下载回填本地 blob 后不再依赖链接。
-- 存量影响：公开直链立即失效（仅是渲染兜底路径，本地已有 blob 的图不受影响）。
-- ============================================================

update storage.buckets set public = false where id = 'note-images';

drop policy if exists note_images_read on storage.objects;
create policy note_images_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'note-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
