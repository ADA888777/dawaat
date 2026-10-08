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
├── worker/                    ← Worker: جهات الاتصال + بوابة الدفع (المفاتيح السرية هنا)
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
(`src/artifacts/invites/dist/public`) مع Worker صغير (`worker/index.ts`). أي دفع إلى `main` = نشر جديد.

الـ Worker يخدم مسارات `/api/*` وحدها ويترك كل ما عداها للأصول الثابتة كما كان:
`POST /api/contacts/import` (استقبال جهات الاتصال من اختصار الآيفون — انظر قسم
جهات الاتصال)، ومسارات بوابة الدفع الثلاثة `POST /api/pay/create` و
`GET /api/pay/return` و`POST /api/pay/webhook` (انظر قسم بوابة الدفع)، و`GET /api/health`.
المسارات الداخلية للتطبيق (`/events/12` …) تُعاد لها `index.html` (سلوك SPA) كما في السابق.

`wrangler.jsonc` يضبط `"run_worker_first": ["/api/*"]`. هذا **حاسم**: طلب التنقّل
(`Sec-Fetch-Mode: navigate`) — مثل عودة العميل من صفحة المزوّد إلى `/api/pay/return` —
كانت طبقة الأصول تبتلعه وتعيد `index.html` بسلوك `not_found_handling` قبل أن يصل
الـ Worker إطلاقاً، فلا يُؤكَّد الدفع أبداً. القاعدة محدودة بـ `/api/*` فلا تتأثر بقية الأصول.

لا يحتاج الـ Worker أي متغير تشغيل: البناء يكتب `runtime-config.json` بجانب الحزمة
(العنوان ومفتاح **anon public** نفسه المضمّن أصلاً في حزمة JavaScript لكل زائر — وليس
service_role أبداً) ويقرأه الـ Worker عبر ربط `ASSETS`. اختيارياً يمكن تجاوزه بمتغيري
التشغيل `SUPABASE_URL` / `SUPABASE_ANON_KEY` (Settings ← Variables and Secrets؛
`keep_vars: true` يحفظهما عبر عمليات النشر). إن غاب الاثنان يردّ `/api/contacts/import`
بـ 503 `NOT_CONFIGURED`.

متغيرات البناء المطلوبة في Cloudflare ← Settings ← Builds ← Variables:

| المتغير | القيمة |
|---|---|
| `VITE_SUPABASE_ANON_KEY` | مفتاح **anon public** من Supabase ← Settings ← API (وليس service_role أبداً) — إلزامي، البناء يتوقف بدونه |
| `VITE_SUPABASE_URL` | اختياري — رابط المشروع مكتوب أصلاً في `public/config.js` |

