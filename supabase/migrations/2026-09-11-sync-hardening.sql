-- ============================================================
-- QuickWiki 云同步加固迁移（2026-09）
-- 在 Supabase 控制台 SQL Editor 中整体执行一次即可，可重复执行（幂等）。
--
-- 目的：
--   1. 服务端权威时间戳 server_updated_at（触发器写入，客户端不可伪造），
--      pull 游标改用它 → 彻底消除设备时钟偏差导致的增量漏拉。
--   2. 乐观锁版本号 version（触发器自增）→ push 条件更新不再依赖客户端时钟，
--      写冲突可被准确检测，删除操作也纳入同一裁决机制。
--   3. 把 notes / notebooks 加入 supabase_realtime publication，
--      供客户端 Realtime 订阅远端变更。
-- ============================================================

-- ---------- 1. 新列 ----------
alter table public.notes
  add column if not exists server_updated_at timestamptz;
alter table public.notebooks
  add column if not exists server_updated_at timestamptz;
alter table public.notes
  add column if not exists version integer not null default 1;
alter table public.notebooks
  add column if not exists version integer not null default 1;

-- 存量行 backfill：以原 updated_at（写入设备时钟）近似排序，随后收紧为 not null
update public.notes
  set server_updated_at = coalesce(updated_at, created_at, now())
  where server_updated_at is null;
update public.notebooks
  set server_updated_at = coalesce(updated_at, created_at, now())
  where server_updated_at is null;
alter table public.notes alter column server_updated_at set not null;
alter table public.notebooks alter column server_updated_at set not null;

-- ---------- 2. 触发器：server_updated_at / version 由服务端维护 ----------
-- 客户端传入的 server_updated_at / version 一律被覆盖。
-- version：insert → 1；update → 旧值 + 1。
create or replace function public.touch_sync_meta()
returns trigger
language plpgsql
as $$
begin
  new.server_updated_at := now();
  new.version := coalesce(old.version, 0) + 1;
  return new;
end;
$$;

drop trigger if exists notes_sync_meta on public.notes;
create trigger notes_sync_meta
  before insert or update on public.notes
  for each row execute function public.touch_sync_meta();

drop trigger if exists notebooks_sync_meta on public.notebooks;
create trigger notebooks_sync_meta
  before insert or update on public.notebooks
  for each row execute function public.touch_sync_meta();

-- ---------- 3. 增量拉取索引 ----------
create index if not exists notes_user_server_updated_idx
  on public.notes (user_id, server_updated_at);
create index if not exists notebooks_user_server_updated_idx
  on public.notebooks (user_id, server_updated_at);

-- ---------- 4. Realtime：两表加入 supabase_realtime publication ----------
do $$
begin
  alter publication supabase_realtime add table public.notes;
exception
  when duplicate_object then null;  -- 已在 publication 中
  when undefined_object then null;  -- publication 不存在（异常环境，忽略）
end $$;

do $$
begin
  alter publication supabase_realtime add table public.notebooks;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
