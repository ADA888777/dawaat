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
├── mobile/                    ← تطبيق iOS/Android (Capacitor) + ملحق جهات الاتصال الأصلي
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
src/supabase/migrations/0008_admin_panel.sql
src/supabase/migrations/0009_announcement_cards.sql
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

### شريط الإعلانات — الهجرتان 0007 و0009

- بطاقة أنيقة بألوان العلامة (أيقونة أو صورة + عنوان + وصف مختصر + زر اختياري)،
  وليست نصاً متحركاً. تظهر في **الصفحة الرئيسية العامة** أسفل قسم البطل، وفي
  **لوحة العميل فوق «نظرة عامة»** مباشرة.
- أكثر من إعلان ← انتقال تلقائي كل مدة يحددها الأدمن (5 ثوانٍ افتراضاً) بحركة
  Fade + Slide ونقاط أسفل البطاقة، ويتوقف عند تمرير المؤشر أو التركيز أو إخفاء
  التبويب، ويثبت لمن يفضّل تقليل الحركة. إعلان واحد ← ثابت بلا نقاط.
  لا إعلانات ظاهرة ← لا يُرسم شيء ولا تبقى مساحة فارغة. كل الشرائح في خلية شبكة
  واحدة فارتفاع البطاقة ثابت ولا يقفز المحتوى تحتها.
- جدول `announcements`: `title`, `description`, `image_url`, `icon`, `button_text`,
  `button_url`, `active`, `sort_order` (الأولوية)، `starts_at`, `ends_at`,
  `audience`, `show_on_home`, `show_on_dashboard`, `created_at`. الحقلان القديمان
  `text`/`link` باقيان للتوافق ويُنقل محتواهما تلقائياً.
- الظهور (الجدولة + الفئة) يُفرض في سياسة RLS عبر `announcement_visible`، فلا يصل
  للزائر أو المستخدم إلا ما يحق له رؤيته.

### لوحة الأدمن الكاملة — `/admin/<القسم>` (الهجرة 0008)

الأقسام: نظرة عامة وتقارير الاستخدام، المستخدمون والاشتراكات (User/Admin، منح باقة
مدفوعة يدوياً)، الباقات والرسوم (حد المناسبات المجانية، سعر الباقة، رسوم الإرسال
والبنك)، المدفوعات (قبول/رفض الإثباتات)، المناسبات، المدعوون والإحصائيات، القوالب
والثيمات، الإعلانات، بيانات التواصل، السياسات والمحتوى، الميزات (تفعيل/تعطيل:
استيراد جهات الاتصال، QR، إرسال واتساب، صفحة الباقات، شريط الإعلانات، ردود
المدعوين — `app_settings.feature_flags`)، وإعدادات الموقع.

**الأمان في قاعدة البيانات لا في الواجهة:** كل جدول إداري محمي بـ RLS تتحقق من
`is_admin()`، والعمليات الحسّاسة (الباقات، حد المناسبات، مراجعة المدفوعات) دوال
`security definer` ترفض غير الأدمن بـ `ADMIN_ONLY`، وتريجر `protect_profile_columns`
يمنع أي مستخدم من تعديل دوره أو باقته. اختبارات RLS 17–20 تثبت ذلك في CI.

---

## تطبيق iOS / Android وجهات الاتصال — `mobile/`

الموقع هو المنتج، والتطبيق غلاف Capacitor يحمّل `https://dawaatly.top` نفسه
(نفس الحسابات والبيانات) ويضيف **منتقي جهات الاتصال الأصلي** لإضافة المدعوين
من جوال المستخدم. البناء والتفاصيل في [`mobile/README.md`](mobile/README.md).

ما يعمل فعلاً في كل منصة عند الضغط على «جهات الاتصال» في صفحة المناسبة:

| المنصة | الطريقة | اختيار متعدد |
|---|---|---|
| تطبيق iPhone | منتقي النظام (`CNContactPickerViewController`) — بلا إذن | نعم |
| تطبيق Android | قراءة جهات الاتصال بإذن ← قائمة تحديد وبحث داخل النافذة (وبلا إذن: منتقي النظام لجهة واحدة) | نعم |
| Android Chrome/Edge (ويب) | Contact Picker API | نعم |
| iPhone Safari (ويب) | **تعبئة تلقائية** من جهات الاتصال: حقل اسم وحقل جوال (`autocomplete="name"/"tel"`) يعبّئهما سفاري فوق لوحة المفاتيح ← «إضافة للقائمة» وتكرار | لا — جهة في كل مرة (حد النظام؛ لا توجد Web API لذلك). ملف VCF احتياطي لعشرات الأسماء دفعة واحدة |
| الكمبيوتر | VCF / CSV / لصق قائمة / إدخال يدوي | — |

الاكتشاف والتفرّع في `src/artifacts/invites/src/lib/contact-picker.ts`
(`getContactPickerSupport().via`: `native` / `web-api` / `autofill` / `none`)،
والواجهة في `components/contact-import-dialog.tsx`.

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
