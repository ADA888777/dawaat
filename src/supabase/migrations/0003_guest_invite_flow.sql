-- =====================================================================
-- 0003_guest_invite_flow.sql
-- نظام المدعوين: حالة تجهيز/إرسال الدعوة + رقم التواصل للاستفسارات
-- ترحيل إضافي بالكامل: لا يحذف بيانات ولا يغيّر سلوكاً قائماً
-- طُبّق على قاعدة بيانات الإنتاج بتاريخ 2026-09-10
-- =====================================================================

-- ---------- 1) نوع حالة الإرسال ----------
do $$ begin
  create type public.invite_status as enum ('pending','prepared','sent','no_response');
exception when duplicate_object then null; end $$;

-- ---------- 2) أعمدة المدعوين ----------
alter table public.guests
  add column if not exists invite_status public.invite_status not null default 'pending';
alter table public.guests
  add column if not exists invite_prepared_at timestamptz;
alter table public.guests
  add column if not exists invite_sent_at timestamptz;

-- ---------- 3) رقم التواصل للاستفسارات ----------
alter table public.events
  add column if not exists contact_phone text;
alter table public.events
  add column if not exists contact_method text not null default 'both';

do $$ begin
  alter table public.events
    add constraint events_contact_phone_format
    check (contact_phone is null or contact_phone = '' or contact_phone ~ '^\+?[0-9]{9,15}$');
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.events
    add constraint events_contact_method_valid
    check (contact_method in ('call','whatsapp','both'));
exception when duplicate_object then null; end $$;

-- ---------- 4) صلاحيات الأعمدة الجديدة ----------
-- الصلاحيات على مستوى الأعمدة تُعاد كاملة، وإلا فشل حفظ الحقول الجديدة صامتاً
grant insert (user_id, title, category, event_date, location, description,
              cover_image, audio_file, template_id, contact_phone, contact_method)
  on table public.events to authenticated;
grant update (title, category, event_date, location, description,
              cover_image, audio_file, template_id, updated_at,
              contact_phone, contact_method)
  on table public.events to authenticated;

-- ---------- 5) تحديث العرض ليشمل الأعمدة الجديدة وعدّادات الإرسال ----------
drop view if exists public.events_with_counts;
create view public.events_with_counts
with (security_invoker = true) as
select
  e.*,
  coalesce(g.total, 0)::int        as guests_count,
  coalesce(g.attending, 0)::int    as attending_count,
  coalesce(g.declined, 0)::int     as declined_count,
  coalesce(g.maybe, 0)::int        as maybe_count,
  coalesce(g.sent, 0)::int         as sent_count,
  coalesce(g.pending_send, 0)::int as pending_send_count
from public.events e
left join (
  select event_id,
         count(*) as total,
         count(*) filter (where attendance_status = 'attending') as attending,
         count(*) filter (where attendance_status = 'declined')  as declined,
         count(*) filter (where attendance_status = 'maybe')     as maybe,
         count(*) filter (where invite_status = 'sent')          as sent,
         count(*) filter (where invite_status = 'pending')       as pending_send
  from public.guests group by event_id
) g on g.event_id = e.id;

grant select on table public.events_with_counts to authenticated;

-- ---------- 6) صفحة الدعوة العامة: رقم التواصل + الرابط ----------
drop function if exists public.get_public_invitation(text);
create function public.get_public_invitation(p_slug text)
returns table (
  title text, category public.event_category, description text,
  event_date timestamptz, location text, cover_image text, audio_file text,
  contact_phone text, contact_method text, share_slug text
)
language sql stable security definer set search_path = public
as $$
  select e.title, e.category, e.description, e.event_date, e.location,
         e.cover_image, e.audio_file,
         nullif(trim(coalesce(e.contact_phone, '')), '') as contact_phone,
         e.contact_method, e.share_slug
  from public.events e where e.share_slug = p_slug;
$$;

grant execute on function public.get_public_invitation(text) to anon, authenticated;

-- ---------- 7) تسجيل التجهيز/الإرسال دفعة واحدة (مالك المناسبة فقط) ----------
create or replace function public.mark_guests_invite_status(
  p_guest_ids bigint[], p_status public.invite_status
)
returns integer
language plpgsql security definer set search_path = public
as $$
declare v_count integer;
begin
  if p_guest_ids is null or array_length(p_guest_ids, 1) is null then
    return 0;
  end if;

  update public.guests g
     set invite_status = p_status,
         invite_prepared_at = case
           when p_status in ('prepared','sent')
           then coalesce(g.invite_prepared_at, now())
           else g.invite_prepared_at end,
         invite_sent_at = case
           when p_status = 'sent' then coalesce(g.invite_sent_at, now())
           else g.invite_sent_at end
   where g.id = any(p_guest_ids)
     and exists (
       select 1 from public.events e
        where e.id = g.event_id and e.user_id = auth.uid()
     );

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.mark_guests_invite_status(bigint[], public.invite_status) from anon;
grant execute on function public.mark_guests_invite_status(bigint[], public.invite_status) to authenticated;

-- ---------- 8) رد المدعو يثبّت أن الدعوة وصلت فعلاً ----------
create or replace function public.submit_rsvp_by_token(
  p_token uuid, p_status public.attendance_status
)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if p_status = 'pending' then
    raise exception 'قيمة رد غير صالحة';
  end if;

  update public.guests
     set attendance_status = p_status,
         invite_status = case
           when invite_status in ('pending','prepared')
           then 'sent'::public.invite_status
           else invite_status end,
         invite_sent_at = coalesce(invite_sent_at, now())
   where invite_token = p_token;

  if not found then
    raise exception 'رابط الدعوة غير صالح';
  end if;
end;
$$;

grant execute on function public.submit_rsvp_by_token(uuid, public.attendance_status) to anon, authenticated;
