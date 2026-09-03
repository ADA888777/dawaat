-- =====================================================================
--  هجرة ما قبل الإطلاق — تصحيح منطق الباقات والصلاحيات
--  تُنفَّذ بعد 0001. آمنة لإعادة التنفيذ.
--
--  تعالج ثلاث مخالفات للمتطلبات ظهرت في فحص ما قبل الإطلاق:
--    (أ) الباقة المجانية كانت تسمح بـ 3 مناسبات والمتفق عليه واحدة
--    (ب) حد الباقة كان يُطبَّق على الأدمن أيضاً
--    (ج) زر الترقية كان معطّلاً تماماً — التريجر يمنع الدالة من العمل
-- =====================================================================

begin;

-- ═════════════════════════════════════════════════════════════════════
-- (أ) الباقة المجانية = مناسبة واحدة
--     صفحة الباقات في التطبيق تعلن "إنشاء مناسبة واحدة" منذ البداية،
--     بينما قاعدة البيانات كانت تسمح بثلاث.
-- ═════════════════════════════════════════════════════════════════════
alter table public.profiles alter column events_limit set default 1;

alter table public.profiles disable trigger protect_profile_columns;
update public.profiles
   set events_limit = 1
 where plan = 'free' and role = 'user' and events_limit is distinct from 1;
-- الأدمن بلا حد
update public.profiles set events_limit = null where role = 'admin';
alter table public.profiles enable trigger protect_profile_columns;


-- ═════════════════════════════════════════════════════════════════════
-- (ب) الأدمن معفى من حد الباقة صراحةً
--     الاعتماد على events_limit = null وحده غير كافٍ: أي صف أدمن يُنشأ
--     لاحقاً سيأخذ القيمة الافتراضية 1 ويصبح محدوداً.
-- ═════════════════════════════════════════════════════════════════════
create or replace function public.enforce_events_limit()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_limit integer;
  v_role  text;
  v_count integer;
begin
  select events_limit, role into v_limit, v_role
    from public.profiles where id = new.user_id for update;

  -- الإدارة لا تخضع لأي حد
  if v_role = 'admin' then
    return new;
  end if;

  if v_limit is not null then
    select count(*) into v_count from public.events where user_id = new.user_id;
    if v_count >= v_limit then
      raise exception 'EVENTS_LIMIT_REACHED:%', v_limit;
    end if;
  end if;
  return new;
end;
$$;

-- الأدمن الجديد يُنشأ بلا حد
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, name, email, role, plan)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'), ''), new.email, 'مستخدم'),
    coalesce(new.email, ''),
    'user', 'free'   -- الدور ثابت: لا يُقرأ من metadata المستخدم أبداً
  )
  on conflict (id) do nothing;
  return new;
end;
$$;


-- ═════════════════════════════════════════════════════════════════════
-- (ج) إصلاح تعارض التريجر مع دوال الإدارة
--
--     السبب الجذري: protect_profile_columns يمنع تعديل plan و role،
--     لكنه كان يمنع أيضاً الدوال security definer المصرَّح لها بذلك،
--     فكان زر الترقية يفشل لكل مستخدم برسالة "غير مصرح".
--
--     الحل: علم جلسة يضبطه الكود الموثوق وحده. لا يستطيع العميل ضبطه
--     لأن set_config على متغير مخصص لا يمر عبر PostgREST.
-- ═════════════════════════════════════════════════════════════════════
create or replace function public.protect_profile_columns()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  -- استثناءان فقط:
  --  1) دالة موثوقة داخل قاعدة البيانات ضبطت العلم (admin_set_plan)
  --  2) طلب من الخادم بمفتاح service_role — لا جلسة مستخدم فيه.
  --     هذا آمن لأن سياسة RLS على profiles لا تسمح أصلاً لـ anon
  --     بالتحديث، فالحالة الوحيدة التي يكون فيها auth.uid() فارغاً
  --     هي استدعاء خلفي موثوق. وبدون هذا الاستثناء يستحيل تعيين
  --     أول أدمن أو إدارة الباقات من الخادم.
  if coalesce(current_setting('app.trusted_plan_change', true), '') <> 'on'
     and auth.uid() is not null
     and not public.is_admin() then
    if new.role is distinct from old.role
       or new.plan is distinct from old.plan
       or new.events_limit is distinct from old.events_limit
       or new.plan_start_date is distinct from old.plan_start_date
       or new.plan_end_date is distinct from old.plan_end_date then
      raise exception 'غير مصرح بتعديل بيانات الباقة أو الصلاحية';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;


-- ═════════════════════════════════════════════════════════════════════
-- الترقية الذاتية تُلغى: لا توجد بوابة دفع بعد.
--
-- الدالة القديمة كانت تمنح الباقة المدفوعة فوراً بلا أي دفع. إصلاح
-- عطلها دون ربطها بالدفع كان سيحوّلها إلى ثغرة: أي مستخدم يستدعيها
-- من API مباشرة ويحصل على مناسبات غير محدودة مجاناً.
-- ═════════════════════════════════════════════════════════════════════
create or replace function public.upgrade_my_subscription()
returns void
language plpgsql security definer set search_path = public
as $$
begin
  raise exception 'PAYMENT_NOT_AVAILABLE';
end;
$$;

-- بديل مؤقت حتى تجهز بوابة الدفع: الأدمن يمنح الباقة يدوياً.
create or replace function public.admin_set_plan(
  p_user_id uuid,
  p_plan text,
  p_months integer default 12
)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'هذه العملية متاحة للإدارة فقط';
  end if;
  if p_plan not in ('free', 'paid') then
    raise exception 'قيمة باقة غير صالحة';
  end if;

  perform set_config('app.trusted_plan_change', 'on', true);

  update public.profiles
     set plan            = p_plan,
         -- المدفوعة بلا حد، والمجانية مناسبة واحدة
         events_limit    = case when p_plan = 'paid' then null else 1 end,
         plan_start_date = case when p_plan = 'paid' then now() else null end,
         plan_end_date   = case when p_plan = 'paid'
                                then now() + make_interval(months => p_months)
                                else null end
   where id = p_user_id;

  perform set_config('app.trusted_plan_change', 'off', true);
end;
$$;

-- ═════════════════════════════════════════════════════════════════════
-- تضييق الصلاحيات: Supabase تمنح anon و authenticated صلاحية تنفيذ
-- على دوال public افتراضياً. الفحوص الداخلية تحمي فعلاً (مُختبَر)،
-- لكن سحب ما لا يُستدعى من العميل يقلّل سطح الهجوم.
-- ═════════════════════════════════════════════════════════════════════
revoke execute on function public.upgrade_my_subscription() from authenticated, anon;
revoke execute on function public.admin_set_plan(uuid, text, integer) from anon;
grant  execute on function public.admin_set_plan(uuid, text, integer) to authenticated;

-- دوال التريجر لا تُستدعى من العميل إطلاقاً
revoke execute on function public.handle_new_user() from anon, authenticated;
revoke execute on function public.protect_profile_columns() from anon, authenticated;
revoke execute on function public.enforce_events_limit() from anon, authenticated;
revoke execute on function public.touch_updated_at() from anon, authenticated;

commit;

-- =====================================================================
--  للتحقق بعد التنفيذ:
--    select role, plan, events_limit, count(*)
--      from public.profiles group by 1,2,3;
--    -- المتوقع: user/free/1  و  admin/free/null
-- =====================================================================
