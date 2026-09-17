-- 0004: معلومات التواصل في إعدادات النظام
-- يضيف حساب سناب شات إلى صف الإعدادات الواحد، فتقرأه الواجهة
-- من قاعدة البيانات بدل كتابته داخل الكود.

alter table public.app_settings
  add column if not exists support_snapchat text not null default '';

comment on column public.app_settings.support_email is 'بريد التواصل المعروض للعملاء';
comment on column public.app_settings.support_whatsapp is 'رقم واتساب التواصل المعروض للعملاء';
comment on column public.app_settings.support_snapchat is 'اسم حساب سناب شات المعروض للعملاء';
