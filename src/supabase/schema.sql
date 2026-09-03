-- =====================================================================
-- منصة "دعوات" — مخطط قاعدة بيانات Supabase الكامل + RLS + Storage
-- يُنفَّذ مرة واحدة على مشروع جديد (idempotent)
--
-- لقاعدة بيانات موجودة مسبقاً استخدم بدلاً من هذا:
--   supabase/migrations/0001_security_and_integrity_fixes.sql
--
-- مبادئ أمنية مطبّقة هنا:
--   • الدور 'user' يُفرض في التريجر ولا يُقرأ أبداً من metadata المستخدم
--   • share_slug و invite_token يُولَّدان في قاعدة البيانات لا في المتصفح
--   • كل سياسات RLS تلفّ auth.uid()/is_admin() بـ (select ...) لأداء InitPlan
--   • unique(event_id, phone) يجعل تسجيل الردود ذرّياً وصحيحاً
-- =====================================================================

-- ---------- الأنواع ----------
do $$ begin
  create type public.event_category as enum ('wedding','engagement','birthday','graduation','meeting','general');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.attendance_status as enum ('pending','attending','maybe','declined');
exception when duplicate_object then null; end $$;

-- ---------- الجداول ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default 'مستخدم',
  email text not null default '',
  role text not null default 'user' check (role in ('user','admin')),
  plan text not null default 'free' check (plan in ('free','paid')),
  events_limit integer default 1,          -- الباقة المجانية = مناسبة واحدة
  plan_start_date timestamptz default now(),
  plan_end_date timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.templates (
  id bigint generated always as identity primary key,
  name text not null,
  category public.event_category not null,
  preview_image text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.events (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  category public.event_category not null,
  event_date timestamptz not null,
  location text not null,
  description text not null default '',
  cover_image text,
  audio_file text,
  template_id bigint references public.templates(id) on delete set null,
  -- 9 بايت عشوائية = 72 بت إنتروبيا، غير قابلة للتخمين
  share_slug text not null unique default encode(gen_random_bytes(9), 'hex'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.guests (
  id bigint generated always as identity primary key,
  event_id bigint not null references public.events(id) on delete cascade,
  name text not null,
  phone text not null,
  attendance_status public.attendance_status not null default 'pending',
  -- رمز الدعوة الشخصي: يُرسل في الرابط بدل الاسم والجوال
  invite_token uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  -- يمنع التكرار ويجعل upsert الردود ذرّياً
  constraint guests_event_phone_unique unique (event_id, phone)
);

create index if not exists guests_event_id_idx on public.guests(event_id);
create unique index if not exists guests_invite_token_idx on public.guests(invite_token);
create index if not exists events_user_id_idx on public.events(user_id);
-- يدعم exists(...) داخل سياسات guests
create index if not exists events_id_user_idx on public.events(id, user_id);

-- ---------- دوال مساعدة ----------
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists events_touch_updated_at on public.events;
create trigger events_touch_updated_at
  before update on public.events
  for each row execute function public.touch_updated_at();

-- إنشاء صف المستخدم تلقائياً عند التسجيل — الدور ثابت 'user' دائماً
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, name, email, role, plan)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'), ''), new.email, 'مستخدم'),
    coalesce(new.email, ''),
    'user', 'free'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- منع غير الأدمن من تعديل الدور/الباقة/الحد
create or replace function public.protect_profile_columns()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  -- استثناءان فقط:
  --  1) دالة موثوقة داخل قاعدة البيانات ضبطت العلم (admin_set_plan)
  --  2) طلب من الخادم بمفتاح service_role — لا جلسة مستخدم فيه.
  --     هذا آمن لأن سياسة RLS على profiles لا تسمح أصلاً لـ anon
  --     بالتحديث، فالحالة الوحيدة التي يكون فيها auth.uid() فارغاً
  --     هي استدعاء خلفي موثوق. وبدون هذا الاستثناء يستحيل تعيين
  --     أول أدمن أو إدارة الباقات من الخادم.
  if coalesce(current_setting('app.trusted_plan_change', true), '') <> 'on'
     and auth.uid() is not null
     and not public.is_admin() then
    if new.role is distinct from old.role
       or new.plan is distinct from old.plan
       or new.events_limit is distinct from old.events_limit
       or new.plan_start_date is distinct from old.plan_start_date
       or new.plan_end_date is distinct from old.plan_end_date then
      raise exception 'غير مصرح بتعديل بيانات الباقة أو الصلاحية';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists protect_profile_columns on public.profiles;