**معاينات الفروع (Worker Previews):** كل فرع/طلب دمج يبنيه Cloudflare بأمر
`npx wrangler preview` (يظهر في GitHub كفحص «Workers Builds: dawaat»). يتطلب ذلك
كتلة `"previews": {}` في `wrangler.jsonc` (موجودة)، وأن تكون متغيرات البناء نفسها
مضافة في Cloudflare ← Settings ← Builds ← تبويب **Previews Base** (زر Import ينسخها
من Production) — بدونها يتوقف البناء برسالة `add VITE_SUPABASE_ANON_KEY`.
تُنسخ متغيرات Previews Base إلى معاينة الفرع **عند إنشائها فقط**؛ فرع أُنشئت معاينته
قبل إضافتها يُحذف من قائمة البيئات (Production ▾ ← اسم الفرع ← Settings ← Delete)
ليُعاد إنشاؤه بالمتغيرات مع الدفعة التالية.

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
src/supabase/migrations/0010_announcement_layout.sql
src/supabase/migrations/0011_contact_import_tokens.sql
src/supabase/migrations/0012_paylink_gateway.sql
src/supabase/migrations/0013_feature_pricing.sql
```

كل الهجرات آمنة لإعادة التنفيذ على المشروع الحالي (لا تحذف بيانات ولا سياسات).
`0003a` يُنشئ جدول `app_settings` (كان موجوداً في المشروع الحي دون ملف إنشاء).

أرقام جوال المدعوين تُخزَّن دائماً بالصيغة `+9665XXXXXXXX` (دالة `normalize_sa_phone`
وتريجر `guests_normalize_phone` من 0005)، وتُعرض في الواجهة بالصيغة `+966 5X XXX XXXX`.

### رسوم الإرسال (الدفع قبل الإرسال النهائي) — الهجرتان 0006 و0013

**لا باقات ولا حد لعدد المناسبات** (أُلغيت في 0013). الدخل من رسوم الإرسال وحدها،
وتُحسب **تراكمياً** من المزايا التي استخدمها العميل فعلاً في المناسبة:

| البند | الافتراضي |
|---|---|
| الأساس — إنشاء الدعوة وإرسالها | ٥ ريال |
| + صورة الغلاف | ٣ ريال |
| + التسجيل الصوتي | ٢ ريال |
| + القالب المميز | ٠ |

الأساس ٥ لأن **الحد الأدنى لفاتورة بيلينك ٥ ريالات** — أي مبلغ أقل لا يمكن دفعه
بالبطاقة أصلاً، فيُخفى زر البطاقة ويبقى التحويل البنكي.

- الأسعار تُضبط من **الإعدادات ← رسوم إرسال الدعوات**. كلها `0` = الإرسال مجاني
  بلا شاشة دفع.
- المزايا تُقرأ في `event_fee_amount()` من **صف المناسبة نفسه**، لا مما يرسله
  المتصفح، فلا يمكن تخفيض السعر من الواجهة.
- `event_sending_unlocked()` تقارن **مجموع المدفوع** بالمطلوب الحالي، فمن دفع ٥
  ثم أضاف صورة يُطالَب بالفرق عبر دفعة تكميلية — ولا يُفتح الإرسال قبل سدادها.
- العميل يرى تقدير السعر مفصّلاً **أثناء إنشاء المناسبة** لا بعدها، وتفصيلاً كاملاً
  في شاشة الدفع.
- عند الضغط على «إرسال الدعوات» تظهر شاشة الدفع: المبلغ ← التحويل البنكي ← رفع
  إثبات التحويل ← الحالة «بانتظار مراجعة الإدارة». الأدمن يوافق أو يرفض من
  **لوحة التحكم ← المدفوعات**، وبعد الموافقة فقط يُفتح الإرسال (ورمز QR ونسخ الروابط).
- الحماية في قاعدة البيانات: `mark_guests_invite_status` ترفض بـ `PAYMENT_REQUIRED`
  ما لم توجد عملية `paid` للمناسبة (جدول `event_payments`: المستخدم، المناسبة،
  المبلغ، الحالة، وقت الدفع، رقم العملية، حالة الإرسال). الإثباتات في bucket خاص
  `payment-proofs` تُعرض بروابط موقّتة للمالك والأدمن فقط.
- بوابة الدفع الإلكترونية (بيلينك) مربوطة عبر الأعمدة `method`/`provider`/`provider_ref`
  بنفس التدفق والحالات — انظر القسم التالي. التحويل البنكي يبقى كما هو بالتوازي.

### بوابة الدفع بالبطاقة — الهجرات 0012 و0014

الدفع بالبطاقة (مدى/فيزا/ماستركارد/Apple Pay) بالتوازي مع التحويل البنكي، على نفس
جدول `event_payments` ونفس الحالات، فلا تتغير لوحة المدفوعات ولا شرط فتح الإرسال.

**مزوّدان بنفس العقد.** المنطق المشترك في `worker/gateway-common.ts`، وكل مزوّد ملف
يصدّر نفس ثلاث الدوال (`handlePayCreate` / `handlePayReturn` / `handlePayWebhook`):

| | بيلينك `worker/paylink.ts` | ميسر `worker/moyasar.ts` |
|---|---|---|
| المصادقة | `/api/auth` ← رمز مؤقت | HTTP Basic بالمفتاح السري وكلمة مرور فارغة |
| إنشاء الفاتورة | `POST /api/addInvoice` | `POST /v1/invoices` |
| وحدة المبلغ | ريالات | **هللات** (عدد صحيح) |
| الحد الأدنى | ٥ ريالات | **ريال واحد** |
| التحقق | `GET /api/getInvoice/{no}` | `GET /v1/invoices/{id}` |
| توقيع الإشعار | لا يوجد | لا يوجد — سر مشترك في جسم الطلب (`secret_token`) |

الاختيار بمتغير `PAYMENT_PROVIDER` في Cloudflare (`paylink` أو `moyasar`). إن غاب،
يُختار المزوّد المهيأ مفاتيحه. الحد الأدنى الذي **تعرضه الواجهة** يأتي من
`app_settings.payment_gateway_min_amount` (الهجرة 0014)، وكل مزوّد يفرض حدّه بنفسه
في الـ Worker أياً كان الإعداد.

**التدفق** (واحد للمزوّدين)

1. العميل يضغط «ادفع بالبطاقة» ← `POST /api/pay/create` بجلسة المستخدم
   (`Authorization: Bearer <jwt>`).
2. الـ Worker ينشئ/يجلب العملية بجلسة المستخدم عبر `request_event_payment`، ثم ينشئ
   فاتورة عند المزوّد ويربط رقمها بالعملية عبر `attach_gateway_payment`، ويعيد رابط
   صفحة الدفع. المبلغ دون حد المزوّد يُرد بـ `AMOUNT_TOO_SMALL` قبل أي نداء خارجي.
3. بعد الدفع يعود العميل إلى `GET /api/pay/return` (ثم يُحوَّل إلى
   `/events/<id>?payment=paid|pending`)، ويستدعي المزوّد `POST /api/pay/webhook`
   خادماً لخادم.
4. في الحالتين **يتحقق الـ Worker من المزوّد مباشرة** ثم ينادي
   `confirm_gateway_payment` بالمبلغ الحقيقي كما أعاده المزوّد.

**الأمان**

- مفاتيح المزوّد لا تخرج من الـ Worker: الواجهة لا تعرف منها شيئاً، ولا يظهر اسم أي
  متغير بيئة في أي رسالة تصل للعميل — التفصيل التقني في `console.error` وحده.
- لا يملك المتصفح ولا حمولة الـ webhook صلاحية تعليم عملية كـ«مدفوعة»:
  `confirm_gateway_payment` تتطلب سراً مشتركاً مخزّناً في `app_private.gateway_config`
  (لا صلاحية لـ `anon`/`authenticated` عليه ولا تعيده أي دالة)، فلا يكفي مفتاح
  anon العام وحده. حالة الفاتورة ومبلغها يُقرآن من المزوّد لا من الطلب الوارد.
- تطابق المبلغ مفروض في SQL (`AMOUNT_MISMATCH` إن قل عن المطلوب)، والتأكيد
  **idempotent** فإعادة إرسال الـ webhook (١٠ مرات في بيلينك، ٥ في ميسر) لا تكرر شيئاً.
- إشعار ميسر المسجَّل يُتحقَّق منه بمقارنة ثابتة الزمن على `secret_token`؛ وإشعار
  `callback_url` للفاتورة لا يحمل سراً، فلا نأخذ منه إلا رقم الفاتورة ثم نسأل ميسر.
- `/api/pay/webhook` يرد 503 عند فشل التحقق ليعيد المزوّد المحاولة، و200 عند النجاح.
- لا يوجد أي مفتاح `service_role` في أي مكان.

**أخطاء `/api/pay/create` كما يراها العميل** (الرسالة عربية دائماً وبلا تفاصيل تقنية)

| الرمز | المعنى | ما تفعله الإدارة |
|---|---|---|
| `GATEWAY_NOT_CONFIGURED` | لا مفاتيح للمزوّد | أضف مفاتيح المزوّد في Cloudflare |
| `GATEWAY_AUTH` | المفاتيح مرفوضة | حدّث المفاتيح من لوحة المزوّد |
| `GATEWAY_NOT_ACTIVE` | الحساب لم يُفعَّل للمدفوعات الحقيقية | أكمل تفعيل الحساب عند المزوّد |
| `AMOUNT_TOO_SMALL` | المبلغ دون حد المزوّد | ارفع الأسعار أو اكتفِ بالتحويل البنكي |
| `GATEWAY_UNAVAILABLE` | خطأ آخر من المزوّد | راجع سجلات الـ Worker |

**خطوات التشغيل (مرة واحدة)**

1. **Supabase ← SQL Editor:** نفّذ `0012_paylink_gateway.sql` ثم
   `0014_gateway_min_amount.sql` (كلتاهما آمنة لإعادة التنفيذ).
2. وَلّد سراً مشتركاً عشوائياً (٣٢ حرفاً على الأقل): `openssl rand -hex 32`.
3. **Cloudflare ← Workers ← dawaat ← Settings ← Variables and Secrets** — أضفها
   كـ **Secret** (وليس Text):

   | المتغير | القيمة |
   |---|---|
   | `GATEWAY_SHARED_SECRET` | السر المشترك المولَّد في الخطوة ٢ (للمزوّدين) |
   | `PAYMENT_PROVIDER` | `moyasar` أو `paylink` |
   | `MOYASAR_SECRET_KEY` | ميسر — `sk_test_…` للتجربة، `sk_live_…` بعد التفعيل |
   | `MOYASAR_WEBHOOK_SECRET` | ميسر — نفس `secret_token` المسجَّل في لوحتهم |
   | `PAYLINK_API_ID` | بيلينك — API ID من `my.paylink.sa/private/api-keys` |
   | `PAYLINK_SECRET_KEY` | بيلينك — Secret Key من نفس الصفحة |
   | `PAYLINK_BASE` | بيلينك — اختياري، `https://restpilot.paylink.sa` للتجربة |

