-- =====================================================================
-- 0010 — شكل الإعلان: بطاقة أو صورة إعلانية كاملة
--
-- card   → البطاقة الحالية: أيقونة/صورة صغيرة + عنوان + وصف + زر.
-- banner → تصميم إعلاني جاهز: الصورة نفسها هي الإعلان بعرض الشريط كاملاً،
--          والعنوان يُستخدم نصاً بديلاً، وزر الرابط (إن وُجد) يجعل الصورة
--          كلها قابلة للضغط.
--
-- آمن لإعادة التنفيذ: لا يحذف بيانات ولا سياسات، والإعلانات القائمة تبقى «بطاقة».
-- =====================================================================

alter table public.announcements
  add column if not exists layout text not null default 'card';

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.announcements'::regclass
                    and conname = 'announcements_layout_chk') then
    alter table public.announcements
      add constraint announcements_layout_chk check (layout in ('card', 'banner'));
  end if;
end $$;

comment on column public.announcements.layout is
  'card = بطاقة (أيقونة/صورة صغيرة + نص)، banner = صورة إعلانية كاملة بعرض الشريط';