create trigger protect_profile_columns
  before update on public.profiles
  for each row execute function public.protect_profile_columns();

-- فرض حد الباقة عند الإنشاء — مع قفل الصف لمنع السباق الزمني
create or replace function public.enforce_events_limit()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_limit integer;
  v_role  text;
  v_count integer;
begin
  select events_limit, role into v_limit, v_role
    from public.profiles where id = new.user_id for update;

  -- الإدارة لا تخضع لأي حد
  if v_role = 'admin' then
    return new;
  end if;

  if v_limit is not null then
    select count(*) into v_count from public.events where user_id = new.user_id;
    if v_count >= v_limit then
      -- رمز موحّد يقرأه العميل ليبني رسالة بالحد الفعلي
      raise exception 'EVENTS_LIMIT_REACHED:%', v_limit;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_events_limit on public.events;
create trigger enforce_events_limit
  before insert on public.events
  for each row execute function public.enforce_events_limit();

-- ---------- عرض المناسبات مع الإحصائيات ----------
drop view if exists public.events_with_counts;
create view public.events_with_counts
with (security_invoker = true) as
select
  e.*,
  coalesce(g.total, 0)::int      as guests_count,
  coalesce(g.attending, 0)::int  as attending_count,
  coalesce(g.declined, 0)::int   as declined_count,
  coalesce(g.maybe, 0)::int      as maybe_count
from public.events e
left join (
  select event_id,
         count(*) as total,
         count(*) filter (where attendance_status = 'attending') as attending,
         count(*) filter (where attendance_status = 'declined')  as declined,
         count(*) filter (where attendance_status = 'maybe')     as maybe
  from public.guests group by event_id
) g on g.event_id = e.id;

-- ---------- RLS ----------
alter table public.profiles enable row level security;
alter table public.templates enable row level security;
alter table public.events enable row level security;
alter table public.guests enable row level security;

-- profiles
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select using (id = (select auth.uid()) or (select public.is_admin()));

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update using (id = (select auth.uid()) or (select public.is_admin()))
  with check (id = (select auth.uid()) or (select public.is_admin()));

-- templates: القراءة للفعّالة للجميع (حتى الزوار)، الإدارة للأدمن
drop policy if exists "templates_select" on public.templates;
create policy "templates_select" on public.templates
  for select using (active = true or (select public.is_admin()));

drop policy if exists "templates_admin_insert" on public.templates;
create policy "templates_admin_insert" on public.templates
  for insert with check ((select public.is_admin()));

drop policy if exists "templates_admin_update" on public.templates;
create policy "templates_admin_update" on public.templates
  for update using ((select public.is_admin()))
  with check ((select public.is_admin()));

drop policy if exists "templates_admin_delete" on public.templates;
create policy "templates_admin_delete" on public.templates
  for delete using ((select public.is_admin()));

-- events: المالك + الأدمن
drop policy if exists "events_select_own" on public.events;
create policy "events_select_own" on public.events
  for select using (user_id = (select auth.uid()) or (select public.is_admin()));

drop policy if exists "events_insert_own" on public.events;
create policy "events_insert_own" on public.events
  for insert with check (user_id = (select auth.uid()));

drop policy if exists "events_update_own" on public.events;
create policy "events_update_own" on public.events
  for update using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "events_delete_own" on public.events;
create policy "events_delete_own" on public.events
  for delete using (user_id = (select auth.uid()) or (select public.is_admin()));

-- منح صريح بدل الاعتماد على الصلاحيات الافتراضية للمشروع
grant select on table public.templates to anon, authenticated;
grant select, insert, update, delete on table public.templates to authenticated;
grant select, update on table public.profiles to authenticated;
grant select, insert, update, delete on table public.guests to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- صلاحيات على مستوى الأعمدة: العميل لا يستطيع تعيين share_slug
revoke insert, update on table public.events from authenticated;
grant insert (user_id, title, category, event_date, location, description,
              cover_image, audio_file, template_id)
  on table public.events to authenticated;
grant update (title, category, event_date, location, description,
              cover_image, audio_file, template_id, updated_at)
  on table public.events to authenticated;
grant select, delete on table public.events to authenticated;

-- guests: مالك المناسبة + الأدمن (الزوار عبر RPC فقط)
drop policy if exists "guests_select_owner" on public.guests;
create policy "guests_select_owner" on public.guests
  for select using (
    exists (select 1 from public.events e where e.id = event_id and e.user_id = (select auth.uid()))
    or (select public.is_admin())
  );