4. **Supabase ← SQL Editor** بحساب أدمن: `select public.set_gateway_secret('<نفس السر>');`
   (ترفض أقل من ٢٤ حرفاً، ولا تنفّذها إلا من حساب أدمن.)
5. **لوحة المزوّد ← Webhooks:** الرابط `https://dawaatly.top/api/pay/webhook`.
   في ميسر: أضف Webhook وفعّل `payment_paid` و`payment_failed`، وضع نفس قيمة
   `MOYASAR_WEBHOOK_SECRET` في خانة Secret Token.
6. **الموقع ← الإعدادات ← رسوم إرسال الدعوات:** فعّل «الدفع بالبطاقة»، واكتب اسم
   المزوّد كما يظهر للعميل، واضبط «أقل مبلغ يقبله المزوّد» (ميسر ١، بيلينك ٥).

إن غابت مفاتيح المزوّد يرد `/api/pay/create` بـ 503 `GATEWAY_NOT_CONFIGURED`، وإن غاب
`GATEWAY_SHARED_SECRET` لا يُؤكَّد أي دفع (يبقى `pending`) بدل أن يُعلَّم مدفوعاً بغير تحقق.

### شريط الإعلانات — الهجرات 0007 و0009 و0010

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
- شكلان للإعلان (`layout`، الهجرة 0010): **بطاقة** (أيقونة أو صورة صغيرة + عنوان
  ووصف وزر) أو **صورة إعلانية كاملة** — تصميم جاهز يُرفع من الجهاز ويُعرض بعرض
  الشريط كاملاً (الأنسب 1200×400)، ويصبح كله قابلاً للضغط إن أُضيف رابط. الصور
  تُرفع من لوحة الأدمن إلى bucket `event-images` العام (رفع أو لصق رابط).

