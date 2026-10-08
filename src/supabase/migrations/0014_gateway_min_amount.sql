-- =====================================================================
-- 0014 — الحد الأدنى لمبلغ الدفع بالبطاقة كإعداد لا رقم مزروع في الكود
--
-- كان الرقم 5 مكتوباً داخل الواجهة لأن بيلينك ترفض أقل من ٥ ريالات.
-- ميسر تقبل من ريال واحد، فالرقم صار يختلف بحسب البوابة ولم يعد يصح
-- زرعه في الشيفرة. الـ Worker يفرض حدّ بوابته بنفسه، وهذا العمود
-- يجعل الواجهة تعرض الحقيقة نفسها بدل تخمينها.
--
-- آمن لإعادة التنفيذ.
-- =====================================================================

alter table public.app_settings
  add column if not exists payment_gateway_min_amount numeric(12,2) not null default 5;

alter table public.app_settings
  drop constraint if exists app_settings_gateway_min_check;
alter table public.app_settings
  add constraint app_settings_gateway_min_check
    check (payment_gateway_min_amount between 0 and 100000);

comment on column public.app_settings.payment_gateway_min_amount is
  'أقل مبلغ يقبله الدفع بالبطاقة — بيلينك ٥، ميسر ١. دونه يُعرض التحويل البنكي وحده';
