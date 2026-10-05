-- =====================================================================
-- 0012 — ربط بوابة الدفع «بيلينك» برسوم الإرسال
--
-- الهجرة 0006 صمّمت جدول event_payments ليُربط ببوابة لاحقاً
-- (method = 'gateway' مع provider و provider_ref) — وهذا ما تفعله هذه الهجرة.
--
-- التدفق:
--   ١ العميل يضغط «ادفع بالبطاقة» ← الموقع ينادي POST /api/pay/create على
--     Worker دعوات ومعه جلسة المستخدم.
--   ٢ الـ Worker (خادم، يملك المفاتيح) ينشئ/يجلب عملية الدفع بجلسة المستخدم عبر
--     request_event_payment، ثم ينشئ فاتورة في بيلينك ويربط رقمها بالعملية عبر
--     attach_gateway_payment، ويعيد رابط صفحة الدفع.
--   ٣ بعد الدفع يعود العميل إلى /api/pay/return، كما يستدعي بيلينك
--     /api/pay/webhook خادماً لخادم. في الحالتين يتحقق الـ Worker من الحالة
--     والمبلغ من بيلينك مباشرة (getInvoice) ثم ينادي confirm_gateway_payment.
--
-- الأمان:
--   • لا يملك المتصفح ولا بيلينك صلاحية تعليم عملية كـ«مدفوعة». التأكيد يتم
--     بدالة تتطلب سراً مشتركاً (gateway_secret) يعرفه الـ Worker وحده
--     (متغير سري في Cloudflare)، فلا ينفع مفتاح anon العام وحده.
--   • السر مخزّن في app_private خارج أي صلاحية لـ anon/authenticated، ولا
--     تُعيده أي دالة.
--   • confirm_gateway_payment تتحقق من تطابق المبلغ ولا تقبل تخفيضه.
--   • لا يوجد أي مفتاح service_role في أي مكان.
--
-- آمن لإعادة التنفيذ.
-- =====================================================================

-- ---------- 1) مخطط خاص للأسرار (لا صلاحية لأحد عليه) ----------
create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;

create table if not exists app_private.gateway_config (
  id          boolean primary key default true check (id),
  -- سر مشترك بين Worker دعوات وقاعدة البيانات لتأكيد الدفع
  secret      text    not null default '',
  updated_at  timestamptz not null default now()
);

insert into app_private.gateway_config (id, secret)
values (true, '')
on conflict (id) do nothing;

revoke all on table app_private.gateway_config from public, anon, authenticated;

-- يضبطه الأدمن مرة واحدة بنفس القيمة الموضوعة في Cloudflare
create or replace function public.set_gateway_secret(p_secret text)
returns void
language plpgsql security definer set search_path = public, app_private
as $$
begin
  if not public.is_admin() then
    raise exception 'ADMIN_ONLY';
  end if;
  if length(coalesce(p_secret, '')) < 24 then
    raise exception 'SECRET_TOO_SHORT';
  end if;
  update app_private.gateway_config
     set secret = p_secret, updated_at = now()
   where id = true;
end;
$$;

revoke all on function public.set_gateway_secret(text) from public, anon;
grant execute on function public.set_gateway_secret(text) to authenticated;

/** تحقق ثابت الزمن تقريبياً من السر المشترك */
create or replace function app_private.gateway_secret_ok(p_secret text)
returns boolean
language sql stable security definer set search_path = app_private
as $$
  select coalesce(
    (select g.secret <> '' and p_secret is not null and g.secret = p_secret
       from app_private.gateway_config g where g.id = true),
    false);
$$;

revoke all on function app_private.gateway_secret_ok(text) from public, anon, authenticated;

-- ---------- 2) إعدادات البوابة الظاهرة للموقع ----------
alter table public.app_settings
  add column if not exists payment_gateway_enabled boolean not null default false,
  add column if not exists payment_gateway_name    text    not null default 'بيلينك';

comment on column public.app_settings.payment_gateway_enabled is
  'تفعيل الدفع بالبطاقة عبر بيلينك — عند الإطفاء يبقى التحويل البنكي وحده';

