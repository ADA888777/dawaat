-- =====================================================================
-- 0006 — رسوم الإرسال: الدفع قبل الإرسال النهائي للدعوات
--
-- الفكرة: إرسال الدعوات لمناسبة يتطلب دفع رسوم يحددها الأدمن من الإعدادات.
-- لا تُسجَّل أي دعوة كـ «مجهّزة/مرسلة» قبل أن تكون للمناسبة عملية دفع
-- بحالة «مدفوعة» (paid). الحماية في قاعدة البيانات لا في الواجهة.
--
-- بوابة الدفع الإلكترونية غير مربوطة بعد، لذلك طريقة الدفع الحالية:
--   تحويل بنكي ← رفع إثبات التحويل ← موافقة الأدمن ← يُفتح الإرسال.
-- الجدول والدوال مصمّمة لتُربط ببوابة لاحقاً (method = 'gateway' مع
-- provider/provider_ref) دون تغيير الواجهة أو منطق الحماية.
--
-- الضغط على زر «دفعت» لا يعني «مدفوع»: الحالة تنتقل إلى paid فقط بموافقة
-- الأدمن (أو تأكيد البوابة مستقبلاً)، أو تلقائياً إذا كانت الرسوم صفراً.
--
-- آمن لإعادة التنفيذ: لا يحذف بيانات ولا سياسات.
-- =====================================================================

-- ---------- 1) الإعدادات: مبلغ الرسوم وبيانات التحويل ----------
alter table public.app_settings
  add column if not exists send_fee_amount      numeric(12,2) not null default 0,
  add column if not exists send_fee_currency    text          not null default 'SAR',
  add column if not exists bank_name            text          not null default '',
  add column if not exists bank_account_name    text          not null default '',
  add column if not exists bank_iban            text          not null default '',
  add column if not exists payment_instructions text          not null default '';

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.app_settings'::regclass
                    and conname = 'app_settings_send_fee_chk') then
    alter table public.app_settings
      add constraint app_settings_send_fee_chk
      check (send_fee_amount >= 0 and send_fee_amount <= 100000);
  end if;
end $$;

comment on column public.app_settings.send_fee_amount is
  'رسوم إرسال الدعوات لكل مناسبة (0 = الإرسال مجاني بلا شاشة دفع)';
comment on column public.app_settings.bank_iban is
  'الآيبان الذي يحوّل إليه المستخدم رسوم الإرسال';

-- ---------- 2) الأنواع ----------
do $$ begin
  create type public.payment_status as enum
    ('pending','submitted','paid','rejected','cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.sending_status as enum
    ('not_started','in_progress','completed');
exception when duplicate_object then null; end $$;

-- ---------- 3) جدول عمليات الدفع ----------
create table if not exists public.event_payments (
  id                   bigint generated always as identity primary key,
  user_id              uuid   not null references public.profiles(id) on delete cascade,
  event_id             bigint not null references public.events(id)   on delete cascade,
  -- لقطة من المبلغ لحظة الطلب: تغيير الرسوم لاحقاً لا يغيّر عملية قائمة
  amount               numeric(12,2) not null check (amount >= 0),
  currency             text   not null default 'SAR',
  method               text   not null default 'bank_transfer'
                         check (method in ('bank_transfer','gateway','free')),
  status               public.payment_status not null default 'pending',
  -- رقم/مرجع العملية: يكتبه المستخدم من إيصال التحويل، أو تعيده البوابة
  reference            text   not null default '',
  -- مسار إثبات التحويل داخل bucket payment-proofs (خاص)
  proof_path           text,
  -- للربط ببوابة دفع لاحقاً
  provider             text,
  provider_ref         text,
  submitted_at         timestamptz,
  paid_at              timestamptz,
  reviewed_by          uuid references public.profiles(id) on delete set null,
  reviewed_at          timestamptz,
  admin_note           text   not null default '',
  -- حالة الإرسال المرتبطة بهذه العملية
  sending_status       public.sending_status not null default 'not_started',
  sending_started_at   timestamptz,
  sending_completed_at timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists event_payments_user_idx  on public.event_payments(user_id);
create index if not exists event_payments_event_idx on public.event_payments(event_id);
create index if not exists event_payments_status_idx on public.event_payments(status);

-- عملية نشطة واحدة لكل مناسبة (المرفوضة/الملغاة لا تحجز المناسبة)
create unique index if not exists event_payments_one_active_idx
  on public.event_payments(event_id)
  where status in ('pending','submitted','paid');

drop trigger if exists event_payments_touch on public.event_payments;
create trigger event_payments_touch
  before update on public.event_payments
  for each row execute function public.touch_updated_at();

comment on table public.event_payments is
  'رسوم إرسال الدعوات: عملية لكل مناسبة — من الطلب إلى موافقة الأدمن إلى الإرسال';

-- RLS: المالك والأدمن يقرآن فقط. كل الكتابة عبر الدوال أدناه.
alter table public.event_payments enable row level security;

drop policy if exists event_payments_select on public.event_payments;
create policy event_payments_select on public.event_payments
  for select using (user_id = (select auth.uid()) or (select public.is_admin()));

revoke all on table public.event_payments from anon, authenticated;
grant select on table public.event_payments to authenticated;

-- ---------- 4) التخزين: إثباتات التحويل (خاص) ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('payment-proofs', 'payment-proofs', false, 5242880,
        array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- المستخدم يرفع في مجلده فقط، ويقرأه هو والأدمن (عبر روابط موقّعة)
drop policy if exists "proofs_upload_own_folder" on storage.objects;
create policy "proofs_upload_own_folder" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'payment-proofs'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "proofs_read_own_or_admin" on storage.objects;
create policy "proofs_read_own_or_admin" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'payment-proofs'
    and ((storage.foldername(name))[1] = (select auth.uid())::text
         or (select public.is_admin()))
  );

