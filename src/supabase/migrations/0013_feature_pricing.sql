-- =====================================================================
-- 0013 — إلغاء الباقات، والتسعير بحسب المزايا المستخدمة
--
-- قبل: باقة مجانية بمناسبة واحدة + «باقة ماسية» لا يستطيع العميل شراءها
--      بنفسه (upgrade_my_subscription مسحوبة الصلاحية منذ 0002)، فكان
--      العميل يصطدم بحائط مسدود عند المناسبة الثانية.
-- بعد: لا حد للمناسبات إطلاقاً. الدخل من رسوم الإرسال، وتُحسب تراكمياً
--      من المزايا التي استخدمها العميل فعلاً في المناسبة:
--          الأساس + صورة الغلاف + التسجيل الصوتي + القالب المميز
--
-- الأساس ٥ ريالات لأن الحد الأدنى لفاتورة بيلينك ٥ — أي سعر أقل
-- لا يمكن دفعه بالبطاقة أصلاً.
--
-- إضافة ميزة بعد الدفع لا تمر مجاناً: event_sending_unlocked تقارن
-- مجموع المدفوع بالمطلوب الحالي، وrequest_event_payment تنشئ دفعة
-- تكميلية بالفرق.
--
-- آمن لإعادة التنفيذ.
-- =====================================================================

-- ---------- 1) إلغاء حد المناسبات ----------
-- نُبقي العمود والمشغّل (لا نكسر بيانات ولا نعتمد على ترتيب الهجرات)
-- لكن نجعلهما بلا أثر: أي حد قديم يُمسح، والدالة تمرّر كل شيء.
alter table public.profiles alter column events_limit set default null;
-- تريجر protect_profile_columns يمنع لمس events_limit حتى من محرر SQL
-- (نسخة الإنتاج أقدم من schema.sql ولا تستثني الجلسة الخالية من مستخدم)،
-- فنعطّله حول هذا التحديث وحده — النمط نفسه المستخدم في 0001 و0002.
alter table public.profiles disable trigger protect_profile_columns;
update public.profiles set events_limit = null where events_limit is not null;
alter table public.profiles enable trigger protect_profile_columns;

create or replace function public.enforce_events_limit()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  -- أُلغيت الباقات في 0013 — لا حد لعدد المناسبات.
  -- أُبقيت الدالة مكان المشغّل القائم بدل حذفه حتى تبقى الهجرة
  -- قابلة لإعادة التنفيذ ويسهل التراجع لاحقاً.
  return new;
end;
$$;

revoke execute on function public.enforce_events_limit() from anon, authenticated;

-- ---------- 2) أسعار المزايا ----------
alter table public.app_settings
  add column if not exists fee_base_amount        numeric(12,2) not null default 5,
  add column if not exists fee_cover_image_amount numeric(12,2) not null default 3,
  add column if not exists fee_audio_amount       numeric(12,2) not null default 2,
  add column if not exists fee_template_amount    numeric(12,2) not null default 0;

alter table public.app_settings
  drop constraint if exists app_settings_feature_fees_check;
alter table public.app_settings
  add constraint app_settings_feature_fees_check check (
    fee_base_amount        between 0 and 100000 and
    fee_cover_image_amount between 0 and 100000 and
    fee_audio_amount       between 0 and 100000 and
    fee_template_amount    between 0 and 100000
  );

comment on column public.app_settings.fee_base_amount is
  'أساس رسوم الإرسال لكل مناسبة — ٥ فأكثر ليقبلها الدفع بالبطاقة (حد بيلينك)';
comment on column public.app_settings.fee_cover_image_amount is
  'يُضاف عند وجود صورة غلاف';
comment on column public.app_settings.fee_audio_amount is
  'يُضاف عند وجود تسجيل صوتي';
comment on column public.app_settings.fee_template_amount is
  'يُضاف عند اختيار قالب مميز — صفر = القوالب مجانية';

-- ترحيل القيمة القديمة مرة واحدة فقط: من كان يستخدم send_fee_amount
-- ينتقل أساسه إليها بدل أن يقفز السعر فجأة.
do $$
declare v_old numeric(12,2);
begin
  if not exists (select 1 from public.app_settings where id = true) then
    return;
  end if;
  select send_fee_amount into v_old from public.app_settings where id = true;
  -- نرحّل فقط إن كان العمود الجديد ما زال على قيمته الافتراضية
  -- ولم يسبق لأحد تعديله (يُنفَّذ مرة واحدة عملياً)
  if v_old is not null and v_old > 0
     and (select fee_base_amount from public.app_settings where id = true) = 5
     and v_old >= 5 then
    update public.app_settings set fee_base_amount = v_old where id = true;
  end if;
end $$;

-- ---------- 3) حساب رسوم مناسبة بعينها ----------
-- المزايا تُقرأ من صفّ المناسبة نفسه، لا مما يرسله المتصفح.
create or replace function public.event_fee_amount(p_event_id bigint)
returns numeric
language sql stable security definer set search_path = public
as $$
  select greatest(0,
           coalesce(s.fee_base_amount, 0)
         + case when nullif(btrim(coalesce(e.cover_image, '')), '') is not null
                then coalesce(s.fee_cover_image_amount, 0) else 0 end
         + case when nullif(btrim(coalesce(e.audio_file, '')), '') is not null
                then coalesce(s.fee_audio_amount, 0) else 0 end
         + case when e.template_id is not null
                then coalesce(s.fee_template_amount, 0) else 0 end)
    from public.events e
    cross join public.app_settings s
   where e.id = p_event_id and s.id = true;