### لوحة الأدمن الكاملة — `/admin/<القسم>` (الهجرة 0008)

الأقسام: نظرة عامة وتقارير الاستخدام، المستخدمون (User/Admin)، الأسعار والدفع
(أسعار المزايا، العملة، بوابة بيلينك، بيانات البنك)، المدفوعات (قبول/رفض
الإثباتات)، المناسبات، المدعوون والإحصائيات، القوالب والثيمات، الإعلانات، بيانات
التواصل، السياسات والمحتوى، الميزات (تفعيل/تعطيل: استيراد جهات الاتصال، QR، إرسال
واتساب، شريط الإعلانات، ردود المدعوين — `app_settings.feature_flags`)، وإعدادات
الموقع.

**الأمان في قاعدة البيانات لا في الواجهة:** كل جدول إداري محمي بـ RLS تتحقق من
`is_admin()`، والعمليات الحسّاسة (الأسعار، مراجعة المدفوعات) دوال
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
| iPhone Safari (ويب) | **اختصار Apple Shortcuts «Dawaat – Contacts»** (الطريق الأساسي — التفاصيل أدناه)؛ ثانوياً تعبئة تلقائية من جهات الاتصال (حقل اسم وجوال `autocomplete="name"/"tel"`) جهة في كل مرة | نعم عبر الاختصار. ملف VCF احتياطي فقط |
| الكمبيوتر | VCF / CSV / لصق قائمة / إدخال يدوي | — |