drop policy if exists "guests_insert_owner" on public.guests;
create policy "guests_insert_owner" on public.guests
  for insert with check (
    exists (select 1 from public.events e where e.id = event_id and e.user_id = (select auth.uid()))
  );

drop policy if exists "guests_update_owner" on public.guests;
create policy "guests_update_owner" on public.guests
  for update using (
    exists (select 1 from public.events e where e.id = event_id and e.user_id = (select auth.uid()))
  )
  with check (
    exists (select 1 from public.events e where e.id = event_id and e.user_id = (select auth.uid()))
  );

drop policy if exists "guests_delete_owner" on public.guests;
create policy "guests_delete_owner" on public.guests
  for delete using (
    exists (select 1 from public.events e where e.id = event_id and e.user_id = (select auth.uid()))
  );

-- ---------- دوال عامة (صفحة الدعوة + RSVP) ----------
-- قراءة الدعوة عبر الرابط العام دون كشف بقية البيانات
create or replace function public.get_public_invitation(p_slug text)
returns table (
  title text, category public.event_category, description text,
  event_date timestamptz, location text, cover_image text, audio_file text
)
language sql stable security definer set search_path = public
as $$
  select e.title, e.category, e.description, e.event_date, e.location, e.cover_image, e.audio_file
  from public.events e where e.share_slug = p_slug;
$$;