$$;

revoke execute on function public.event_fee_amount(bigint) from public, anon;
grant execute on function public.event_fee_amount(bigint) to authenticated;

-- تفصيل السعر للعرض في الواجهة (بنود + مجموع)
create or replace function public.event_fee_breakdown(p_event_id bigint)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
           'currency', coalesce(nullif(s.send_fee_currency, ''), 'SAR'),
           'total',    public.event_fee_amount(p_event_id),
           'paid',     coalesce((select sum(p.amount) from public.event_payments p
                                  where p.event_id = p_event_id and p.status = 'paid'), 0),
           'items',    jsonb_build_array(
             jsonb_build_object('key','base','label','إنشاء الدعوة وإرسالها',
                                'amount', coalesce(s.fee_base_amount, 0), 'applied', true),
             jsonb_build_object('key','cover_image','label','صورة الغلاف',
                                'amount', coalesce(s.fee_cover_image_amount, 0),
                                'applied', nullif(btrim(coalesce(e.cover_image,'')),'') is not null),
             jsonb_build_object('key','audio','label','التسجيل الصوتي',
                                'amount', coalesce(s.fee_audio_amount, 0),
                                'applied', nullif(btrim(coalesce(e.audio_file,'')),'') is not null),
             jsonb_build_object('key','template','label','القالب المميز',
                                'amount', coalesce(s.fee_template_amount, 0),
                                'applied', e.template_id is not null)))
    from public.events e
    cross join public.app_settings s
   where e.id = p_event_id and s.id = true
     and (e.user_id = auth.uid() or public.is_admin());
$$;

revoke execute on function public.event_fee_breakdown(bigint) from public, anon;
grant execute on function public.event_fee_breakdown(bigint) to authenticated;

-- ---------- 4) فتح الإرسال: المدفوع يغطي المطلوب الحالي ----------
-- لم يعد وجود دفعة واحدة مدفوعة كافياً: من دفع ٥ ثم أضاف صورة
-- يجب أن يدفع الفرق قبل الإرسال.
create or replace function public.event_sending_unlocked(p_event_id bigint)
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce((select sum(p.amount) from public.event_payments p
                    where p.event_id = p_event_id and p.status = 'paid'), 0)
         >= coalesce(public.event_fee_amount(p_event_id), 0);
$$;

revoke execute on function public.event_sending_unlocked(bigint) from anon;
grant execute on function public.event_sending_unlocked(bigint) to authenticated;

-- ---------- 5) طلب الدفع بالمبلغ المستحق (مع الدفعات التكميلية) ----------
create or replace function public.request_event_payment(p_event_id bigint)
returns public.event_payments
language plpgsql security definer set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_required numeric(12,2);
  v_paid     numeric(12,2);
  v_due      numeric(12,2);
  v_cur      text;
  v_row      public.event_payments;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  if not exists (select 1 from public.events where id = p_event_id and user_id = v_uid) then
    raise exception 'EVENT_NOT_FOUND';
  end if;

  select coalesce(nullif(send_fee_currency, ''), 'SAR') into v_cur
    from public.app_settings where id = true;
  v_cur := coalesce(v_cur, 'SAR');

  v_required := coalesce(public.event_fee_amount(p_event_id), 0);
  select coalesce(sum(amount), 0) into v_paid
    from public.event_payments
   where event_id = p_event_id and status = 'paid';
  v_due := v_required - v_paid;

  -- مغطّاة بالكامل: نعيد آخر عملية مدفوعة (أو نسجّل عملية مجانية)
  if v_due <= 0 then
    select * into v_row from public.event_payments
     where event_id = p_event_id and status = 'paid'
     order by id desc limit 1;
    if found then
      return v_row;
    end if;
    insert into public.event_payments
      (user_id, event_id, amount, currency, method, status, paid_at)
    values (v_uid, p_event_id, 0, v_cur, 'free', 'paid', now())
    returning * into v_row;
    return v_row;
  end if;

  -- عملية جارية: نُحدّث مبلغها إن تغيّرت مزايا المناسبة بعد إنشائها.
  -- المرفوعة للمراجعة (submitted) لا يُمس مبلغها حتى لا يتغيّر تحت يد
  -- الأدمن أثناء مطابقته بالإيصال.
  select * into v_row from public.event_payments
   where event_id = p_event_id and status in ('pending','submitted')
   order by id desc limit 1
   for update;
  if found then
    if v_row.status = 'pending' and v_row.amount is distinct from v_due then
      update public.event_payments
         set amount = v_due, currency = v_cur
       where id = v_row.id
       returning * into v_row;
    end if;
    return v_row;
  end if;

  insert into public.event_payments
    (user_id, event_id, amount, currency, method, status)
  values (v_uid, p_event_id, v_due, v_cur, 'bank_transfer', 'pending')
  returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function public.request_event_payment(bigint) from public, anon;
grant execute on function public.request_event_payment(bigint) to authenticated;

-- ---------- 6) فهرس «عملية مفتوحة واحدة» بدل «عملية نشطة واحدة» ----------
-- الفهرس القديم كان يمنع وجود أكثر من صف paid للمناسبة، وهذا يمنع
-- الدفعات التكميلية. المقصود أصلاً منع طلبين مفتوحين في آنٍ واحد،
-- وهذا ما يفعله الفهرس الجديد — مع السماح بعدة دفعات مكتملة.
drop index if exists public.event_payments_one_active_idx;
create unique index if not exists event_payments_one_open_idx
  on public.event_payments(event_id)
  where status in ('pending','submitted');
