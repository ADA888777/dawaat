-- =====================================================================
-- 0011 — استيراد جهات الاتصال عبر اختصار Apple Shortcuts (الآيفون)
--
-- التدفق: الموقع (مستخدم مسجّل) ينشئ رمزاً مؤقتاً لمناسبة بعينها ← يفتح
-- الاختصار ومعه الرمز ← الاختصار يختار جهات الاتصال ويرسل الأسماء والأرقام
-- إلى POST https://dawaatly.top/api/contacts/import مع الرمز ← الدالة هنا
-- تتحقق من الرمز (نفس المستخدم، نفس المناسبة، غير منتهٍ، لم يُستخدم) ثم
-- تُدخل المدعوين بنفس قواعد الموقع (توحيد +9665، تفضيل الجوال، منع التكرار)
-- وتستهلك الرمز.
--
-- الأمان: الرمز 64 خانة ست عشرية عشوائية (~244 بت)، صالح 15 دقيقة، يُستهلك مرة واحدة، ولا يُقبل إلا
-- للمناسبة التي أُنشئ لها. لا يحتاج الاختصار أي مفتاح سري — فقط الرمز.
-- آمن لإعادة التنفيذ.
-- =====================================================================

create table if not exists public.contact_import_tokens (
  id              bigint generated always as identity primary key,
  token           text        not null unique,
  user_id         uuid        not null references auth.users(id) on delete cascade,
  event_id        bigint      not null references public.events(id) on delete cascade,
  expires_at      timestamptz not null,
  used_at         timestamptz,
  imported_count  integer     not null default 0,
  duplicate_count integer     not null default 0,
  skipped_count   integer     not null default 0,
  created_at      timestamptz not null default now()
);

create index if not exists contact_import_tokens_event_idx on public.contact_import_tokens (event_id);
create index if not exists contact_import_tokens_expires_idx on public.contact_import_tokens (expires_at);

alter table public.contact_import_tokens enable row level security;

-- العميل يقرأ رموزه فقط (لمتابعة حالة الاستيراد)؛ الإنشاء والاستهلاك عبر الدوال فقط
drop policy if exists "import_tokens_select_own" on public.contact_import_tokens;
create policy "import_tokens_select_own" on public.contact_import_tokens
  for select using (user_id = (select auth.uid()));

revoke all on table public.contact_import_tokens from anon, authenticated;
grant select on table public.contact_import_tokens to authenticated;

-- ---------- 1) إنشاء رمز لمناسبة يملكها المستخدم ----------
create or replace function public.create_contact_import_token(p_event_id bigint)
returns table (token text, expires_at timestamptz)
language plpgsql security definer set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_token text;
  v_exp   timestamptz := now() + interval '15 minutes';
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;
  if not exists (select 1 from public.events e where e.id = p_event_id and e.user_id = v_uid) then
    raise exception 'EVENT_NOT_OWNED';
  end if;

  -- رمز واحد فعّال لكل مناسبة: القديم غير المستخدم يُلغى
  update public.contact_import_tokens t
     set expires_at = now()
   where t.event_id = p_event_id and t.used_at is null and t.expires_at > now();

  -- gen_random_uuid() مدمجة في pg_catalog (عشوائية قوية) فلا تعتمد على مسار
  -- امتداد pgcrypto الذي يقع في schema «extensions» على Supabase خارج search_path
  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into public.contact_import_tokens (token, user_id, event_id, expires_at)
  values (v_token, v_uid, p_event_id, v_exp);

  return query select v_token, v_exp;
end;
$$;

revoke all on function public.create_contact_import_token(bigint) from public, anon;
grant execute on function public.create_contact_import_token(bigint) to authenticated;

