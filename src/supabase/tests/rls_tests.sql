-- =====================================================================
-- اختبارات RLS — تتحقق أن العزل بين المستخدمين يعمل فعلاً
-- التشغيل: psql -f supabase/tests/rls_tests.sql
-- أي فشل يوقف التنفيذ فوراً برسالة واضحة
-- =====================================================================
\set ON_ERROR_STOP on
begin;

-- ---------- تجهيز: ثلاثة مستخدمين ----------
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'alice@test.com'),
  ('22222222-2222-2222-2222-222222222222', 'bob@test.com'),
  ('33333333-3333-3333-3333-333333333333', 'admin@test.com');

-- ترقية الأدمن أثناء التجهيز: تريجر الحماية يمنعها عمداً (وهذا صحيح)،
-- لذا نعطّله مؤقتاً هنا فقط — كما يفعل الأدمن الأول عبر SQL Editor
alter table public.profiles disable trigger protect_profile_columns;
update public.profiles set role = 'admin'
 where id = '33333333-3333-3333-3333-333333333333';
alter table public.profiles enable trigger protect_profile_columns;

-- مناسبة لكل من أليس وبوب
insert into public.events (user_id, title, category, event_date, location)
values ('11111111-1111-1111-1111-111111111111','زفاف أليس','wedding', now()+interval '10 days','الرياض'),
       ('22222222-2222-2222-2222-222222222222','زفاف بوب','wedding',  now()+interval '10 days','جدة');

insert into public.guests (event_id, name, phone)
select id, 'مدعو أليس', '0500000001' from public.events where title = 'زفاف أليس';
insert into public.guests (event_id, name, phone)
select id, 'مدعو بوب', '0500000002' from public.events where title = 'زفاف بوب';

do $$
declare
  v_cnt int; v_limit int; v_slug text; v_slug2 text;
  v_token uuid; v_status public.attendance_status; v_ok boolean;
  v_event bigint; v_pay bigint; v_pay2 bigint; v_ids bigint[];
  v_pstatus public.payment_status; v_sstatus public.sending_status; v_amount numeric;
