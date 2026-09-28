-- =====================================================================
-- 0009 — بطاقات الإعلانات: عنوان ووصف وأيقونة/صورة وزر، وأماكن العرض
--
-- الشريط صار بطاقة أنيقة بدل نص متحرك، فكل إعلان يحمل:
--   العنوان، الوصف، أيقونة أو صورة، نص الزر ورابطه،
--   وأين يظهر: الصفحة الرئيسية العامة و/أو لوحة العميل.
--
-- الحقول القديمة (text / link) تبقى كما هي للتوافق: يُنقل محتواها إلى
-- title / button_url ولا يُحذف شيء. الواجهة تقرأ title وتقع على text
-- إن كان العنوان فارغاً (بيانات قديمة).
--
-- آمن لإعادة التنفيذ: لا يحذف بيانات ولا سياسات.
-- =====================================================================

alter table public.announcements
  add column if not exists title             text    not null default '',
  add column if not exists description       text    not null default '',
  add column if not exists image_url         text    not null default '',
  add column if not exists icon              text    not null default 'megaphone',
  add column if not exists button_text       text    not null default '',
  add column if not exists button_url        text    not null default '',
  add column if not exists show_on_home      boolean not null default true,
  add column if not exists show_on_dashboard boolean not null default true;

-- نقل البيانات القديمة مرة واحدة (لا يلمس صفاً نُقل سابقاً)
update public.announcements
   set title = left(btrim(text), 120)
 where btrim(title) = '' and btrim(coalesce(text, '')) <> '';

update public.announcements
   set button_url = link
 where btrim(button_url) = '' and btrim(coalesce(link, '')) <> '';

-- العنوان هو المطلوب الآن، ونص الإعلان القديم لم يعد إلزامياً
alter table public.announcements alter column text set default '';
alter table public.announcements alter column text drop not null;

do $$
begin
  if exists (select 1 from pg_constraint
              where conrelid = 'public.announcements'::regclass
                and conname = 'announcements_text_check') then
    alter table public.announcements drop constraint announcements_text_check;
  end if;

  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.announcements'::regclass
                    and conname = 'announcements_content_chk') then
    alter table public.announcements
      add constraint announcements_content_chk check (
        char_length(btrim(coalesce(title, ''))) between 1 and 120
        or char_length(btrim(coalesce(text, ''))) between 1 and 200
      );
  end if;

  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.announcements'::regclass
                    and conname = 'announcements_lengths_chk') then
    alter table public.announcements
      add constraint announcements_lengths_chk check (
        char_length(coalesce(title, '')) <= 120
        and char_length(coalesce(description, '')) <= 300
        and char_length(coalesce(image_url, '')) <= 1000
        and char_length(coalesce(icon, '')) <= 40
        and char_length(coalesce(button_text, '')) <= 40
        and char_length(coalesce(button_url, '')) <= 500
      );
  end if;
end $$;

comment on column public.announcements.icon is
  'مفتاح أيقونة من مجموعة ثابتة في الواجهة (megaphone, sparkles, gift, crown, calendar, percent, star, party)';
comment on column public.announcements.image_url is
  'صورة اختيارية تحل محل الأيقونة';
comment on column public.announcements.show_on_home is 'يظهر في الصفحة الرئيسية العامة';
comment on column public.announcements.show_on_dashboard is 'يظهر في لوحة العميل فوق «نظرة عامة»';

-- ---------- مدة عرض الإعلان الواحد قبل الانتقال ----------
alter table public.app_settings
  add column if not exists announcement_interval integer not null default 5;

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.app_settings'::regclass
                    and conname = 'app_settings_ann_interval_chk') then
    alter table public.app_settings
      add constraint app_settings_ann_interval_chk
      check (announcement_interval >= 2 and announcement_interval <= 60);
  end if;
end $$;

comment on column public.app_settings.announcement_interval is
  'ثواني عرض كل إعلان قبل الانتقال للتالي (الافتراضي 5)';
