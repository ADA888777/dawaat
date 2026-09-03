-- =====================================================================
--  هجرة الإصلاحات الأمنية وسلامة البيانات
--  تُنفَّذ مرة واحدة على قاعدة البيانات الحالية (idempotent)
--
--  Supabase Dashboard → SQL Editor → New query → الصق → Run
--
--  تغطي: ح-1، ح-2، ح-3، ع-1، ع-2، ع-3، ع-5، ع-6
--  ملاحظة: ملف supabase/schema.sql حُدِّث أيضاً ليعكس نفس النتيجة
--          لأي مشروع Supabase جديد يُنشأ من الصفر.
-- =====================================================================

begin;

-- =====================================================================
-- [ح-3] منع تكرار المدعوين — القيد الذي تفترضه submit_rsvp ولا وجود له
-- =====================================================================

-- 1) تنظيف التكرار الموجود: نُبقي الأقدم، ونرحّل أي رد فعلي إليه
update public.guests keep
   set attendance_status = dup.attendance_status
  from (
    select distinct on (event_id, phone) event_id, phone, attendance_status, id
      from public.guests
     where attendance_status <> 'pending'
     order by event_id, phone, created_at desc
  ) dup
 where keep.event_id = dup.event_id
   and keep.phone = dup.phone
   and keep.attendance_status = 'pending';

delete from public.guests g
 using public.guests g2
 where g.event_id = g2.event_id
   and g.phone = g2.phone
   and g.id > g2.id;

-- 2) امنع تكراره مستقبلاً
alter table public.guests drop constraint if exists guests_event_phone_unique;
alter table public.guests add constraint guests_event_phone_unique
  unique (event_id, phone);


-- =====================================================================
-- [ح-2] رمز دعوة لكل مدعو — بديل إرسال الجوال داخل الرابط
-- =====================================================================
alter table public.guests
  add column if not exists invite_token uuid not null default gen_random_uuid();

create unique index if not exists guests_invite_token_idx
  on public.guests (invite_token);


-- =====================================================================
-- [ع-5] توحيد حد الباقة المجانية في مصدر واحد = 3
-- =====================================================================
alter table public.profiles alter column events_limit set default 3;

-- صحّح الحسابات المجانية التي أُنشئت بقيمة 1 قبل التوحيد.
-- تريجر protect_profile_columns يمنع تعديل events_limit عمداً (وهذا صحيح)،
-- لذا نعطّله لهذه العبارة فقط ثم نعيده فوراً.
alter table public.profiles disable trigger protect_profile_columns;
update public.profiles set events_limit = 3
 where plan = 'free' and events_limit is distinct from 3;
alter table public.profiles enable trigger protect_profile_columns;

-- التريجر لم يعد يحدد القيمة يدوياً — يعتمد على default الجدول
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
    'user', 'free'   -- الدور ثابت دائماً: لا يُقرأ من metadata المستخدم
  )
  on conflict (id) do nothing;
  return new;
end;
$$;


-- =====================================================================
-- [ع-6] إغلاق السباق الزمني في فرض حد الباقة (TOCTOU)
-- =====================================================================
create or replace function public.enforce_events_limit()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_limit integer;
  v_count integer;
begin
  -- for update يقفل صف المستخدم، فلا يمر طلبان متزامنان بنفس العدّ
  select events_limit into v_limit
    from public.profiles where id = new.user_id for update;

  if v_limit is not null then
    select count(*) into v_count from public.events where user_id = new.user_id;
    if v_count >= v_limit then
      raise exception 'EVENTS_LIMIT_REACHED:%', v_limit;
    end if;
  end if;
  return new;
end;
$$;


-- =====================================================================
-- [ع-2] توليد share_slug داخل قاعدة البيانات لا في المتصفح
-- =====================================================================
alter table public.events
  alter column share_slug set default encode(gen_random_bytes(9), 'hex');

-- امنع العميل من التحكم في share_slug عبر صلاحيات على مستوى الأعمدة
revoke insert, update on table public.events from authenticated;
grant insert (user_id, title, category, event_date, location, description,
              cover_image, audio_file, template_id)
  on table public.events to authenticated;
