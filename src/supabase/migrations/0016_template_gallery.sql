-- 0016: معرض القوالب
--   ١. تصنيفات جديدة: تهنئة، عزاء، ترقية
--   ٢. ترتيب ظهور القوالب يتحكم فيه الأدمن من اللوحة
-- آمنة لإعادة التنفيذ. نفّذها مرة واحدة كاملة في SQL Editor.

-- قيم enum تُضاف خارج أي استخدام لها في نفس المعاملة، ولهذا هي أول الملف.
alter type public.event_category add value if not exists 'congratulation';
alter type public.event_category add value if not exists 'condolence';
alter type public.event_category add value if not exists 'promotion';

alter table public.templates
  add column if not exists sort_order integer not null default 0;

comment on column public.templates.sort_order is
  'ترتيب ظهور القالب للمستخدم — الأصغر أولاً، ثم id عند التساوي';

-- القوالب تُقرأ مرتّبة في كل صفحة، فالفهرس يغطي الترتيب كاملاً
create index if not exists templates_sort_idx
  on public.templates (sort_order, id);
