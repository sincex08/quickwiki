-- ============================================================
-- 2026-10-01 · attachments 归属一致性校验
--
-- 背景：attachments 的 RLS 策略只校验 user_id = auth.uid()，不校验
-- note_id 指向的笔记是否属于同一用户。恶意客户端可插入 user_id 为自己、
-- note_id 指向他人笔记的行（无越权读取），但对方删除笔记时 FK
-- on delete cascade 会连带删掉该行并触发其 Storage 清理——低危的
-- 数据完整性 / 资源干扰问题。此处加触发器封堵。
--
-- privacy 含义：attachments.note_id 必须指向「同一用户」的现存笔记。
-- 使用 SECURITY DEFINER 以便在校验时读取 notes（notes 有 RLS，但校验
-- 发生在写入者上下文中，需绕过 RLS 才能正确判断归属）。
-- ============================================================

create or replace function public.assert_attachment_note_owner()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  note_owner uuid;
begin
  select user_id into note_owner
  from public.notes
  where id = new.note_id;

  -- 笔记不存在（尚未同步到服务端 / 已被硬删）：放行，由客户端同步顺序收敛。
  -- 存在则必须归属同一用户，否则拒绝。
  if note_owner is not null and note_owner <> new.user_id then
    raise exception 'attachment.note_id 归属不一致（note 属于其他用户）'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists attachments_note_owner_check on public.attachments;
create trigger attachments_note_owner_check
  before insert or update of note_id, user_id on public.attachments
  for each row execute function public.assert_attachment_note_owner();