**تشخيص «لماذا لا تفتح جهات الاتصال؟» من الجهاز نفسه:** افتح صفحة المناسبة مع
`?debug=contacts` في الرابط (مثل `dawaatly.top/events/12?debug=contacts`) ثم اضغط زر
جهات الاتصال — تظهر أسفل النافذة لوحة سوداء فيها كل الحقائق: وجود `navigator.contacts`،
نتيجة `getProperties`، سياق https، أعلى نافذة أم iframe، تفعيل المستخدم لحظة الاستدعاء
(`userActivation`)، المتصفح المدمج إن وُجد، «وضع سطح المكتب»، واسم خطأ `select()` ورسالته.
نفس التقرير يُطبع دائماً في Console. ملاحظات مثبتة: `select()` يُستدعى فوراً داخل إيماءة
الضغط (أي await قبله يسبب SecurityError)، وWebView والمتصفحات المدمجة (واتساب/إنستغرام…)
لا تملك الميزة أصلاً فيُعرض للعميل زر «فتح دعوات في Chrome» (رابط `intent://`)، و«موقع
سطح المكتب» على تابلت أندرويد يُكشف ويُعامل كأندرويد مع إرشاد لتعطيله. Permissions-Policy
وCSP في `_headers` لا يحكمان هذه الميزة، والـ Worker لا علاقة له بها (تعمل داخل المتصفح).

الاكتشاف والتفرّع في `src/artifacts/invites/src/lib/contact-picker.ts`
(`getContactPickerSupport().via`: `native` / `web-api` / `shortcut` / `autofill` / `none`)،
والواجهة في `components/contact-import-dialog.tsx` و`components/ios-shortcut-import.tsx`.

### استيراد جهات اتصال الآيفون عبر اختصار Shortcuts — الهجرة 0011

سفاري لا يملك أي Web API لاختيار جهات الاتصال، لذلك يعمل الآيفون (ويب) عبر اختصار
يثبّته المستخدم مرة واحدة. لا يحمل الاختصار ولا الواجهة أي مفتاح سري — فقط رمز مؤقت:

1. المستخدم (مسجّل الدخول) يضغط «استيراد من جهات اتصال iPhone» في نافذة جهات الاتصال
   ← الموقع يستدعي `create_contact_import_token(event_id)` (تتطلب جلسة، وتتحقق أن
   المناسبة له) فيحصل على رمز عشوائي 64 خانة (~244 بت) صالح **15 دقيقة** ولاستخدام **واحد**،
   مربوط بالمستخدم والمناسبة (جدول `contact_import_tokens`).
2. الموقع يفتح `shortcuts://run-shortcut?name=Dawaat%20%E2%80%93%20Contacts&input=text&text=TOKEN`
   (الرمز يُنشأ مسبقاً عند ظهور الزر لأن سفاري لا يفتح مخططاً مخصصاً إلا داخل إيماءة الضغط).
   **ما يراه العميل (بلا أي كلمة تقنية):** أول مرة على الجهاز (لا علامة
   `dawaat.iosShortcutReady` في localStorage) تظهر بطاقة «لإضافة جهات اتصالك لأول مرة» بزر
   واحد «تفعيل جهات الاتصال» يفتح صفحة الاختصار في iCloud (الرابط من الأدمن ← الميزات ←
   «رابط اختصار الآيفون»، `app_settings.ios_shortcut_url`)، وعند العودة للموقع تُفتح
   نافذة جهات الاتصال تلقائياً (علامة `sessionStorage`). بعدها زر «جهات الاتصال» في صفحة
   المناسبة يفتح الاختصار مباشرة (المتحكم `useIosShortcutImport` في صفحة المناسبة حتى تبقى
   الضغطة داخل إيماءة المستخدم). على الآيفون لا تظهر VCF ولا CSV ولا اللصق — فقط «أضف
   الاسم والرقم يدوياً». إن لم تختفِ الصفحة بعد فتح `shortcuts://` أو عاد المستخدم بلا
   استيراد: «لم تُفتح جهات الاتصال» + «حاول مرة أخرى» + بطاقة التفعيل.
3. الاختصار: يختار جهات الاتصال (اختيار متعدد) ← يستخرج الاسم والأرقام ← يرسل JSON إلى
   `POST https://dawaatly.top/api/contacts/import`:
   `{ "token": "…", "contacts": [ { "name": "سعود", "phones": ["0501234567", "0112345678"] } ] }`