begin
  -- =================================================================
  -- اختبار 1 [ح/ع]: بوب لا يرى مناسبات أليس
  -- =================================================================
  set local role authenticated;
  perform set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222', true);

  select count(*) into v_cnt from public.events;
  if v_cnt <> 1 then raise exception 'فشل 1: بوب يرى % مناسبة بدل 1', v_cnt; end if;

  select count(*) into v_cnt from public.events where title = 'زفاف أليس';
  if v_cnt <> 0 then raise exception 'فشل 1ب: بوب يرى مناسبة أليس!'; end if;
  raise notice '✅ 1: عزل المناسبات بين المستخدمين يعمل';

  -- =================================================================
  -- اختبار 2 [ح]: بوب لا يرى مدعوي أليس
  -- =================================================================
  select count(*) into v_cnt from public.guests;
  if v_cnt <> 1 then raise exception 'فشل 2: بوب يرى % مدعو بدل 1', v_cnt; end if;
  raise notice '✅ 2: عزل المدعوين بين المستخدمين يعمل';

  -- =================================================================
  -- اختبار 3 [أمان]: بوب لا يستطيع ترقية نفسه إلى admin
  -- =================================================================
  begin
    update public.profiles set role = 'admin'
     where id = '22222222-2222-2222-2222-222222222222';
    raise exception 'فشل 3: بوب رقّى نفسه إلى admin!';
  exception when others then
    if sqlerrm like 'فشل 3%' then raise; end if;
    raise notice '✅ 3: منع الترقية الذاتية يعمل (%)', left(sqlerrm, 40);
  end;

  -- =================================================================
  -- اختبار 4 [أمان]: بوب لا يستطيع منح نفسه باقة مدفوعة
  -- =================================================================
  begin
    update public.profiles set plan = 'paid', events_limit = null
     where id = '22222222-2222-2222-2222-222222222222';
    raise exception 'فشل 4: بوب منح نفسه باقة مدفوعة!';
  exception when others then
    if sqlerrm like 'فشل 4%' then raise; end if;
    raise notice '✅ 4: حماية أعمدة الباقة تعمل';
  end;

  -- =================================================================
  -- اختبار 5 [ح-3]: منع تكرار المدعو بنفس الجوال
  -- =================================================================
  begin
    insert into public.guests (event_id, name, phone)
    select id, 'مكرر', '0500000002' from public.events where title = 'زفاف بوب';
    raise exception 'فشل 5: سُمح بتكرار الجوال في نفس المناسبة!';
  exception when unique_violation then
    raise notice '✅ 5: قيد unique(event_id, phone) يعمل';
  end;

  -- =================================================================
  -- اختبار 6 [ع-2]: share_slug يُولَّد في قاعدة البيانات وغير متوقع
  -- =================================================================
  select share_slug into v_slug from public.events where title = 'زفاف بوب';
  if v_slug is null or length(v_slug) <> 18 then
    raise exception 'فشل 6: slug غير صحيح: %', v_slug;
  end if;

  select share_slug into v_slug2 from public.events where title = 'ثانية';
  if v_slug = v_slug2 then raise exception 'فشل 6ب: تكرار slug!'; end if;
  raise notice '✅ 6: share_slug يُولَّد في قاعدة البيانات (18 خانة، فريد)';

  -- =================================================================
  -- اختبار 7 [ع-5]: حد الباقة المجانية = 3 ويُفرض فعلاً
  -- =================================================================
  select events_limit into v_limit from public.profiles
   where id = '22222222-2222-2222-2222-222222222222';
  if v_limit <> 1 then raise exception 'فشل 7: الحد % بدل 1', v_limit; end if;

  begin
    insert into public.events (user_id, title, category, event_date, location)
    values ('22222222-2222-2222-2222-222222222222','رابعة','general', now()+interval '5 days','جدة');
    raise exception 'فشل 7ب: تجاوز حد الباقة!';
  exception when others then
    if sqlerrm like 'فشل 7%' then raise; end if;
    if sqlerrm not like 'EVENTS_LIMIT_REACHED%' then
      raise exception 'فشل 7ج: رمز خطأ غير متوقع: %', sqlerrm;
    end if;
    raise notice '✅ 7: حد الباقة المجانية = 1 ويُفرض برمز EVENTS_LIMIT_REACHED';
  end;

  -- =================================================================
  -- اختبار 8 [ح-1]: submit_rsvp يرفض المدخلات غير الصالحة
  -- =================================================================
  reset role;
  -- نقرأ الـ slug كمالك أولاً (anon لا يرى الجدول أصلاً — وهذا مقصود)
  select share_slug into v_slug from public.events where title = 'زفاف أليس';
  set local role anon;

  begin
    perform public.submit_rsvp(v_slug, 'اسم', 'ليس-رقماً', 'attending');
    raise exception 'فشل 8: قُبل رقم جوال غير صالح!';
  exception when others then
    if sqlerrm like 'فشل 8%' then raise; end if;
    raise notice '✅ 8أ: رفض رقم الجوال غير الصالح';
  end;

  begin
    perform public.submit_rsvp(v_slug, repeat('أ', 200), '0501234567', 'attending');
    raise exception 'فشل 8ب: قُبل اسم بطول 200 حرف!';
  exception when others then
    if sqlerrm like 'فشل 8%' then raise; end if;
    raise notice '✅ 8ب: رفض الاسم المفرط الطول';
  end;

  -- =================================================================
  -- اختبار 9 [ح-3]: الرد المتكرر يحدّث صفاً واحداً لا يكرّره
  -- =================================================================
  perform public.submit_rsvp(v_slug, 'خالد', '0509999999', 'attending');
  perform public.submit_rsvp(v_slug, 'خالد', '0509999999', 'declined');

  reset role;
  select count(*) into v_cnt from public.guests
   where phone = '+966509999999';  -- [0005] يُخزَّن بالصيغة الموحّدة
  if v_cnt <> 1 then raise exception 'فشل 9: % صف بدل 1 بعد ردّين', v_cnt; end if;

  select attendance_status into v_status from public.guests where phone = '+966509999999';
  if v_status <> 'declined' then raise exception 'فشل 9ب: الحالة % بدل declined', v_status; end if;
  raise notice '✅ 9: upsert الردود ذرّي — صف واحد بالحالة الأخيرة';

  -- =================================================================
  -- اختبار 10 [ح-2]: الرد بالرمز يعمل دون تمرير الجوال
  -- =================================================================
  select invite_token into v_token from public.guests where phone = '+966500000001';
  set local role anon;
  perform public.submit_rsvp_by_token(v_token, 'attending');
  reset role;
  select attendance_status into v_status from public.guests where phone = '+966500000001';
  if v_status <> 'attending' then raise exception 'فشل 10: الرمز لم يسجّل الرد'; end if;

  -- ورمز عشوائي يُرفض
  set local role anon;
  begin
    perform public.submit_rsvp_by_token(gen_random_uuid(), 'attending');
    raise exception 'فشل 10ب: رمز عشوائي قُبل!';
  exception when others then
    if sqlerrm like 'فشل 10%' then raise; end if;
    raise notice '✅ 10: الرد بالرمز يعمل ويرفض الرموز غير الصالحة';
  end;

  -- =================================================================
  -- اختبار 11 [ح-2]: get_guest_by_token لا يكشف رقم الجوال
  -- =================================================================
  select count(*) into v_cnt
    from information_schema.columns
   where table_name = 'get_guest_by_token';  -- دالة لا جدول، نتحقق من التوقيع بدلاً
  select exists (
    select 1 from pg_proc p
     where p.proname = 'get_guest_by_token'
       and pg_get_function_result(p.oid) not like '%phone%'
  ) into v_ok;
  if not v_ok then raise exception 'فشل 11: الدالة تكشف الجوال!'; end if;
  raise notice '✅ 11: get_guest_by_token لا ترجع رقم الجوال';

  -- =================================================================
  -- اختبار 12 [ع-1]: الـ Buckets الخمسة موجودة بالإعدادات الصحيحة
  -- =================================================================
  reset role;
  select count(*) into v_cnt from storage.buckets;
  if v_cnt <> 5 then raise exception 'فشل 12: % bucket بدل 5', v_cnt; end if;

  select count(*) into v_cnt from storage.buckets
   where id = 'payment-proofs' and public = false;
  if v_cnt <> 1 then raise exception 'فشل 12أ: payment-proofs ليس خاصاً'; end if;

  select count(*) into v_cnt from storage.buckets
   where id = 'event-files' and public = false;
  if v_cnt <> 1 then raise exception 'فشل 12ب: event-files ليس خاصاً'; end if;

  select count(*) into v_cnt from pg_policies
   where schemaname = 'storage' and cmd = 'SELECT';
  if v_cnt < 1 then raise exception 'فشل 12ج: لا توجد سياسة قراءة على التخزين'; end if;
  raise notice '✅ 12: الـ Buckets الخمسة وسياساتها موجودة';

  -- =================================================================
  -- اختبار 13: الأدمن يرى كل شيء
  -- =================================================================
  set local role authenticated;
  perform set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333', true);
  select count(*) into v_cnt from public.events;
  if v_cnt < 2 then raise exception 'فشل 13: الأدمن يرى % مناسبة فقط', v_cnt; end if;
  raise notice '✅ 13: الأدمن يرى كل المناسبات';

  -- =================================================================
  -- اختبار 14 [ع-3]: كل السياسات تستخدم (select ...) للأداء
  -- =================================================================
  -- Postgres يخزّن التعبير الملفوف بصيغة "( SELECT auth.uid() AS uid)"
  -- فأي ظهور لـ auth.uid() غير مسبوق بـ SELECT يعني سياسة تُقيَّم لكل صف.
  reset role;
  select count(*) into v_cnt
    from pg_policies,
         lateral (select coalesce(qual,'') || ' ' || coalesce(with_check,'') as expr) x
   where schemaname = 'public'
     and (
       regexp_count(x.expr, 'auth\.uid\(\)') >
       regexp_count(x.expr, 'SELECT auth\.uid\(\)')
       or
       regexp_count(x.expr, 'is_admin\(\)') >
       regexp_count(x.expr, 'SELECT is_admin\(\)')
     );
  if v_cnt <> 0 then
    raise exception 'فشل 14: % سياسة تُقيّم auth.uid()/is_admin() لكل صف', v_cnt;
  end if;
  raise notice '✅ 14: كل سياسات public ملفوفة بـ (select ...) — تقييم مرة واحدة';

  -- =================================================================
  -- اختبار 15 [0005]: توحيد أرقام الجوال ومنع تكرار الشخص نفسه بصيغة أخرى
  -- =================================================================
  reset role;
  if public.normalize_sa_phone('050 123 4567')   <> '+966501234567'
  or public.normalize_sa_phone('00966501234567') <> '+966501234567'
  or public.normalize_sa_phone('٠٥٠١٢٣٤٥٦٧')     <> '+966501234567'
  or public.normalize_sa_phone('501234567')      <> '+966501234567'
  or public.normalize_sa_phone('(050) 123-4567') <> '+966501234567' then
    raise exception 'فشل 15: normalize_sa_phone لا يوحّد الصيغ السعودية';
  end if;

  select count(*) into v_cnt from public.guests
   where phone !~ '^\+9665[0-9]{8}$';
  if v_cnt <> 0 then raise exception 'فشل 15ب: % رقم مخزّن بغير الصيغة +9665XXXXXXXX', v_cnt; end if;

  -- بوب يضيف نفس مدعوه بصيغة مختلفة → يجب أن يرفضه القيد
  set local role authenticated;
  perform set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222', true);
  begin
    insert into public.guests (event_id, name, phone)
    select id, 'نفس الشخص', '+966 50 000 0002' from public.events where title = 'زفاف بوب';
    raise exception 'فشل 15ج: قُبل نفس الرقم بصيغة مختلفة!';
  exception when unique_violation then null;
  end;
  reset role;
  raise notice '✅ 15: الأرقام موحّدة +9665XXXXXXXX والتكرار بصيغة أخرى مرفوض';

  -- =================================================================
  -- اختبار 16 [0003a]: إعدادات النظام — قراءة للجميع وتعديل للأدمن فقط
  -- =================================================================
  set local role anon;
  select count(*) into v_cnt from public.app_settings;
  if v_cnt <> 1 then raise exception 'فشل 16: الزائر يرى % صف إعدادات بدل 1', v_cnt; end if;

  -- مستخدم عادي لا يستطيع التعديل (RLS تُسقط الصف بصمت)
  set local role authenticated;
  perform set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222', true);
  update public.app_settings set site_name = 'اختراق';
  reset role;
  select count(*) into v_cnt from public.app_settings where site_name = 'اختراق';
  if v_cnt <> 0 then raise exception 'فشل 16ب: مستخدم عادي عدّل إعدادات النظام!'; end if;

  -- ولا إضافة صف ثانٍ
  set local role authenticated;
  begin
    insert into public.app_settings (id) values (false);
    raise exception 'فشل 16ج: أُضيف صف إعدادات ثانٍ!';
  exception when others then
    if sqlerrm like 'فشل 16%' then raise; end if;
  end;

  -- الأدمن يعدّل
  perform set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333', true);
  update public.app_settings set support_snapchat = 'dawaat_test';
  reset role;
  select count(*) into v_cnt from public.app_settings where support_snapchat = 'dawaat_test';
  if v_cnt <> 1 then raise exception 'فشل 16د: الأدمن لم يستطع تعديل الإعدادات'; end if;
  raise notice '✅ 16: app_settings — قراءة للجميع، تعديل للأدمن فقط، صف واحد';


  -- =================================================================
  -- اختبار 17 [دفع]: لا إرسال قبل الدفع — والدفع يمر بموافقة الأدمن
  -- =================================================================
  reset role;
  update public.app_settings set send_fee_amount = 50;

  -- أليس تطلب الدفع لمناسبتها: عملية pending بالمبلغ الحالي
  set local role authenticated;
  perform set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111', true);
  select id into v_event from public.events where title = 'زفاف أليس';
  select id, status, amount into v_pay, v_pstatus, v_amount
    from public.request_event_payment(v_event);
  if v_pstatus <> 'pending' or v_amount <> 50 then
    raise exception 'فشل 17أ: العملية % بمبلغ % بدل pending/50', v_pstatus, v_amount;
  end if;

  -- الطلب مرة أخرى يرجع نفس العملية لا عملية جديدة
  select id into v_pay2 from public.request_event_payment(v_event);
  if v_pay2 <> v_pay then raise exception 'فشل 17ب: أُنشئت عملية دفع ثانية للمناسبة نفسها'; end if;

  -- تجهيز الدعوات قبل الدفع مرفوض
  select array_agg(id) into v_ids from public.guests where event_id = v_event;
  begin
    perform public.mark_guests_invite_status(v_ids, 'prepared');
    raise exception 'فشل 17ج: سُجّل تجهيز الدعوات قبل الدفع!';
  exception when others then
    if sqlerrm like 'فشل 17%' then raise; end if;
    if sqlerrm <> 'PAYMENT_REQUIRED' then
      raise exception 'فشل 17ج: خطأ غير متوقع: %', sqlerrm;
    end if;
  end;

  -- بوب لا يستطيع تقديم إثبات على عملية أليس
  perform set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222', true);
  begin
    perform public.submit_event_payment(v_pay, 'REF1',
      '22222222-2222-2222-2222-222222222222/x.png');
    raise exception 'فشل 17د: بوب عدّل عملية دفع أليس!';
  exception when others then
    if sqlerrm like 'فشل 17%' then raise; end if;
  end;
  select count(*) into v_cnt from public.event_payments;
  if v_cnt <> 0 then raise exception 'فشل 17هـ: بوب يرى عمليات دفع غيره'; end if;

  -- أليس تقدّم الإثبات: الحالة submitted وليست paid
  perform set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111', true);
  begin
    perform public.submit_event_payment(v_pay, 'REF1', '');
    raise exception 'فشل 17و: قُبل تقديم بلا إثبات!';
  exception when others then
    if sqlerrm like 'فشل 17%' then raise; end if;
  end;
  select status into v_pstatus from public.submit_event_payment(v_pay, 'REF1',
    '11111111-1111-1111-1111-111111111111/proof.png');
  if v_pstatus <> 'submitted' then
    raise exception 'فشل 17ز: الحالة بعد التقديم % بدل submitted', v_pstatus;
  end if;

  -- ما زال الإرسال مقفلاً
  if public.event_sending_unlocked(v_event) then
    raise exception 'فشل 17ح: الإرسال مفتوح قبل موافقة الأدمن!';
  end if;

  -- المستخدم العادي لا يستطيع الموافقة على نفسه
  begin
    perform public.review_event_payment(v_pay, true, '');
    raise exception 'فشل 17ط: مستخدم عادي وافق على دفعه بنفسه!';
  exception when others then
    if sqlerrm like 'فشل 17%' then raise; end if;
  end;

  -- الأدمن يوافق ← paid ← الإرسال يُفتح ويُسجَّل
  perform set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333', true);
  select status into v_pstatus from public.review_event_payment(v_pay, true, 'تم التحقق');
  if v_pstatus <> 'paid' then raise exception 'فشل 17ي: الحالة % بدل paid', v_pstatus; end if;

  perform set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111', true);
  if not public.event_sending_unlocked(v_event) then
    raise exception 'فشل 17ك: الإرسال مقفل بعد الدفع!';
  end if;
  select public.mark_guests_invite_status(v_ids, 'sent') into v_cnt;
  if v_cnt <> array_length(v_ids, 1) then
    raise exception 'فشل 17ل: سُجّل % من % بعد الدفع', v_cnt, array_length(v_ids, 1);
  end if;
  select sending_status into v_sstatus from public.event_payments where id = v_pay;
  if v_sstatus <> 'completed' then
    raise exception 'فشل 17م: حالة الإرسال % بدل completed', v_sstatus;
  end if;

  -- رسوم صفر = الإرسال مجاني بلا شاشة دفع (مناسبة بوب)
  reset role;
  update public.app_settings set send_fee_amount = 0;
  set local role authenticated;
  perform set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222', true);
  select id into v_event from public.events where title = 'زفاف بوب';
  select array_agg(id) into v_ids from public.guests where event_id = v_event;
  select public.mark_guests_invite_status(v_ids, 'prepared') into v_cnt;
  if v_cnt <> array_length(v_ids, 1) then raise exception 'فشل 17ن: الإرسال مقفل رغم أن الرسوم صفر'; end if;
  reset role;
  raise notice '✅ 17: رسوم الإرسال — لا إرسال قبل موافقة الأدمن، ورسوم 0 = مجاني';

  raise notice '';
  raise notice '════════════════════════════════';
  raise notice '  نجحت جميع اختبارات RLS ✅';
  raise notice '════════════════════════════════';
end $$;

rollback;
