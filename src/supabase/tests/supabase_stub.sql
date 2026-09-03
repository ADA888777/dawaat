-- =====================================================================
--  محاكاة الحد الأدنى من بيئة Supabase لتشغيل الاختبارات على Postgres عادي.
--  يُستخدم في CI فقط — لا يُنفَّذ أبداً على مشروع Supabase حقيقي
--  (هناك auth و storage والأدوار موجودة أصلاً).
-- =====================================================================

-- محاكاة الحد الأدنى من بيئة Supabase (auth + storage + الأدوار)
create extension if not exists pgcrypto;
create schema if not exists auth;
create schema if not exists storage;

create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  -- أعمدة كلمة المرور: مطلوبة لاختبار التسجيل والدخول محلياً
  encrypted_password text,
  email_confirmed_at timestamptz,
  raw_user_meta_data jsonb default '{}'::jsonb
);

-- auth.uid() تقرأ من إعداد الجلسة كما في Supabase
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create table storage.buckets (
  id text primary key, name text, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text, owner uuid
);
alter table storage.objects enable row level security;
create or replace function storage.foldername(name text) returns text[]
language sql immutable as $$ select string_to_array(name, '/'); $$;

do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
grant usage on schema public, auth, storage to anon, authenticated;
grant all on all tables in schema storage to anon, authenticated;
-- Supabase تمنح صلاحيات افتراضية على جداول public للأدوار
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;

grant usage on schema auth to anon, authenticated;
grant select on auth.users to anon, authenticated;