-- ---------- 2) الاستيراد بالرمز (يُستدعى من الاختصار عبر الـ API، بلا جلسة) ----------
-- p_contacts: [{ "name": "سعود", "phones": ["0501234567", "0112345678"] }, { "name": "...", "phone": "05…" }]
create or replace function public.import_contacts_with_token(p_token text, p_contacts jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_tok       public.contact_import_tokens%rowtype;
  v_item      jsonb;
  v_name      text;
  v_phone     text;
  v_candidate text;
  v_best      text;
  v_seen      text[] := '{}';
  v_rows      integer := 0;
  v_inserted  integer := 0;
  v_skipped   integer := 0;
  v_dup       integer := 0;
  v_ids       bigint[] := '{}';
  v_new_id    bigint;
begin
  if p_token is null or length(p_token) < 32 then
    raise exception 'INVALID_TOKEN';
  end if;

  select * into v_tok from public.contact_import_tokens where token = p_token for update;
  if not found then
    raise exception 'INVALID_TOKEN';
  end if;
  if v_tok.used_at is not null then
    raise exception 'TOKEN_USED';
  end if;
  if v_tok.expires_at <= now() then
    raise exception 'TOKEN_EXPIRED';
  end if;
  -- المناسبة ما زالت لصاحب الرمز نفسه
  if not exists (select 1 from public.events e where e.id = v_tok.event_id and e.user_id = v_tok.user_id) then
    raise exception 'EVENT_NOT_OWNED';
  end if;
  if p_contacts is null or jsonb_typeof(p_contacts) <> 'array' then
    raise exception 'BAD_PAYLOAD';
  end if;
  if jsonb_array_length(p_contacts) > 1000 then
    raise exception 'TOO_MANY_CONTACTS';
  end if;

  for v_item in select * from jsonb_array_elements(p_contacts) loop
    v_rows := v_rows + 1;
    if jsonb_typeof(v_item) <> 'object' then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    v_name := left(btrim(coalesce(v_item->>'name', '')), 100);
    v_best := null;

    -- الأرقام: مصفوفة phones أو نص phone واحد؛ نفضّل الجوال السعودي ثم أي رقم صالح
    for v_candidate in
      select x from (
        select jsonb_array_elements_text(case when jsonb_typeof(v_item->'phones') = 'array' then v_item->'phones' else '[]'::jsonb end) as x
        union all
        select v_item->>'phone'
      ) s where x is not null
    loop
      v_phone := public.normalize_sa_phone(v_candidate);
      if v_phone !~ '^\+?[0-9]{9,15}$' then
        continue;
      end if;
      if v_phone ~ '^\+9665[0-9]{8}$' then
        v_best := v_phone;
        exit; -- جوال سعودي: الأفضل، لا داعي للمتابعة
      end if;
      if v_best is null then
        v_best := v_phone;
      end if;
    end loop;

    if v_best is null then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    if v_best = any (v_seen) then
      v_dup := v_dup + 1; -- مكرر داخل الدفعة نفسها
      continue;
    end if;
    v_seen := array_append(v_seen, v_best);

    v_new_id := null;
    insert into public.guests (event_id, name, phone)
    values (v_tok.event_id, coalesce(nullif(v_name, ''), v_best), v_best)
    on conflict (event_id, phone) do nothing
    returning id into v_new_id;

    if v_new_id is null then
      v_dup := v_dup + 1; -- مدعو مسبقاً في هذه المناسبة: يبقى رده كما هو
    else
      v_inserted := v_inserted + 1;
      v_ids := array_append(v_ids, v_new_id);
    end if;
  end loop;

  update public.contact_import_tokens
     set used_at = now(), imported_count = v_inserted, duplicate_count = v_dup, skipped_count = v_skipped
   where id = v_tok.id;

  return jsonb_build_object(
    'ok', true,
    'event_id', v_tok.event_id,
    'received', v_rows,
    'inserted', v_inserted,
    'duplicates', v_dup,
    'skipped', v_skipped,
    'guest_ids', to_jsonb(v_ids)
  );
end;
$$;

revoke all on function public.import_contacts_with_token(text, jsonb) from public;
grant execute on function public.import_contacts_with_token(text, jsonb) to anon, authenticated;

-- ---------- 3) حالة الرمز لصاحبه (يستطلعها الموقع حتى تظهر الجهات فور وصولها) ----------
create or replace function public.contact_import_status(p_token text)
returns table (used_at timestamptz, expires_at timestamptz, imported_count integer,
               duplicate_count integer, skipped_count integer)
language sql stable security definer set search_path = public
as $$
  select t.used_at, t.expires_at, t.imported_count, t.duplicate_count, t.skipped_count
    from public.contact_import_tokens t
   where t.token = p_token and t.user_id = auth.uid();
$$;

revoke all on function public.contact_import_status(text) from public, anon;
grant execute on function public.contact_import_status(text) to authenticated;

-- ---------- 4) رابط اختصار دعوات (iCloud) يضبطه الأدمن ----------
alter table public.app_settings
  add column if not exists ios_shortcut_url text not null default '';

comment on column public.app_settings.ios_shortcut_url is
  'رابط iCloud لاختصار «Dawaat – Contacts» الذي يثبّته مستخدم الآيفون مرة واحدة؛ فارغ = يُعرض شرح التثبيت فقط';

-- تنظيف دوري خفيف: الرموز المنتهية منذ أكثر من يوم لا قيمة لها
delete from public.contact_import_tokens where expires_at < now() - interval '1 day';
