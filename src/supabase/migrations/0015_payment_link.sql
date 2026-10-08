-- =====================================================================
-- 0015 — رابط دفع جاهز لأي مزوّد، بلا ربط برمجي
--
-- بعض المزوّدين يعطون التاجر رابط صفحة دفع ثابتاً قبل أن يتاح ربط API
-- (أو بدلاً منه). هذا العمود يجعل إضافة أي بوابة جديدة «لصق رابط» من
-- لوحة الأدمن: يظهر للعميل زر يفتح الرابط، ويبقى التأكيد يدوياً من
-- تبويب المدفوعات — فالعودة من صفحة الدفع ليست إثباتاً.
--
-- آمن لإعادة التنفيذ.
-- =====================================================================

alter table public.app_settings
  add column if not exists payment_link_url text not null default '';

alter table public.app_settings
  drop constraint if exists app_settings_payment_link_check;
alter table public.app_settings
  add constraint app_settings_payment_link_check
    check (payment_link_url = '' or payment_link_url ~* '^https://');

comment on column public.app_settings.payment_link_url is
  'رابط صفحة دفع جاهز من أي مزوّد — فارغ = الميزة مطفأة. القبول يدوي دائماً';