-- ---------- 5) هل الإرسال مفتوح لهذه المناسبة؟ ----------
-- مفتوح إذا كانت الرسوم صفراً، أو للمناسبة عملية دفع بحالة paid.
create or replace function public.event_sending_unlocked(p_event_id bigint)
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce((select send_fee_amount from public.app_settings where id = true), 0) <= 0
      or exists (select 1 from public.event_payments
                  where event_id = p_event_id and status = 'paid');
$$;

revoke execute on function public.event_sending_unlocked(bigint) from anon;
grant execute on function public.event_sending_unlocked(bigint) to authenticated;

-- ---------- 6) طلب الدفع (مالك المناسبة) ----------
-- يرجع العملية النشطة إن وُجدت، وإلا ينشئ واحدة بالمبلغ الحالي من الإعدادات.
-- رسوم صفر ← تُسجَّل عملية method = 'free' بحالة paid مباشرة.
create or replace function public.request_event_payment(p_event_id bigint)
returns public.event_payments
language plpgsql security definer set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_fee    numeric(12,2);
  v_cur    text;
  v_row    public.event_payments;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  if not exists (select 1 from public.events where id = p_event_id and user_id = v_uid) then
    raise exception 'EVENT_NOT_FOUND';
  end if;

  select * into v_row from public.event_payments
   where event_id = p_event_id and status in ('pending','submitted','paid')
   order by id desc limit 1;
  if found then
    return v_row;
  end if;

  select coalesce(send_fee_amount, 0), coalesce(nullif(send_fee_currency, ''), 'SAR')
    into v_fee, v_cur
    from public.app_settings where id = true;
  v_fee := coalesce(v_fee, 0);
  v_cur := coalesce(v_cur, 'SAR');

  if v_fee <= 0 then
    insert into public.event_payments
      (user_id, event_id, amount, currency, method, status, paid_at)
    values (v_uid, p_event_id, 0, v_cur, 'free', 'paid', now())
    returning * into v_row;
  else
    insert into public.event_payments
      (user_id, event_id, amount, currency, method, status)
    values (v_uid, p_event_id, v_fee, v_cur, 'bank_transfer', 'pending')
    returning * into v_row;
  end if;

  return v_row;
end;
$$;

revoke execute on function public.request_event_payment(bigint) from anon;
grant execute on function public.request_event_payment(bigint) to authenticated;

