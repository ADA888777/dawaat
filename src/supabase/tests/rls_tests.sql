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
  v_cnt int; v_limit int; v_count int; v_slug text; v_slug2 text;
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
  -- اختبار 7 [ع-5]: أُلغيت الباقات (0013) — لا حد لعدد المناسبات
  -- =================================================================
  select events_limit into v_limit from public.profiles
   where id = '22222222-2222-2222-2222-222222222222';
  if v_limit is not null then
    raise exception 'فشل 7: ما زال هناك حد % للمناسبات', v_limit;
  end if;

  select count(*) into v_count from public.events
   where user_id = '22222222-2222-2222-2222-222222222222';

  insert into public.events (user_id, title, category, event_date, location)
  values ('22222222-2222-2222-2222-222222222222','رابعة','general', now()+interval '5 days','جدة');
  insert into public.events (user_id, title, category, event_date, location)
  values ('22222222-2222-2222-2222-222222222222','خامسة','general', now()+interval '6 days','جدة');

  if (select count(*) from public.events
       where user_id = '22222222-2222-2222-2222-222222222222') <> v_count + 2 then
    raise exception 'فشل 7ب: لم تُضَف المناسبتان — المنع ما زال قائماً';
  end if;
  raise notice '✅ 7: لا حد لعدد المناسبات بعد إلغاء الباقات';

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
  update public.app_settings set send_fee_amount = 50, fee_base_amount = 50,
         fee_cover_image_amount = 0, fee_audio_amount = 0, fee_template_amount = 0;

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
  update public.app_settings set send_fee_amount = 0, fee_base_amount = 0;
  set local role authenticated;
  perform set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222', true);
  select id into v_event from public.events where title = 'زفاف بوب';
  select array_agg(id) into v_ids from public.guests where event_id = v_event;
  select public.mark_guests_invite_status(v_ids, 'prepared') into v_cnt;
  if v_cnt <> array_length(v_ids, 1) then raise exception 'فشل 17ن: الإرسال مقفل رغم أن الرسوم صفر'; end if;
  reset role;
  raise notice '✅ 17: رسوم الإرسال — لا إرسال قبل موافقة الأدمن، ورسوم 0 = مجاني';

  -- =================================================================
  -- اختبار 18 [إعلانات]: النشط يراه الجميع، والأدمن وحده يرى المعطّل ويعدّل
  -- =================================================================
  reset role;
  insert into public.announcements (text, active, sort_order) values
    ('عرض خاص', true, 1), ('إعلان مخفي', false, 2);

  set local role anon;
  select count(*) into v_cnt from public.announcements;
  if v_cnt <> 1 then raise exception 'فشل 18أ: الزائر يرى % إعلان بدل 1', v_cnt; end if;

  set local role authenticated;
  perform set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222', true);
  select count(*) into v_cnt from public.announcements;
  if v_cnt <> 1 then raise exception 'فشل 18ب: المستخدم يرى % إعلان بدل 1', v_cnt; end if;
  begin
    insert into public.announcements (text) values ('اختراق');
    raise exception 'فشل 18ج: مستخدم عادي أضاف إعلاناً!';
  exception when others then
    if sqlerrm like 'فشل 18%' then raise; end if;
  end;
  update public.announcements set text = 'اختراق';
  reset role;
  select count(*) into v_cnt from public.announcements where text = 'اختراق';
  if v_cnt <> 0 then raise exception 'فشل 18د: مستخدم عادي عدّل إعلاناً!'; end if;

  set local role authenticated;
  perform set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333', true);
  select count(*) into v_cnt from public.announcements;
  if v_cnt <> 2 then raise exception 'فشل 18هـ: الأدمن يرى % بدل 2', v_cnt; end if;
  update public.announcements set active = true where text = 'إعلان مخفي';
  insert into public.announcements (text, sort_order) values ('إعلان الأدمن', 3);
  delete from public.announcements where text = 'عرض خاص';
  reset role;
  select count(*) into v_cnt from public.announcements where active;
  if v_cnt <> 2 then raise exception 'فشل 18و: تعديلات الأدمن لم تُطبَّق (%)', v_cnt; end if;
  raise notice '✅ 18: الإعلانات — النشط للجميع، والإدارة للأدمن فقط';

  -- =================================================================
  -- اختبار 19 [إعلانات مجدولة/فئات]: الظهور يُفرض في قاعدة البيانات
  -- =================================================================
  reset role;
  delete from public.announcements;
  insert into public.announcements (text, active, sort_order, starts_at, ends_at, audience) values
    ('للجميع',          true, 1, null, null, 'all'),
    ('للزوار فقط',      true, 2, null, null, 'visitors'),
    ('للمسجلين فقط',    true, 3, null, null, 'users'),
    ('للباقة المدفوعة', true, 4, null, null, 'paid'),
    ('منتهٍ',           true, 5, now() - interval '2 days', now() - interval '1 day', 'all'),
    ('لم يبدأ',         true, 6, now() + interval '1 day', null, 'all');

  -- الزائر: بلا جلسة إطلاقاً (يُمسح معرّف الجلسة المتبقي من الاختبار السابق)
  perform set_config('request.jwt.claim.sub', '', true);
  set local role anon;
  select string_agg(text, ',' order by sort_order) into v_slug from public.announcements;
  if v_slug <> 'للجميع,للزوار فقط' then raise exception 'فشل 19أ: الزائر يرى: %', v_slug; end if;

  set local role authenticated;
  perform set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222', true);
  select string_agg(text, ',' order by sort_order) into v_slug from public.announcements;
  if v_slug <> 'للجميع,للمسجلين فقط' then raise exception 'فشل 19ب: المستخدم المجاني يرى: %', v_slug; end if;

  reset role;
  perform set_config('app.trusted_plan_change', 'on', true);
  update public.profiles set plan = 'paid' where id = '22222222-2222-2222-2222-222222222222';
  perform set_config('app.trusted_plan_change', '', true);
  set local role authenticated;
  perform set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222', true);
  select string_agg(text, ',' order by sort_order) into v_slug from public.announcements;
  if v_slug <> 'للجميع,للمسجلين فقط,للباقة المدفوعة' then
    raise exception 'فشل 19ج: المستخدم المدفوع يرى: %', v_slug;
  end if;

  perform set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333', true);
  select count(*) into v_cnt from public.announcements;
  if v_cnt <> 6 then raise exception 'فشل 19د: الأدمن يرى % بدل 6', v_cnt; end if;
  reset role;
  raise notice '✅ 19: جدولة الإعلانات وفئاتها تُفرض في RLS';

  -- =================================================================
  -- اختبار 20 [أمان الأدمن]: كل وظيفة إدارية مرفوضة للمستخدم العادي
  -- =================================================================
  set local role authenticated;
  perform set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222', true);

  begin
    insert into public.templates (name, category, preview_image) values ('اختراق','general','x');
    raise exception 'فشل 20أ: مستخدم عادي أضاف قالباً!';
  exception when others then
    if sqlerrm like 'فشل 20%' then raise; end if;
  end;

  update public.templates set name = 'اختراق';
  update public.app_settings set feature_flags = '{"hacked":true}'::jsonb, send_fee_amount = 0, fee_base_amount = 0;
  reset role;
  select count(*) into v_cnt from public.templates where name = 'اختراق';
  if v_cnt <> 0 then raise exception 'فشل 20ب: مستخدم عادي عدّل قالباً!'; end if;
  select count(*) into v_cnt from public.app_settings where feature_flags ? 'hacked';
  if v_cnt <> 0 then raise exception 'فشل 20ج: مستخدم عادي عدّل مفاتيح الميزات!'; end if;

  set local role authenticated;
  perform set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222', true);
  begin
    perform public.admin_set_free_limit(100, true);
    raise exception 'فشل 20د: مستخدم عادي غيّر حد الباقة المجانية!';
  exception when others then
    if sqlerrm like 'فشل 20%' then raise; end if;
    if sqlerrm <> 'ADMIN_ONLY' then raise exception 'فشل 20د: خطأ غير متوقع: %', sqlerrm; end if;
  end;
  begin
    perform public.admin_set_plan('22222222-2222-2222-2222-222222222222', 'paid', 12);
    raise exception 'فشل 20هـ: مستخدم عادي منح نفسه باقة مدفوعة!';
  exception when others then
    if sqlerrm like 'فشل 20%' then raise; end if;
  end;

  -- ولا يرى مستخدمين آخرين أو مدفوعاتهم أو مناسباتهم
  select count(*) into v_cnt from public.profiles;
  if v_cnt <> 1 then raise exception 'فشل 20و: المستخدم يرى % ملف بدل 1', v_cnt; end if;

  -- الأدمن يستطيع كل ذلك
  perform set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333', true);
  select public.admin_set_free_limit(2, true) into v_cnt;
  update public.app_settings set feature_flags = '{"qr_code":false}'::jsonb;
  reset role;
  select free_events_limit into v_limit from public.app_settings;
  if v_limit <> 2 then raise exception 'فشل 20ز: الأدمن لم يستطع تغيير الحد'; end if;
  select count(*) into v_cnt from public.app_settings where feature_flags ->> 'qr_code' = 'false';
  if v_cnt <> 1 then raise exception 'فشل 20ح: الأدمن لم يستطع تعديل مفاتيح الميزات'; end if;
  raise notice '✅ 20: الوظائف الإدارية محمية في قاعدة البيانات لا في الواجهة فقط';

  -- =================================================================
  -- اختبار 21 [بطاقات الإعلانات]: عنوان/وصف/زر وأماكن العرض
  -- =================================================================
  reset role;
  delete from public.announcements;
  insert into public.announcements (title, description, icon, button_text, button_url, show_on_home, show_on_dashboard)
  values ('عرض خاص', 'خصم على الباقة الماسية', 'gift', 'اعرف أكثر', '/subscription', true, false);

  select show_on_home::text || '|' || show_on_dashboard::text || '|' || icon || '|' || button_text
    into v_slug from public.announcements;
  if v_slug <> 'true|false|gift|اعرف أكثر' then
    raise exception 'فشل 21أ: القيم المحفوظة %', v_slug;
  end if;

  -- إعلان بلا عنوان ولا نص مرفوض
  begin
    insert into public.announcements (title) values ('   ');
    raise exception 'فشل 21ب: قُبل إعلان بلا محتوى!';
  exception when others then
    if sqlerrm like 'فشل 21%' then raise; end if;
  end;

  -- الافتراضي: يظهر في الموقع ولوحة العميل معاً
  insert into public.announcements (title) values ('إعلان افتراضي');
  select show_on_home::text || '|' || show_on_dashboard::text into v_slug
    from public.announcements where title = 'إعلان افتراضي';
  if v_slug <> 'true|true' then raise exception 'فشل 21ج: الافتراضي %', v_slug; end if;

  -- المستخدم العادي يقرأ ولا يكتب
  set local role authenticated;
  perform set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222', true);
  select count(*) into v_cnt from public.announcements;
  if v_cnt <> 2 then raise exception 'فشل 21د: المستخدم يرى % بدل 2', v_cnt; end if;
  begin
    update public.announcements set button_url = 'https://evil.test';
    if (select count(*) from public.announcements where button_url = 'https://evil.test') > 0 then
      raise exception 'فشل 21هـ: مستخدم عادي عدّل زر الإعلان!';
    end if;
  exception when others then
    if sqlerrm like 'فشل 21%' then raise; end if;
  end;
  reset role;
  raise notice '✅ 21: بطاقات الإعلانات — الحقول الجديدة وأماكن العرض والحماية';

  -- =================================================================
  -- اختبار 22 [استيراد جهات الاتصال بالرمز — الهجرة 0011]
  -- =================================================================
  reset role;
  select id into v_event from public.events where title = 'زفاف أليس';

  -- بوب لا يستطيع إنشاء رمز لمناسبة أليس
  set local role authenticated;
  perform set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222', true);
  begin
    perform public.create_contact_import_token(v_event);
    raise exception 'فشل 22أ: بوب أنشأ رمزاً لمناسبة أليس!';
  exception when others then
    if sqlerrm like 'فشل 22%' then raise; end if;
    if sqlerrm <> 'EVENT_NOT_OWNED' then raise exception 'فشل 22أ: خطأ غير متوقع %', sqlerrm; end if;
  end;

  -- أليس تنشئ رمزاً لمناسبتها
  perform set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111', true);
  select t.token into v_slug from public.create_contact_import_token(v_event) t;
  if v_slug is null or length(v_slug) < 32 then raise exception 'فشل 22ب: رمز غير صالح %', v_slug; end if;

  -- الاختصار (بلا جلسة = anon) يرسل جهات الاتصال بالرمز:
  -- توحيد الأرقام، تفضيل الجوال على الأرضي، تكرار داخل الدفعة، مدعو موجود مسبقاً، رقم غير صالح
  set local role anon;
  perform set_config('request.jwt.claim.sub','', true);
  select public.import_contacts_with_token(v_slug, jsonb_build_array(
      jsonb_build_object('name', 'سعود', 'phones', jsonb_build_array('0112345678', '٠٥٠١١١١١١١')),
      jsonb_build_object('name', 'نورة', 'phone', '+966 50 222 2222'),
      jsonb_build_object('name', 'نورة مكررة', 'phone', '0502222222'),
      jsonb_build_object('name', 'مدعو أليس القديم', 'phone', '0500000001'),
      jsonb_build_object('name', 'بلا رقم', 'phone', 'abc')
  ))::text into v_slug2;
  if v_slug2 not like '%"inserted": 2%' or v_slug2 not like '%"duplicates": 2%' or v_slug2 not like '%"skipped": 1%' then
    raise exception 'فشل 22ج: نتيجة الاستيراد %', v_slug2;
  end if;

  reset role;
  select count(*) into v_cnt from public.guests where event_id = v_event and phone in ('+966501111111', '+966502222222');
  if v_cnt <> 2 then raise exception 'فشل 22د: المدعوون المستوردون % بدل 2', v_cnt; end if;
  select count(*) into v_cnt from public.guests where event_id = v_event and phone = '+966112345678';
  if v_cnt <> 0 then raise exception 'فشل 22هـ: أُدخل الرقم الأرضي بدل الجوال!'; end if;

  -- الرمز يُستهلك: إعادة الإرسال مرفوضة
  set local role anon;
  begin
    perform public.import_contacts_with_token(v_slug, '[]'::jsonb);
    raise exception 'فشل 22و: قُبل الرمز مرتين!';
  exception when others then
    if sqlerrm like 'فشل 22%' then raise; end if;
    if sqlerrm <> 'TOKEN_USED' then raise exception 'فشل 22و: خطأ غير متوقع %', sqlerrm; end if;
  end;

  -- رمز عشوائي مرفوض
  begin
    perform public.import_contacts_with_token(repeat('a', 48), '[]'::jsonb);
    raise exception 'فشل 22ز: قُبل رمز مزيّف!';
  exception when others then
    if sqlerrm like 'فشل 22%' then raise; end if;
    if sqlerrm <> 'INVALID_TOKEN' then raise exception 'فشل 22ز: خطأ غير متوقع %', sqlerrm; end if;
  end;

  -- anon لا يقرأ جدول الرموز أصلاً (لا صلاحية على الجدول)؛ أليس تقرأ حالة رمزها فقط
  begin
    select count(*) into v_cnt from public.contact_import_tokens;
    if v_cnt <> 0 then raise exception 'فشل 22ح: anon يرى % رمزاً!', v_cnt; end if;
  exception when insufficient_privilege then
    null; -- المطلوب: الرفض
  end;
  set local role authenticated;
  perform set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222', true);
  select count(*) into v_cnt from public.contact_import_tokens;
  if v_cnt <> 0 then raise exception 'فشل 22ط: بوب يرى رموز أليس!'; end if;
  perform set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111', true);
  select imported_count into v_cnt from public.contact_import_status(v_slug);
  if v_cnt <> 2 then raise exception 'فشل 22ي: حالة الرمز % بدل 2', v_cnt; end if;
  reset role;
  raise notice '✅ 22: استيراد جهات الاتصال بالرمز — ملكية، توحيد، تفضيل الجوال، منع التكرار، استهلاك الرمز';

  -- ═══════════ 23) بوابة الدفع (بيلينك): السر المشترك يحمي تأكيد الدفع ═══════════
  reset role;
  -- رسوم إرسال فعلية حتى لا تُنشأ العملية مجانية
  update public.app_settings set send_fee_amount = 25, fee_base_amount = 25,
         fee_cover_image_amount = 0, fee_audio_amount = 0, fee_template_amount = 0 where id = true;
  -- الأدمن يضبط السر المشترك
  perform set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333', true);
  set local role authenticated;
  perform public.set_gateway_secret('shared-secret-for-tests-0123456789');

  -- مناسبة جديدة لأليس خاصة بهذا الاختبار (مناسبتها الأولى لها عملية دفع سابقة)
  reset role;
  insert into public.events (user_id, title, category, event_date, location)
  values ('11111111-1111-1111-1111-111111111111','زفاف أليس — اختبار البوابة','wedding',
          now()+interval '20 days','الرياض')
  returning id into v_event;

  -- أليس تطلب الدفع لمناسبتها ثم تربط فاتورة البوابة
  perform set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111', true);
  set local role authenticated;
  select (public.request_event_payment(v_event)).id into v_cnt;
  if v_cnt is null then raise exception 'فشل 23أ: لم تُنشأ عملية دفع'; end if;
  perform public.attach_gateway_payment(v_cnt, 'paylink', 'TXN-TEST-1');

  -- بوب لا يربط فاتورة بعملية أليس
  perform set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222', true);
  begin
    perform public.attach_gateway_payment(v_cnt, 'paylink', 'TXN-HACK');
    raise exception 'فشل 23ب: بوب ربط فاتورة بعملية غيره!';
  exception when others then
    if sqlerrm like 'فشل 23%' then raise; end if;
    if sqlerrm <> 'PAYMENT_NOT_FOUND' then raise exception 'فشل 23ب: خطأ غير متوقع %', sqlerrm; end if;
  end;

  -- الإرسال ما زال مقفلاً قبل التأكيد
  reset role;
  if public.event_sending_unlocked(v_event) then
    raise exception 'فشل 23ج: الإرسال انفتح قبل تأكيد الدفع!';
  end if;

  -- سر خاطئ مرفوض
  set local role anon;
  perform set_config('request.jwt.claim.sub','', true);
  begin
    perform public.confirm_gateway_payment('wrong-secret-wrong-secret-xx', 'TXN-TEST-1', 25);
    raise exception 'فشل 23د: قُبل سر خاطئ!';
  exception when others then
    if sqlerrm like 'فشل 23%' then raise; end if;
    if sqlerrm <> 'BAD_GATEWAY_SECRET' then raise exception 'فشل 23د: خطأ غير متوقع %', sqlerrm; end if;
  end;

  -- مبلغ أقل من المطلوب مرفوض
  begin
    perform public.confirm_gateway_payment('shared-secret-for-tests-0123456789', 'TXN-TEST-1', 5);
    raise exception 'فشل 23هـ: قُبل مبلغ أقل من المطلوب!';
  exception when others then
    if sqlerrm like 'فشل 23%' then raise; end if;
    if sqlerrm <> 'AMOUNT_MISMATCH' then raise exception 'فشل 23هـ: خطأ غير متوقع %', sqlerrm; end if;
  end;

  -- السر الصحيح والمبلغ الصحيح: يُعلَّم مدفوعاً وينفتح الإرسال
  select (public.confirm_gateway_payment('shared-secret-for-tests-0123456789', 'TXN-TEST-1', 25))->>'status'
    into v_slug;
  if v_slug <> 'paid' then raise exception 'فشل 23و: الحالة % بدل paid', v_slug; end if;

  -- تكرار الـ webhook لا يغيّر شيئاً (يُعاد إرساله حتى 10 مرات)
  select (public.confirm_gateway_payment('shared-secret-for-tests-0123456789', 'TXN-TEST-1', 25))->>'already'
    into v_slug2;
  if v_slug2 <> 'true' then raise exception 'فشل 23ز: لم يُكتشف التأكيد المكرر'; end if;

  reset role;
  if not public.event_sending_unlocked(v_event) then
    raise exception 'فشل 23ح: الإرسال لم ينفتح بعد تأكيد الدفع!';
  end if;

  -- anon لا يقرأ السر ولا جدول الإعدادات الخاص
  set local role anon;
  begin
    perform 1 from app_private.gateway_config;
    raise exception 'فشل 23ط: anon قرأ جدول الأسرار!';
  exception when others then
    if sqlerrm like 'فشل 23%' then raise; end if;
  end;

  reset role;
  update public.app_settings set send_fee_amount = 0, fee_base_amount = 0 where id = true;
  raise notice '✅ 23: بوابة الدفع — السر المشترك، تطابق المبلغ، منع تكرار الـ webhook، فتح الإرسال بعد الدفع';

  -- =================================================================
  -- اختبار 24 [تسعير]: السعر تراكمي بحسب المزايا، والدفعة التكميلية
  -- =================================================================
  reset role;
  update public.app_settings
     set fee_base_amount = 5, fee_cover_image_amount = 3,
         fee_audio_amount = 2, fee_template_amount = 0,
         send_fee_amount = 5
   where id = true;

  insert into public.events (user_id, title, category, event_date, location)
  values ('11111111-1111-1111-1111-111111111111','تسعير','general', now()+interval '20 days','الرياض')
  returning id into v_event;

  -- أ) مناسبة بلا مزايا = الأساس وحده
  if public.event_fee_amount(v_event) <> 5 then
    raise exception 'فشل 24أ: السعر الأساسي % بدل 5', public.event_fee_amount(v_event);
  end if;

  -- ب) إضافة صورة وصوت تجمع الأسعار
  update public.events set cover_image = 'covers/x.jpg', audio_file = 'audio/y.m4a'
   where id = v_event;
  if public.event_fee_amount(v_event) <> 10 then
    raise exception 'فشل 24ب: السعر التراكمي % بدل 10', public.event_fee_amount(v_event);
  end if;

  -- ج) طلب الدفع يأتي بالمبلغ الكامل، والإرسال مقفل
  set local role authenticated;
  perform set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111', true);
  select id, amount into v_pay, v_amount from public.request_event_payment(v_event);
  if v_amount <> 10 then
    raise exception 'فشل 24ج: مبلغ العملية % بدل 10', v_amount;
  end if;
  if public.event_sending_unlocked(v_event) then
    raise exception 'فشل 24د: الإرسال مفتوح قبل الدفع!';
  end if;

  -- د) بعد السداد الكامل يُفتح الإرسال
  reset role;
  update public.event_payments set status = 'paid', paid_at = now() where id = v_pay;
  if not public.event_sending_unlocked(v_event) then
    raise exception 'فشل 24هـ: الإرسال ما زال مقفلاً بعد السداد الكامل';
  end if;

  -- هـ) إضافة قالب مسعَّر بعد الدفع تقفل الإرسال وتولّد دفعة تكميلية بالفرق
  update public.app_settings set fee_template_amount = 4 where id = true;
  update public.events
     set template_id = (select id from public.templates order by id limit 1)
   where id = v_event;
  if public.event_fee_amount(v_event) <> 14 then
    raise exception 'فشل 24و: السعر بعد القالب % بدل 14', public.event_fee_amount(v_event);
  end if;
  if public.event_sending_unlocked(v_event) then
    raise exception 'فشل 24ز: ميزة مسعَّرة أُضيفت بعد الدفع بلا مقابل!';
  end if;

  set local role authenticated;
  perform set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111', true);
  select id, amount into v_pay2, v_amount from public.request_event_payment(v_event);
  if v_pay2 = v_pay then
    raise exception 'فشل 24ح: أُعيدت العملية المدفوعة بدل إنشاء دفعة تكميلية';
  end if;
  if v_amount <> 4 then
    raise exception 'فشل 24ط: الدفعة التكميلية % بدل 4 (الفرق)', v_amount;
  end if;

  reset role;
  update public.event_payments set status = 'paid', paid_at = now() where id = v_pay2;
  if not public.event_sending_unlocked(v_event) then
    raise exception 'فشل 24ي: الإرسال مقفل رغم سداد الفرق';
  end if;

  update public.app_settings
     set fee_base_amount = 5, fee_cover_image_amount = 3,
         fee_audio_amount = 2, fee_template_amount = 0, send_fee_amount = 0
   where id = true;
  raise notice '✅ 24: التسعير التراكمي — المزايا تُسعَّر من صف المناسبة، والإضافة بعد الدفع تتطلب دفعة تكميلية بالفرق';

  raise notice '';
  raise notice '════════════════════════════════';
  raise notice '  نجحت جميع اختبارات RLS ✅';
  raise notice '════════════════════════════════';
end $$;

rollback;