grant update (title, category, event_date, location, description,
              cover_image, audio_file, template_id, updated_at)
  on table public.events to authenticated;
grant select, delete on table public.events to authenticated;

-- updated_at يُدار في قاعدة البيانات بدل الاعتماد على العميل
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


-- =====================================================================
-- [ح-1] تحصين submit_rsvp — نقطة الكتابة العامة الوحيدة
-- =====================================================================
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
  -- 1) التحقق من المدخلات قبل أي لمس لقاعدة البيانات
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

  -- 2) سقف لعدد المدعوين يمنع إغراق قاعدة البيانات من زائر مجهول
  if (select count(*) from public.guests where event_id = v_event_id) >= 1000 then
    raise exception 'تم بلوغ الحد الأقصى للردود في هذه المناسبة';
  end if;

  -- 3) الآن أصبح upsert ذرّياً حقيقياً بفضل قيد unique(event_id, phone)
  insert into public.guests (event_id, name, phone, attendance_status)
  values (v_event_id, v_name, v_phone, p_status)
  on conflict (event_id, phone)
  do update set name = excluded.name,
                attendance_status = excluded.attendance_status;
end;
$$;

-- [ح-2] رد المدعو المُعرَّف مسبقاً: بالرمز فقط، بلا اسم ولا جوال في الرابط
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
     set attendance_status = p_status
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

grant execute on function public.submit_rsvp_by_token(uuid, public.attendance_status)
  to anon, authenticated;
grant execute on function public.get_guest_by_token(uuid) to anon, authenticated;


-- =====================================================================
-- [ع-3] أداء RLS: لفّ auth.uid() و is_admin() بـ (select ...)
--       ليعاملها المخطِّط كـ InitPlan مرة واحدة بدل كل صف
-- =====================================================================

-- profiles
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select using (id = (select auth.uid()) or (select public.is_admin()));

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update using (id = (select auth.uid()) or (select public.is_admin()))
  with check (id = (select auth.uid()) or (select public.is_admin()));

-- templates
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

-- events
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

-- guests
drop policy if exists "guests_select_owner" on public.guests;
create policy "guests_select_owner" on public.guests
  for select using (
    exists (select 1 from public.events e
             where e.id = event_id and e.user_id = (select auth.uid()))
    or (select public.is_admin())
  );

drop policy if exists "guests_insert_owner" on public.guests;
create policy "guests_insert_owner" on public.guests
  for insert with check (
    exists (select 1 from public.events e
             where e.id = event_id and e.user_id = (select auth.uid()))
  );

drop policy if exists "guests_update_owner" on public.guests;
create policy "guests_update_owner" on public.guests
  for update using (
    exists (select 1 from public.events e
             where e.id = event_id and e.user_id = (select auth.uid()))
  )
  with check (
    exists (select 1 from public.events e
             where e.id = event_id and e.user_id = (select auth.uid()))
  );

drop policy if exists "guests_delete_owner" on public.guests;
create policy "guests_delete_owner" on public.guests
  for delete using (
    exists (select 1 from public.events e
             where e.id = event_id and e.user_id = (select auth.uid()))
  );

-- فهرس يدعم exists(...) داخل سياسات guests
create index if not exists events_id_user_idx on public.events (id, user_id);


-- =====================================================================
-- [ع-1] الـ Buckets وسياسات التخزين كاملة داخل الشيفرة
-- =====================================================================
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

-- قراءة عامة للوسائط المعروضة في الدعوات (كانت مفقودة تماماً)
drop policy if exists "media_public_read" on storage.objects;
create policy "media_public_read" on storage.objects
  for select
  using (bucket_id in ('event-images','event-audios','template-images'));

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

commit;

-- =====================================================================
-- ✅ انتهت الهجرة
--
-- للتحقق السريع بعد التنفيذ:
--   select count(*) from storage.buckets;                    -- المتوقع 4
--   select conname from pg_constraint
--    where conrelid = 'public.guests'::regclass;             -- يظهر guests_event_phone_unique
--   select column_default from information_schema.columns
--    where table_name='events' and column_name='share_slug'; -- gen_random_bytes
-- =====================================================================