-- ---------- 7) تقديم إثبات التحويل (مالك العملية) ----------
-- الحالة تصبح submitted (بانتظار المراجعة) — ليست paid.
create or replace function public.submit_event_payment(
  p_payment_id bigint, p_reference text, p_proof_path text
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

  select * into v_row from public.event_payments
   where id = p_payment_id and user_id = v_uid for update;
  if not found then
    raise exception 'PAYMENT_NOT_FOUND';
  end if;
  if v_row.status not in ('pending','rejected') then
    raise exception 'PAYMENT_NOT_EDITABLE';
  end if;
  if nullif(btrim(coalesce(p_proof_path, '')), '') is null then
    raise exception 'PROOF_REQUIRED';
  end if;
  -- الإثبات يجب أن يكون في مجلد المستخدم نفسه داخل bucket الإثباتات
  if split_part(p_proof_path, '/', 1) <> v_uid::text then
    raise exception 'PROOF_PATH_INVALID';
  end if;

  update public.event_payments
     set status       = 'submitted',
         reference    = left(btrim(coalesce(p_reference, '')), 120),
         proof_path   = p_proof_path,
         submitted_at = now(),
         admin_note   = '',
         reviewed_by  = null,
         reviewed_at  = null
   where id = p_payment_id
   returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function public.submit_event_payment(bigint, text, text) from anon;
grant execute on function public.submit_event_payment(bigint, text, text) to authenticated;

-- ---------- 8) مراجعة الأدمن: قبول أو رفض ----------
create or replace function public.review_event_payment(
  p_payment_id bigint, p_approve boolean, p_note text default ''
)
returns public.event_payments
language plpgsql security definer set search_path = public
as $$
declare
  v_row public.event_payments;
begin
  if not public.is_admin() then
    raise exception 'ADMIN_ONLY';
  end if;

  select * into v_row from public.event_payments where id = p_payment_id for update;
  if not found then
    raise exception 'PAYMENT_NOT_FOUND';
  end if;
  if v_row.status not in ('pending','submitted') then
    raise exception 'PAYMENT_ALREADY_REVIEWED';
  end if;

  update public.event_payments
     set status      = case when p_approve then 'paid'::public.payment_status
                            else 'rejected'::public.payment_status end,
         paid_at     = case when p_approve then now() else null end,
         reviewed_by = auth.uid(),
         reviewed_at = now(),
         admin_note  = left(btrim(coalesce(p_note, '')), 500)
   where id = p_payment_id
   returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function public.review_event_payment(bigint, boolean, text) from anon;
grant execute on function public.review_event_payment(bigint, boolean, text) to authenticated;

-- ---------- 9) بوابة الحماية: لا تجهيز ولا إرسال قبل الدفع ----------
-- نفس الدالة من 0003 مع فحص الدفع لكل مناسبة تخص المدعوين المطلوبين،
-- وتحديث حالة الإرسال في عملية الدفع.
create or replace function public.mark_guests_invite_status(
  p_guest_ids bigint[], p_status public.invite_status
)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_count integer;
  v_event bigint;
begin
  if p_guest_ids is null or array_length(p_guest_ids, 1) is null then
    return 0;
  end if;

  if p_status in ('prepared','sent') then
    for v_event in
      select distinct g.event_id
        from public.guests g
        join public.events e on e.id = g.event_id and e.user_id = auth.uid()
       where g.id = any(p_guest_ids)
    loop
      if not public.event_sending_unlocked(v_event) then
        raise exception 'PAYMENT_REQUIRED';
      end if;
    end loop;
  end if;

  update public.guests g
     set invite_status = p_status,
         invite_prepared_at = case
           when p_status in ('prepared','sent')
           then coalesce(g.invite_prepared_at, now())
           else g.invite_prepared_at end,
         invite_sent_at = case
           when p_status = 'sent' then coalesce(g.invite_sent_at, now())
           else g.invite_sent_at end
   where g.id = any(p_guest_ids)
     and exists (
       select 1 from public.events e
        where e.id = g.event_id and e.user_id = auth.uid()
     );

  get diagnostics v_count = row_count;

  -- حالة الإرسال على عملية الدفع المدفوعة لهذه المناسبات
  if v_count > 0 and p_status in ('prepared','sent') then
    update public.event_payments p
       set sending_status = case
             when not exists (select 1 from public.guests x
                               where x.event_id = p.event_id
                                 and x.invite_status in ('pending','prepared'))
             then 'completed'::public.sending_status
             else 'in_progress'::public.sending_status end,
           sending_started_at = coalesce(p.sending_started_at, now()),
           sending_completed_at = case
             when not exists (select 1 from public.guests x
                               where x.event_id = p.event_id
                                 and x.invite_status in ('pending','prepared'))
             then coalesce(p.sending_completed_at, now())
             else null end
     where p.status = 'paid'
       and p.event_id in (select distinct event_id from public.guests
                           where id = any(p_guest_ids));
  end if;

  return v_count;
end;
$$;

revoke execute on function public.mark_guests_invite_status(bigint[], public.invite_status) from anon;
grant execute on function public.mark_guests_invite_status(bigint[], public.invite_status) to authenticated;
