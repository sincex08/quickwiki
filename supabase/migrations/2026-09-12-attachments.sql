-- ============================================================
-- 2026-09-12 附件表迁移（存量库执行；全新安装直接执行 supabase/schema.sql 即可）
-- 幂等：可重复执行。
-- 内容：attachments 元数据表 + 同步触发器 + 索引 + Realtime + RLS
-- 二进制复用既有 note-images 桶，路径约定 <user_id>/<note_id>/<attachment_id>.<ext>
-- ============================================================

-- ---------- 表 ----------
create table if not exists public.attachments (
  id                uuid primary key,
  user_id           uuid not null references public.profiles (id) on delete cascade,
  note_id           uuid not null references public.notes (id) on delete cascade,
  filename          text not null default '',
  mime              text not null,
  size              bigint not null default 0,
  width             integer not null default 0,
  height            integer not null default 0,
  hash              text not null default '',
  compressed        boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  version           integer not null default 1,
  deleted_at        timestamptz
);

-- ---------- 同步触发器（server_updated_at / version，与 notes 同款） ----------
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

drop trigger if exists attachments_sync_meta on public.attachments;
create trigger attachments_sync_meta
  before insert or update on public.attachments
  for each row execute function public.touch_sync_meta();

-- ---------- 索引 ----------
create index if not exists attachments_user_server_updated_idx
  on public.attachments (user_id, server_updated_at);
create index if not exists attachments_note_idx
  on public.attachments (user_id, note_id);

-- ---------- Realtime ----------
do $$
begin
  alter publication supabase_realtime add table public.attachments;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

-- ---------- RLS ----------
alter table public.attachments enable row level security;

drop policy if exists attachments_own on public.attachments;
create policy attachments_own on public.attachments
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