-- ---------- 3) ربط فاتورة البوابة بعملية الدفع (بجلسة المستخدم) ----------
create or replace function public.attach_gateway_payment(
  p_payment_id bigint, p_provider text, p_provider_ref text
)
returns public.event_payments
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.event_payments;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  if nullif(btrim(coalesce(p_provider_ref, '')), '') is null then
    raise exception 'PROVIDER_REF_REQUIRED';
  end if;

  select * into v_row from public.event_payments
   where id = p_payment_id and user_id = v_uid for update;
  if not found then
    raise exception 'PAYMENT_NOT_FOUND';
  end if;
  -- المدفوعة لا تُمس، والمرفوضة/الملغاة تُستأنف بطلب جديد لا بربط فاتورة
  if v_row.status not in ('pending','submitted') then
    raise exception 'PAYMENT_NOT_EDITABLE';
  end if;

  update public.event_payments
     set method       = 'gateway',
         provider     = left(btrim(coalesce(p_provider, 'paylink')), 40),
         provider_ref = left(btrim(p_provider_ref), 120),
         status       = 'pending',
         submitted_at = now(),
         admin_note   = ''
   where id = p_payment_id
   returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.attach_gateway_payment(bigint, text, text) from public, anon;
grant execute on function public.attach_gateway_payment(bigint, text, text) to authenticated;

-- ---------- 4) تأكيد الدفع (Worker فقط، بالسر المشترك) ----------
-- يُستدعى بعد أن يتحقق الـ Worker من بيلينك مباشرة أن الفاتورة مدفوعة.
-- لا تثق هذه الدالة بالمتصفح ولا بحمولة الـ webhook: الـ Worker هو من يتحقق.
create or replace function public.confirm_gateway_payment(
  p_secret text, p_provider_ref text, p_amount numeric, p_paid boolean default true
)
returns jsonb
language plpgsql security definer set search_path = public, app_private
as $$
declare
  v_row public.event_payments;
begin
  if not app_private.gateway_secret_ok(p_secret) then
    raise exception 'BAD_GATEWAY_SECRET';
  end if;
  if nullif(btrim(coalesce(p_provider_ref, '')), '') is null then
    raise exception 'PROVIDER_REF_REQUIRED';
  end if;

  select * into v_row from public.event_payments
   where provider_ref = btrim(p_provider_ref) and method = 'gateway'
   order by id desc limit 1
   for update;
  if not found then
    raise exception 'PAYMENT_NOT_FOUND';
  end if;

  -- مؤكَّدة مسبقاً: نعيد النتيجة نفسها بلا تغيير (الـ webhook يُعاد إرساله حتى 10 مرات)
  if v_row.status = 'paid' then
    return jsonb_build_object('ok', true, 'already', true,
      'payment_id', v_row.id, 'event_id', v_row.event_id, 'status', 'paid');
  end if;

  if not p_paid then
    update public.event_payments
       set status = 'rejected', admin_note = 'ألغتها بوابة الدفع'
     where id = v_row.id
     returning * into v_row;
    return jsonb_build_object('ok', true, 'payment_id', v_row.id,
      'event_id', v_row.event_id, 'status', 'rejected');
  end if;

  -- المبلغ المدفوع لا يقل عن المطلوب (حماية من تعديل المبلغ في الطريق)
  if p_amount is null or p_amount < v_row.amount then
    raise exception 'AMOUNT_MISMATCH';
  end if;

  update public.event_payments
     set status      = 'paid',
         paid_at     = now(),
         reviewed_at = now(),
         admin_note  = ''
   where id = v_row.id
   returning * into v_row;

  return jsonb_build_object('ok', true, 'payment_id', v_row.id,
    'event_id', v_row.event_id, 'status', 'paid');
end;
$$;

revoke all on function public.confirm_gateway_payment(text, text, numeric, boolean) from public;
-- anon مسموح لأن الـ Worker يستخدم مفتاح anon العام — الحماية الفعلية هي السر المشترك
grant execute on function public.confirm_gateway_payment(text, text, numeric, boolean)
  to anon, authenticated;

-- ---------- 5) حالة الدفع لصاحبها (يستطلعها الموقع بعد العودة) ----------
create or replace function public.gateway_payment_status(p_payment_id bigint)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
           'payment_id', p.id,
           'event_id',   p.event_id,
           'status',     p.status,
           'amount',     p.amount,
           'method',     p.method,
           'paid_at',    p.paid_at)
    from public.event_payments p
   where p.id = p_payment_id
     and (p.user_id = auth.uid() or public.is_admin());
$$;

revoke all on function public.gateway_payment_status(bigint) from public, anon;
grant execute on function public.gateway_payment_status(bigint) to authenticated;
