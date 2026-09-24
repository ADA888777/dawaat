-- 0005 — توحيد أرقام جوال المدعوين على مستوى قاعدة البيانات
--
-- المشكلة: نفس الشخص كان يُخزَّن بصيغ مختلفة (05… و +966… و 5…)، فقيد
-- unique(event_id, phone) لا يكشف التكرار، وتتضاعف الدعوات.
-- الحل: دالة توحيد واحدة + trigger قبل الإدخال/التعديل، فأي مصدر (الموقع،
-- الاستيراد، رد الضيف عبر RPC) يُخزَّن بنفس الصيغة: +9665XXXXXXXX.
-- نفس القواعد موجودة في الواجهة: src/artifacts/invites/src/lib/phone.ts

create or replace function public.normalize_sa_phone(p text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  s text := btrim(translate(coalesce(p, ''),
    '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'));
  has_plus boolean := left(s, 1) = '+';
  d text := regexp_replace(s, '\D', '', 'g');
begin
  if d = '' then
    return '';
  end if;
  if not has_plus and left(d, 2) = '00' then
    d := substr(d, 3);
    has_plus := true;
  end if;

  if d ~ '^05[0-9]{8}$' then return '+966' || substr(d, 2); end if;
  if not has_plus and d ~ '^5[0-9]{8}$' then return '+966' || d; end if;
  if d ~ '^9665[0-9]{8}$' then return '+' || d; end if;
  if d ~ '^96605[0-9]{8}$' then return '+966' || substr(d, 5); end if;

  return case when has_plus then '+' || d else d end;
end;
$$;

create or replace function public.guests_normalize_phone()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.phone := public.normalize_sa_phone(new.phone);
  return new;
end;
$$;

drop trigger if exists guests_normalize_phone on public.guests;
create trigger guests_normalize_phone
  before insert or update of phone on public.guests
  for each row execute function public.guests_normalize_phone();

-- توحيد البيانات الحالية. الصف الذي سيصطدم بنسخة أخرى لنفس الشخص في نفس
-- المناسبة لا يُعدَّل هنا (لا نحذف أي بيانات تلقائياً)؛ استعلام الفحص بالأسفل يُظهره.
update public.guests g
   set phone = public.normalize_sa_phone(g.phone)
 where g.phone is distinct from public.normalize_sa_phone(g.phone)
   and not exists (
     select 1 from public.guests o
      where o.event_id = g.event_id
        and o.id <> g.id
        and public.normalize_sa_phone(o.phone) = public.normalize_sa_phone(g.phone)
   );

-- فحص: يجب أن يعيد 0 صفوف
-- select event_id, public.normalize_sa_phone(phone), count(*)
--   from public.guests group by 1, 2 having count(*) > 1;
