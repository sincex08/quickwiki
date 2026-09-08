-- ============================================================
-- QuickWiki 云端同步 · Supabase Schema（验证阶段）
-- 在 Supabase 控制台 SQL Editor 中整体执行一次即可。
-- 设计要点：
--   * uuid 主键复用客户端本地生成的 ID（crypto.randomUUID），无映射成本
--   * updated_at 由客户端写入（Last-Write-Wins 冲突比较），服务端不覆盖
--   * deleted_at 软删除墓碑，保证删除操作可同步
--   * RLS 行级隔离：每行仅本人可见/可写
-- ============================================================

-- ---------- 表结构 ----------

create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.notebooks (
  id         uuid primary key,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  name       text not null,
  color      text not null default '#3b82f6',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.notes (
  id           uuid primary key,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  notebook_id  uuid references public.notebooks (id) on delete set null,
  title        text not null default '',
  title_manual text,
  content      text not null default '',
  tags         text[] not null default '{}',
  pinned       boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);

create index if not exists notes_user_updated_idx
  on public.notes (user_id, updated_at);
create index if not exists notebooks_user_updated_idx
  on public.notebooks (user_id, updated_at);

-- ---------- 注册时自动创建 profile ----------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id)
  values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- RLS 行级安全 ----------

alter table public.profiles  enable row level security;
alter table public.notebooks enable row level security;
alter table public.notes     enable row level security;

drop policy if exists profiles_self on public.profiles;
create policy profiles_self on public.profiles
  for all using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists notebooks_own on public.notebooks;
create policy notebooks_own on public.notebooks
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists notes_own on public.notes;
create policy notes_own on public.notes
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- 图片存储桶（note-images） ----------
-- 对象路径约定：note-images/<user_id>/<note_id>/<hash>.<ext>
-- 读公开（markdown 内直接引用），写仅限本人目录

insert into storage.buckets (id, name, public)
values ('note-images', 'note-images', true)
on conflict (id) do nothing;

drop policy if exists note_images_read on storage.objects;
create policy note_images_read on storage.objects
  for select using (bucket_id = 'note-images');

drop policy if exists note_images_write_own on storage.objects;
create policy note_images_write_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'note-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists note_images_update_own on storage.objects;
create policy note_images_update_own on storage.objects
  for update to authenticated
  using (
    bucket_id = 'note-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists note_images_delete_own on storage.objects;
create policy note_images_delete_own on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'note-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
