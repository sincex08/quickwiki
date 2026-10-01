-- ============================================================
-- 2026-10-01 · 笔记软删级联附件墓碑
--
-- 背景：notes 是软删除（deleted_at 墓碑），attachments 的
-- on delete cascade 只在硬删时生效。此前笔记删除后其附件行只在
-- 「发起删除的那台设备」上由客户端入队推平——该设备离线或清数据时，
-- 所有设备都会拉到仍存活的附件行（note_id 指向已删笔记），成为
-- 永久孤儿，Storage 文件也无人清理。
--
-- 本迁移：笔记 deleted_at 从 NULL 变为非 NULL 时，触发器把该笔记的
-- 附件行一并打上相同时间的墓碑（touch_sync_meta 随之推进
-- server_updated_at，各端经附件 pull 自然收敛）；Storage 文件由客户端
-- 在 pull 到附件墓碑时兜底清理（幂等 remove）。
--
-- 复活对称性：客户端「本地编辑比删除意图新 → 复活笔记」会写
-- deleted_at = null。级联墓碑的 deleted_at 恰好等于笔记当时的
-- deleted_at 值，复活分支据此精确撤回这批墓碑；期间被其它设备
-- 真删的附件（时间戳不同）不受影响。
-- ============================================================

create or replace function public.tombstone_attachments_on_note_delete()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if old.deleted_at is null and new.deleted_at is not null then
    -- 软删：级联附件墓碑（与笔记同时间戳，复活分支据此识别）
    update public.attachments
       set deleted_at = new.deleted_at
     where note_id = new.id
       and deleted_at is null;
  elsif old.deleted_at is not null and new.deleted_at is null then
    -- 复活：仅撤回由级联打上的墓碑（deleted_at 等于笔记旧墓碑时间）；
    -- 期间其它设备真删的附件保持删除
    update public.attachments
       set deleted_at = null
     where note_id = new.id
       and deleted_at = old.deleted_at;
  end if;
  return new;
end;
$$;

drop trigger if exists notes_soft_delete_cascade_attachments on public.notes;
create trigger notes_soft_delete_cascade_attachments
  after update of deleted_at on public.notes
  for each row execute function public.tombstone_attachments_on_note_delete();

-- ------------------------------------------------------------
-- 一次性回填：把历史上已软删笔记下仍存活的附件行补打墓碑。
-- 每行的 updated_at / server_updated_at / version 由 touch_sync_meta
-- 触发器推进，各端下一轮 pull 即可拉到墓碑并清理。
-- ------------------------------------------------------------
update public.attachments a
   set deleted_at = n.deleted_at
  from public.notes n
 where a.note_id = n.id
   and n.deleted_at is not null
   and a.deleted_at is null;
