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
src/supabase/migrations/0006_send_fee_payments.sql
src/supabase/migrations/0007_announcements_ticker.sql
```

كل الهجرات آمنة لإعادة التنفيذ على المشروع الحالي (لا تحذف بيانات ولا سياسات).
`0003a` يُنشئ جدول `app_settings` (كان موجوداً في المشروع الحي دون ملف إنشاء).

أرقام جوال المدعوين تُخزَّن دائماً بالصيغة `+9665XXXXXXXX` (دالة `normalize_sa_phone`
وتريجر `guests_normalize_phone` من 0005)، وتُعرض في الواجهة بالصيغة `+966 5X XXX XXXX`.

### رسوم الإرسال (الدفع قبل الإرسال النهائي) — الهجرة 0006

- الأدمن يحدد المبلغ وبيانات التحويل البنكي من **الإعدادات ← رسوم إرسال الدعوات**.
  مبلغ `0` = الإرسال مجاني بلا شاشة دفع.
- عند الضغط على «إرسال الدعوات» تظهر شاشة الدفع: المبلغ ← التحويل البنكي ← رفع
  إثبات التحويل ← الحالة «بانتظار مراجعة الإدارة». الأدمن يوافق أو يرفض من
  **لوحة التحكم ← المدفوعات**، وبعد الموافقة فقط يُفتح الإرسال (ورمز QR ونسخ الروابط).
- الحماية في قاعدة البيانات: `mark_guests_invite_status` ترفض بـ `PAYMENT_REQUIRED`
  ما لم توجد عملية `paid` للمناسبة (جدول `event_payments`: المستخدم، المناسبة،
  المبلغ، الحالة، وقت الدفع، رقم العملية، حالة الإرسال). الإثباتات في bucket خاص
  `payment-proofs` تُعرض بروابط موقّتة للمالك والأدمن فقط.
- بوابة الدفع الإلكترونية غير مربوطة بعد؛ الأعمدة `method`/`provider`/`provider_ref`
  محجوزة لربطها لاحقاً بنفس التدفق والحالات دون تغيير الواجهة.

### شريط الإعلانات المتحرك — الهجرة 0007

- الأدمن يدير الإعلانات من **الإعدادات ← شريط الإعلانات المتحرك**: إضافة عدة إعلانات
  (نص + رابط اختياري)، ترتيبها بالأسهم، تفعيل/تعطيل كل إعلان، إظهار/إخفاء الشريط
  كله، وسرعة الحركة.
- جدول `announcements` بسياسة RLS: النشط يقرؤه الجميع، والأدمن وحده يرى المعطّل ويعدّل.
- يظهر أسفل الشاشة في واجهة الموقع العامة، وأعلى الصفحة داخل واجهة المستخدم،
  ولا يظهر في صفحات الدعوة العامة (`/invite/…`). لا يغطي المحتوى: يحجز مساحته من
  الصفحة، ويتوقف عند التمرير بالمؤشر، ويثبت لمن يفضّل تقليل الحركة.

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
