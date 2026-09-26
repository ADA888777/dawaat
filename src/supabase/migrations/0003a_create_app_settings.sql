-- 0003a — إنشاء جدول إعدادات النظام public.app_settings
--
-- الجدول موجود في قاعدة البيانات الحية (أُنشئ يدوياً من SQL Editor)، لكن لم يكن
-- له ملف إنشاء في المستودع، فكان تنفيذ الهجرات على مشروع جديد يفشل عند 0004.
-- هذا الملف يطابق بنية الجدول الحية حرفياً، وهو آمن التنفيذ على المشروع الحالي:
--   • create table if not exists / add column if not exists → لا يغيّر شيئاً موجوداً
--   • القيود والسياسات تُنشأ فقط إن لم تكن موجودة → لا يُحذف ولا يُستبدل أي شيء
--   • صف الإعدادات الوحيد يُضاف فقط إن لم يوجد
-- يجب تنفيذه قبل 0004 (الترتيب الأبجدي للملفات يضمن ذلك).

create table if not exists public.app_settings (
  id boolean primary key default true
);

alter table public.app_settings
  add column if not exists site_name                     text        not null default '',
  add column if not exists support_email                 text        not null default '',
  add column if not exists support_phone                 text        not null default '',
  add column if not exists support_whatsapp              text        not null default '',
  add column if not exists maintenance_mode              boolean     not null default false,
  add column if not exists maintenance_message           text        not null default '',
  add column if not exists signups_enabled               boolean     not null default true,
  add column if not exists free_events_limit             integer     not null default 1,
  add column if not exists paid_plan_price               numeric     not null default 0,
  add column if not exists paid_plan_months              integer     not null default 12,
  add column if not exists invite_footer_note            text        not null default '',
  add column if not exists invite_default_contact_method text        not null default 'both',
  add column if not exists invite_show_contact           boolean     not null default true,
  add column if not exists notify_admin_on_new_user      boolean     not null default true,
  add column if not exists notify_admin_on_new_event     boolean     not null default false,
  add column if not exists notify_users_reminders        boolean     not null default true,
  add column if not exists terms_text                    text        not null default '',
  add column if not exists privacy_text                  text        not null default '',
  add column if not exists refund_text                   text        not null default '',
  add column if not exists content_policy_text           text        not null default '',
  add column if not exists updated_at                    timestamptz not null default now();

-- القيود: صف واحد فقط (id = true) وحدود منطقية للقيم
do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.app_settings'::regclass
                    and conname = 'app_settings_singleton') then
    alter table public.app_settings
      add constraint app_settings_singleton check (id is true);
  end if;

  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.app_settings'::regclass
                    and conname = 'app_settings_free_limit_chk') then
    alter table public.app_settings
      add constraint app_settings_free_limit_chk
      check (free_events_limit >= 0 and free_events_limit <= 1000);
  end if;

  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.app_settings'::regclass
                    and conname = 'app_settings_months_chk') then
    alter table public.app_settings
      add constraint app_settings_months_chk
      check (paid_plan_months >= 1 and paid_plan_months <= 120);
  end if;

  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.app_settings'::regclass
                    and conname = 'app_settings_method_chk') then
    alter table public.app_settings
      add constraint app_settings_method_chk
      check (invite_default_contact_method in ('call', 'whatsapp', 'both'));
  end if;
end $$;

-- صف الإعدادات الوحيد
insert into public.app_settings (id) values (true)
on conflict (id) do nothing;

-- RLS: القراءة للجميع (الواجهة تعرض بيانات التواصل حتى قبل الدخول)،
-- والتعديل للأدمن فقط. لا توجد سياسة insert/delete → ممنوعان على anon و authenticated.
alter table public.app_settings enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'app_settings'
                    and policyname = 'app_settings_read') then
    create policy app_settings_read on public.app_settings
      for select using (true);
  end if;

  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'app_settings'
                    and policyname = 'app_settings_update_admin') then
    create policy app_settings_update_admin on public.app_settings
      for update using ((select public.is_admin()))
      with check ((select public.is_admin()));
  end if;
end $$;

grant select on table public.app_settings to anon, authenticated;
grant update on table public.app_settings to authenticated;

comment on table public.app_settings is 'إعدادات النظام — صف واحد (id = true) يعدّله الأدمن فقط';
