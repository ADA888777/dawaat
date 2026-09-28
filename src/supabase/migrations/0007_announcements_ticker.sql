-- =====================================================================
-- 0007 — شريط الإعلانات المتحرك
--
-- الأدمن يضيف عدة إعلانات ويرتّبها ويفعّل/يعطّل كل واحد، ويتحكم في إظهار
-- الشريط كله وسرعة حركته من الإعدادات. الزوار والمستخدمون يقرؤون الإعلانات
-- النشطة فقط؛ الأدمن يرى الكل ويعدّل.
--
-- آمن لإعادة التنفيذ: لا يحذف بيانات ولا سياسات.
-- =====================================================================

-- ---------- 1) الإعدادات: إظهار الشريط وسرعته ----------
alter table public.app_settings
  add column if not exists ticker_enabled boolean not null default true,
  -- السرعة بالبكسل في الثانية (30 بطيء، 60 متوسط، 100 سريع)
  add column if not exists ticker_speed   integer not null default 60;

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.app_settings'::regclass
                    and conname = 'app_settings_ticker_speed_chk') then
    alter table public.app_settings
      add constraint app_settings_ticker_speed_chk
      check (ticker_speed >= 10 and ticker_speed <= 300);
  end if;
end $$;

-- ---------- 2) جدول الإعلانات ----------
create table if not exists public.announcements (
  id         bigint generated always as identity primary key,
  text       text    not null check (char_length(btrim(text)) between 1 and 200),
  -- رابط اختياري يُفتح عند الضغط على الإعلان
  link       text    not null default '' check (char_length(link) <= 500),
  active     boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists announcements_order_idx
  on public.announcements(active, sort_order, id);

-- دالة تحديث updated_at (تُعرَّف هنا أيضاً لأن المشروع الحي قد لا يحويها)
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists announcements_touch on public.announcements;
create trigger announcements_touch
  before update on public.announcements
  for each row execute function public.touch_updated_at();

comment on table public.announcements is
  'إعلانات شريط الإعلانات المتحرك — النشط منها يظهر للجميع، ويديرها الأدمن';

-- ---------- 3) RLS ----------
alter table public.announcements enable row level security;

drop policy if exists announcements_read on public.announcements;
create policy announcements_read on public.announcements
  for select using (active = true or (select public.is_admin()));

drop policy if exists announcements_admin_insert on public.announcements;
create policy announcements_admin_insert on public.announcements
  for insert with check ((select public.is_admin()));

drop policy if exists announcements_admin_update on public.announcements;
create policy announcements_admin_update on public.announcements
  for update using ((select public.is_admin()))
  with check ((select public.is_admin()));

drop policy if exists announcements_admin_delete on public.announcements;
create policy announcements_admin_delete on public.announcements
  for delete using ((select public.is_admin()));

grant select on table public.announcements to anon, authenticated;
grant insert, update, delete on table public.announcements to authenticated;