-- الرد العام (نموذج الاسم والجوال) — محصّن بالتحقق وسقف عدد الردود
create or replace function public.submit_rsvp(
  p_slug text, p_name text, p_phone text, p_status public.attendance_status
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_event_id bigint;
  v_name  text := trim(coalesce(p_name, ''));
  v_phone text := regexp_replace(coalesce(p_phone, ''), '[\s\-()]', '', 'g');
begin
  if v_name = '' or v_phone = '' then
    raise exception 'الاسم ورقم الجوال مطلوبان';
  end if;
  if length(v_name) > 100 then
    raise exception 'الاسم طويل جداً';
  end if;
  if v_phone !~ '^\+?[0-9]{9,15}$' then
    raise exception 'رقم الجوال غير صالح';
  end if;
  if p_status = 'pending' then
    raise exception 'قيمة رد غير صالحة';
  end if;

  select id into v_event_id from public.events where share_slug = p_slug;
  if v_event_id is null then
    raise exception 'الدعوة غير موجودة';
  end if;

  -- سقف يمنع إغراق قاعدة البيانات من زائر مجهول
  if (select count(*) from public.guests where event_id = v_event_id) >= 1000 then
    raise exception 'تم بلوغ الحد الأقصى للردود في هذه المناسبة';
  end if;

  -- upsert ذرّي بفضل قيد unique(event_id, phone)
  insert into public.guests (event_id, name, phone, attendance_status)
  values (v_event_id, v_name, v_phone, p_status)
  on conflict (event_id, phone)
  do update set name = excluded.name,
                attendance_status = excluded.attendance_status;
end;
$$;

-- الرد بالرمز الشخصي — لا يمر أي بيان شخصي عبر الرابط
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

  update public.guests set attendance_status = p_status
   where invite_token = p_token;

  if not found then
    raise exception 'رابط الدعوة غير صالح';
  end if;
end;
$$;

-- قراءة اسم المدعو من الرمز لعرض "مرحباً فلان" دون كشف الجوال
create or replace function public.get_guest_by_token(p_token uuid)
returns table (name text, attendance_status public.attendance_status)
language sql stable security definer set search_path = public
as $$
  select g.name, g.attendance_status
    from public.guests g
   where g.invite_token = p_token;
$$;

-- ═══ الاشتراك ═══
-- بوابة الدفع غير جاهزة. الدالة القديمة كانت تمنح الباقة المدفوعة فوراً
-- بلا أي دفع، فأي مستخدم يستدعيها من API يحصل على مناسبات غير محدودة
-- مجاناً. أُوقفت حتى ربطها ببوابة دفع حقيقية.
create or replace function public.upgrade_my_subscription()
returns void
language plpgsql security definer set search_path = public
as $$
begin
  raise exception 'PAYMENT_NOT_AVAILABLE';
end;
$$;

-- بديل مؤقت: الأدمن يمنح الباقة يدوياً
create or replace function public.admin_set_plan(
  p_user_id uuid, p_plan text, p_months integer default 12
)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'هذه العملية متاحة للإدارة فقط';
  end if;
  if p_plan not in ('free', 'paid') then
    raise exception 'قيمة باقة غير صالحة';
  end if;

  perform set_config('app.trusted_plan_change', 'on', true);
  update public.profiles
     set plan            = p_plan,
         events_limit    = case when p_plan = 'paid' then null else 1 end,
         plan_start_date = case when p_plan = 'paid' then now() else null end,
         plan_end_date   = case when p_plan = 'paid'
                                then now() + make_interval(months => p_months) else null end
   where id = p_user_id;
  perform set_config('app.trusted_plan_change', 'off', true);
end;
$$;

grant execute on function public.get_public_invitation(text) to anon, authenticated;
grant execute on function public.submit_rsvp(text, text, text, public.attendance_status) to anon, authenticated;
grant execute on function public.submit_rsvp_by_token(uuid, public.attendance_status) to anon, authenticated;
grant execute on function public.get_guest_by_token(uuid) to anon, authenticated;
revoke execute on function public.upgrade_my_subscription() from anon, authenticated;
grant  execute on function public.admin_set_plan(uuid, text, integer) to authenticated;
revoke execute on function public.admin_set_plan(uuid, text, integer) from anon;
-- دوال التريجر لا تُستدعى من العميل
revoke execute on function public.handle_new_user() from anon, authenticated;
revoke execute on function public.protect_profile_columns() from anon, authenticated;
revoke execute on function public.enforce_events_limit() from anon, authenticated;
revoke execute on function public.touch_updated_at() from anon, authenticated;

-- ---------- التخزين: Buckets + سياسات ----------
-- الـ Buckets تُنشأ هنا لا يدوياً، وإلا فشل الرفع صامتاً على أي مشروع جديد
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('event-images',    'event-images',    true,  5242880,
     array['image/jpeg','image/png','image/webp','image/gif']),
  ('event-audios',    'event-audios',    true, 15728640,
     array['audio/mpeg','audio/mp4','audio/wav','audio/ogg','audio/webm','audio/aac','audio/x-m4a']),
  ('event-files',     'event-files',     false, 10485760, null),
  ('template-images', 'template-images', true,  5242880,
     array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- قراءة عامة للوسائط المعروضة داخل الدعوات (كانت مفقودة تماماً)
drop policy if exists "media_public_read" on storage.objects;
create policy "media_public_read" on storage.objects
  for select using (bucket_id in ('event-images','event-audios','template-images'));

drop policy if exists "media_upload_own_folder" on storage.objects;
create policy "media_upload_own_folder" on storage.objects
  for insert to authenticated
  with check (
    bucket_id in ('event-images','event-audios')
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- سياسة التعديل كانت مفقودة — استبدال ملف مرفوع كان يفشل
drop policy if exists "media_update_own" on storage.objects;
create policy "media_update_own" on storage.objects
  for update to authenticated
  using (
    bucket_id in ('event-images','event-audios')
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id in ('event-images','event-audios')
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "media_delete_own" on storage.objects;
create policy "media_delete_own" on storage.objects
  for delete to authenticated
  using (
    bucket_id in ('event-images','event-audios')
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- event-files: خاص بالكامل — المالك فقط قراءةً وكتابة
drop policy if exists "event_files_owner_all" on storage.objects;
create policy "event_files_owner_all" on storage.objects
  for all to authenticated
  using (
    bucket_id = 'event-files'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'event-files'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "template_images_admin" on storage.objects;
create policy "template_images_admin" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'template-images' and (select public.is_admin()));

drop policy if exists "template_images_admin_modify" on storage.objects;
create policy "template_images_admin_modify" on storage.objects
  for update to authenticated
  using (bucket_id = 'template-images' and (select public.is_admin()))
  with check (bucket_id = 'template-images' and (select public.is_admin()));

drop policy if exists "template_images_admin_delete" on storage.objects;
create policy "template_images_admin_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'template-images' and (select public.is_admin()));

-- ---------- زرع القوالب ----------
insert into public.templates (name, category, preview_image, active)
select v.name, v.category::public.event_category, v.preview_image, true
from (values
  ('ليلة العمر الذهبية', 'wedding',    '/templates/template-wedding.png'),
  ('وعد الماس',          'engagement', '/templates/template-engagement.png'),
  ('فرحة التخرج',        'graduation', '/templates/template-graduation.png'),
  ('سنة حلوة',           'birthday',   '/templates/template-birthday.png'),
  ('لقاء الأعمال',       'meeting',    '/templates/template-meeting.png'),
  ('الديوان الملكي',     'general',    '/templates/template-general.png')
) as v(name, category, preview_image)
where not exists (select 1 from public.templates);
