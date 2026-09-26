# دعوات — منصة دعوات إلكترونية

منصة لإنشاء دعوات رقمية أنيقة وإرسالها عبر واتساب وتتبع ردود المدعوين.
الموقع الحي: <https://dawaatly.top>

---

## محتوى المستودع

```
dawaat/
├── src/                       ← شيفرة المشروع الكاملة (pnpm workspace)
│   ├── artifacts/invites/     ← تطبيق دعوات (React + Vite + Supabase)
│   └── supabase/              ← المخطط والهجرات واختبارات RLS
├── .github/workflows/ci.yml   ← فحص الأنواع والبناء واختبارات أمان قاعدة البيانات
├── wrangler.jsonc             ← إعداد النشر على Cloudflare Workers
└── README.md
```

لا توجد نسخة مبنية داخل المستودع: Cloudflare يبني الموقع من `src/` عند كل دفع إلى `main`.

---

## النشر (Cloudflare Workers)

المستودع مربوط بـ Cloudflare Workers Builds، وأمر النشر الافتراضي `npx wrangler deploy`
يقرأ `wrangler.jsonc` في الجذر، فيبني التطبيق من `src/` ثم ينشر الناتج
(`src/artifacts/invites/dist/public`). أي دفع إلى `main` = نشر جديد.

متغيرات البناء المطلوبة في Cloudflare ← Settings ← Builds ← Variables:

| المتغير | القيمة |
|---|---|
| `VITE_SUPABASE_ANON_KEY` | مفتاح **anon public** من Supabase ← Settings ← API (وليس service_role أبداً) — إلزامي، البناء يتوقف بدونه |
| `VITE_SUPABASE_URL` | اختياري — رابط المشروع مكتوب أصلاً في `public/config.js` |

---

## إعداد قاعدة البيانات (Supabase)

لمشروع جديد نفّذ بالترتيب من SQL Editor:

```
src/supabase/schema.sql
src/supabase/migrations/0001_security_and_integrity_fixes.sql
src/supabase/migrations/0002_prelaunch_plan_fixes.sql
src/supabase/migrations/0003_guest_invite_flow.sql
src/supabase/migrations/0003a_create_app_settings.sql
src/supabase/migrations/0004_contact_info_settings.sql
src/supabase/migrations/0005_normalize_guest_phones.sql
```

كل الهجرات آمنة لإعادة التنفيذ على المشروع الحالي (لا تحذف بيانات ولا سياسات).
`0003a` يُنشئ جدول `app_settings` (كان موجوداً في المشروع الحي دون ملف إنشاء).

أرقام جوال المدعوين تُخزَّن دائماً بالصيغة `+9665XXXXXXXX` (دالة `normalize_sa_phone`
وتريجر `guests_normalize_phone` من 0005)، وتُعرض في الواجهة بالصيغة `+966 5X XXX XXXX`.

---

## التطوير والبناء محلياً

```bash
cd src
pnpm install
pnpm run typecheck
pnpm --filter @workspace/invites build
# النتيجة في: src/artifacts/invites/dist/public
```

إعداد Supabase أثناء التشغيل يُقرأ من `src/artifacts/invites/public/config.js`.

---

## الاختبارات

- **CI** (`.github/workflows/ci.yml`) يعمل على كل دفع وطلب دمج:
  فحص الأنواع، البناء، تدقيق ثغرات الاعتماديات، ثم اختبارات RLS على Postgres 16
  بعد تطبيق المخطط وكل الهجرات (مرتين للتأكد أنها قابلة لإعادة التنفيذ).
- **اختبارات RLS محلياً:**

```bash
cd src
psql "$DB" -f supabase/tests/supabase_stub.sql
psql "$DB" -f supabase/schema.sql
for f in supabase/migrations/*.sql; do psql "$DB" -f "$f"; done
psql "$DB" -f supabase/tests/rls_tests.sql
```

---

## التقنيات

- **Frontend:** React 19 + TypeScript + Vite + Tailwind CSS
- **Backend:** Supabase (Auth + Postgres + Storage)
- **Hosting:** Cloudflare Workers
