-- ============================================================
-- QuickWiki 云端同步 · Supabase Schema
-- 在 Supabase 控制台 SQL Editor 中整体执行一次即可。
-- 已部署旧版 schema 的存量库请按序改执行 migrations/ 下相应增量迁移
-- （2026-09-11 同步加固、2026-09-15 笔记本嵌套）。
-- 设计要点：
--   * uuid 主键复用客户端本地生成的 ID（crypto.randomUUID），无映射成本
--   * updated_at 由客户端写入（编辑时间元数据），服务端不覆盖
--   * server_updated_at 由服务端触发器写入（pull 游标 / 冲突裁决的权威时钟），
--     version 为乐观锁版本号（触发器自增），客户端传入值一律被覆盖
--   * deleted_at 软删除墓碑，保证删除操作可同步
--   * RLS 行级隔离：每行仅本人可见/可写
-- ============================================================

-- ---------- 表结构 ----------

create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.notebooks (
  id                uuid primary key,
  user_id           uuid not null references public.profiles (id) on delete cascade,
  name              text not null,
  color             text not null default '#3b82f6',
  -- 嵌套分组（「文件夹」= 当作容器用的笔记本）；客户端防环，删除时子级由客户端上移
  parent_id         uuid references public.notebooks (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  version           integer not null default 1,
  deleted_at        timestamptz
);

create table if not exists public.notes (
  id                uuid primary key,
  user_id           uuid not null references public.profiles (id) on delete cascade,
  notebook_id       uuid references public.notebooks (id) on delete set null,
  title             text not null default '',
  title_manual      text,
  content           text not null default '',
  tags              text[] not null default '{}',
  pinned            boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  version           integer not null default 1,
  deleted_at        timestamptz
);

-- 附件元数据（图片唯一来源；二进制存 note-images 桶，路径 <user_id>/<note_id>/<id>.<ext>）
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

-- ---------- 服务端维护 server_updated_at / version（客户端不可伪造） ----------

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

drop trigger if exists attachments_sync_meta on public.attachments;
create trigger attachments_sync_meta
  before insert or update on public.attachments
  for each row execute function public.touch_sync_meta();

create index if not exists notes_user_updated_idx
  on public.notes (user_id, updated_at);
create index if not exists notebooks_user_updated_idx
  on public.notebooks (user_id, updated_at);
create index if not exists notebooks_user_parent_idx
  on public.notebooks (user_id, parent_id);
create index if not exists notes_user_server_updated_idx
  on public.notes (user_id, server_updated_at);
create index if not exists notebooks_user_server_updated_idx
  on public.notebooks (user_id, server_updated_at);
create index if not exists attachments_user_server_updated_idx
  on public.attachments (user_id, server_updated_at);
create index if not exists attachments_note_idx
  on public.attachments (user_id, note_id);

-- ---------- Realtime：增量拉取与远端变更推送 ----------
do $$
begin
  alter publication supabase_realtime add table public.notes;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.notebooks;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.attachments;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

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
alter table public.attachments enable row level security;

drop policy if exists profiles_self on public.profiles;
create policy profiles_self on public.profiles
  for all using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists notebooks_own on public.notebooks;
create policy notebooks_own on public.notebooks
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists notes_own on public.notes;
create policy notes_own on public.notes
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists attachments_own on public.attachments;
create policy attachments_own on public.attachments
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- 图片存储桶（note-images） ----------
-- 对象路径约定：note-images/<user_id>/<note_id>/<attachment_id>.<ext>
-- 私有桶：读写都仅限本人目录；渲染兜底走短时效签名 URL（客户端已改造），
-- 正文懒下载回填本地 blob 后不再依赖签名链接

insert into storage.buckets (id, name, public)
values ('note-images', 'note-images', false)
on conflict (id) do update set public = false;

drop policy if exists note_images_read on storage.objects;
create policy note_images_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'note-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

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
