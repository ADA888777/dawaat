-- =====================================================================
-- 0008 — لوحة الأدمن الكاملة
--
-- 1) الإعلانات: تاريخ بداية/نهاية، أولوية، والفئة المستهدفة — مع فرض الظهور
--    في سياسة RLS نفسها (لا يعتمد على الواجهة).
-- 2) مفاتيح تفعيل/تعطيل الميزات في app_settings (يعدّلها الأدمن فقط).
-- 3) دالة admin_set_free_limit: كانت تُستدعى من الواجهة دون ملف إنشاء في
--    المستودع — تُعرَّف هنا بتحقق من صلاحية الأدمن.
--
-- آمن لإعادة التنفيذ: لا يحذف بيانات ولا سياسات.
-- =====================================================================

-- ---------- 1) الإعلانات: الجدولة والأولوية والفئة ----------
alter table public.announcements
  add column if not exists starts_at timestamptz,
  add column if not exists ends_at   timestamptz,
  -- all: الجميع | visitors: الزوار غير المسجلين | users: المسجلون
  -- free: أصحاب الباقة المجانية | paid: أصحاب الباقة المدفوعة
  add column if not exists audience  text not null default 'all';

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.announcements'::regclass
                    and conname = 'announcements_audience_chk') then
    alter table public.announcements
      add constraint announcements_audience_chk
      check (audience in ('all','visitors','users','free','paid'));
  end if;
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.announcements'::regclass
                    and conname = 'announcements_dates_chk') then
    alter table public.announcements
      add constraint announcements_dates_chk
      check (starts_at is null or ends_at is null or ends_at >= starts_at);
  end if;
end $$;

comment on column public.announcements.sort_order is 'الأولوية: الأصغر يظهر أولاً';
comment on column public.announcements.audience is 'الفئة المستهدفة: all/visitors/users/free/paid';

-- هل يرى المستخدم الحالي هذا الإعلان؟ (نشط + ضمن المدة + ضمن الفئة)
create or replace function public.announcement_visible(
  p_active boolean, p_starts_at timestamptz, p_ends_at timestamptz, p_audience text
)
returns boolean
language sql stable security definer set search_path = public
as $$
  select p_active
     and (p_starts_at is null or p_starts_at <= now())
     and (p_ends_at   is null or p_ends_at   >= now())
     and case coalesce(p_audience, 'all')
           when 'all'      then true
           when 'visitors' then auth.uid() is null
           when 'users'    then auth.uid() is not null
           when 'free'     then exists (select 1 from public.profiles
                                         where id = auth.uid() and plan = 'free')
           when 'paid'     then exists (select 1 from public.profiles
                                         where id = auth.uid() and plan = 'paid')
           else false
         end;
$$;

grant execute on function public.announcement_visible(boolean, timestamptz, timestamptz, text)
  to anon, authenticated;

-- سياسة القراءة: الظاهر للفئة الحالية فقط، والأدمن يرى الكل
drop policy if exists announcements_read on public.announcements;
create policy announcements_read on public.announcements
  for select using (
    public.announcement_visible(active, starts_at, ends_at, audience)
    or (select public.is_admin())
  );

-- ---------- 2) مفاتيح الميزات ----------
alter table public.app_settings
  add column if not exists feature_flags jsonb not null default '{}'::jsonb;

comment on column public.app_settings.feature_flags is
  'تفعيل/تعطيل ميزات الواجهة: contacts_import, qr_code, whatsapp_send, subscription_page, announcements_bar';

-- ---------- 3) حد الباقة المجانية (أدمن فقط) ----------
create or replace function public.admin_set_free_limit(
  p_limit integer, p_apply_existing boolean default false
)
returns integer
language plpgsql security definer set search_path = public
as $$
declare v_count integer := 0;
begin
  if not public.is_admin() then
    raise exception 'ADMIN_ONLY';
  end if;
  if p_limit is null or p_limit < 0 or p_limit > 1000 then
    raise exception 'INVALID_LIMIT';
  end if;

  update public.app_settings set free_events_limit = p_limit, updated_at = now()
   where id = true;

  if p_apply_existing then
    -- التريجر protect_profile_columns يسمح للأدمن بتعديل الحدود
    update public.profiles set events_limit = p_limit where plan = 'free';
    get diagnostics v_count = row_count;
  end if;

  return v_count;
end;
$$;

revoke execute on function public.admin_set_free_limit(integer, boolean) from anon;
grant execute on function public.admin_set_free_limit(integer, boolean) to authenticated;