4. الـ Worker يمرّر الطلب (بمفتاح anon العام) إلى دالة `import_contacts_with_token` التي
   تتحقق: الرمز موجود، لم يُستخدم، لم ينتهِ، والمناسبة ما زالت لصاحبه — ثم توحّد الأرقام
   (`normalize_sa_phone` ← `+9665XXXXXXXX`)، تفضّل الجوال السعودي على الثابت، تحذف المكرر
   داخل الدفعة، وتُدخل المدعوين بـ `on conflict (event_id, phone) do nothing` (المدعو المسبق
   يبقى بردّه)، وتستهلك الرمز وتسجّل الأعداد. الرد: `{ ok, event_id, inserted, duplicates, skipped, redirect, message }`.
   أخطاء: `INVALID_TOKEN` 401، `TOKEN_USED` 409، `TOKEN_EXPIRED` 410، `EVENT_NOT_OWNED` 403،
   `BAD_PAYLOAD` 400، `TOO_MANY_CONTACTS` 413 (>1000)، `NOT_CONFIGURED` 503.
5. الصفحة تستطلع `contact_import_status(token)` كل ثانيتين (صاحب الرمز فقط)؛ عند استهلاكه
   تُحدَّث قائمة المدعوين مباشرة بلا إعادة تحميل. الاختصار يفتح في النهاية `redirect`
   (`/events/:id?imported=1`) فتتحدث القائمة أيضاً إن عاد المستخدم في تبويب جديد.

اختبار الطبقة الكاملة لقاعدة البيانات في `src/supabase/tests/rls_tests.sql` (الاختبار 22:
5 جهات ← 2 مُدخلة، 2 مكررة، 1 بلا رقم صالح؛ الاستخدام الثاني للرمز مرفوض).

**بناء الاختصار (مرة واحدة على آيفون، ثم مشاركته برابط iCloud ولصقه في الأدمن):**

افتح تطبيق الاختصارات ← «+» ← سمِّه بالضبط `Dawaat – Contacts` (شرطة طويلة – بين الكلمتين)،
ثم أضف الإجراءات بهذا الترتيب:

| # | الإجراء (بالعربية / English) | الضبط |
|---|---|---|
| 1 | تحديد جهة اتصال / **Select Contact** | فعّل «تحديد متعدد» (Select Multiple) |
| 2 | تكرار مع كل / **Repeat with Each** | على نتيجة الخطوة 1 |
| 3 | داخل التكرار: الحصول على تفاصيل جهات الاتصال / **Get Details of Contacts** | Get **Name** of Repeat Item |
| 4 | داخل التكرار: **Get Details of Contacts** | Get **Phone Numbers** of Repeat Item |
| 5 | داخل التكرار: قاموس / **Dictionary** | `name` = نتيجة 3 (نص)، `phones` = نتيجة 4 (مصفوفة) |
| 6 | داخل التكرار: إضافة إلى المتغير / **Add to Variable** | المتغير `contacts` |
| 7 | بعد التكرار: **Dictionary** | `token` = **Shortcut Input** (نص)، `contacts` = المتغير `contacts` (مصفوفة) |
| 8 | الحصول على محتويات URL / **Get Contents of URL** | URL: `https://dawaatly.top/api/contacts/import` — Method: **POST** — Request Body: **JSON** — أدخل حقلي `token` و`contacts` من قاموس الخطوة 7 (أو اختر Request Body: File وضع القاموس كاملاً) |
| 9 | الحصول على قيمة القاموس / **Get Dictionary Value** | المفتاح `redirect` من نتيجة 8 |
| 10 | فتح عناوين URL / **Open URLs** | نتيجة 9 (يعيد المستخدم إلى المناسبة في سفاري) |

اختياري بين 8 و9: **Get Dictionary Value** للمفتاح `message` ثم **Show Notification** لعرض
«أُضيف N مدعو». أول تشغيل يطلب iOS السماح للاختصار بالوصول إلى جهات الاتصال وإلى
`dawaatly.top` — اضغط «السماح دائماً».

مشاركة الاختصار: من قائمة الاختصار ← مشاركة ← **نسخ رابط iCloud** ← الصقه في الأدمن ←
الميزات ← «رابط اختصار الآيفون». المستخدمون الجدد يثبّتونه بزر «إضافة اختصار دعوات».

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
