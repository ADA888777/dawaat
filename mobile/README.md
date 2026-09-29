# تطبيق دعوات (iOS / Android) — غلاف Capacitor

هذا المجلد يحوّل موقع دعوات إلى تطبيق للآيفون وأندرويد **من المستودع نفسه**:
التطبيق يحمّل الموقع الحي `https://dawaatly.top` داخل WebView (`server.url` في
`capacitor.config.json`)، فهو نفس الموقع ونفس الحسابات ونفس بيانات Supabase —
لا نسخة ثانية من الشيفرة ولا نشر منفصل؛ أي تحديث يُدفع إلى `main` يظهر في
التطبيق فوراً دون إعادة رفعه للمتاجر.

ما يضيفه التطبيق فوق الموقع هو **منتقي جهات الاتصال الأصلي** (`contact-picker/`):

| المنصة | ما يحدث عند الضغط على «جهات الاتصال» في صفحة المناسبة |
|---|---|
| iPhone (التطبيق) | منتقي جهات اتصال النظام باختيار متعدد (`CNContactPickerViewController`). لا يحتاج إذناً لأن المنتقي يعمل خارج التطبيق ولا يُقرأ دفتر العناوين. |
| Android (التطبيق) | طلب إذن قراءة جهات الاتصال مرة واحدة ← تُعرض جهات الاتصال التي لها رقم داخل نافذة دعوات مع تحديد متعدد وبحث. إن رُفض الإذن يُفتح منتقي النظام لجهة واحدة (بلا إذن). |
| iPhone Safari (الموقع) | لا توجد Web API للاختيار من جهات الاتصال. الموقع يعرض لوحة «من جهات الاتصال»: حقلا اسم وجوال يعبّئهما سفاري من جهات الاتصال — جهة في كل مرة (حد النظام)، وملف VCF احتياطي لعشرات الأسماء. |
| Android Chrome (الموقع) | Contact Picker API — اختيار متعدد مباشر. |

الموقع يكتشف أنه داخل التطبيق عبر الجسر الذي يحقنه Capacitor في الصفحة
(`window.Capacitor.isNativePlatform()`) ويستدعي الملحق بالاسم
`DawaatContactPicker` — انظر `src/artifacts/invites/src/lib/contact-picker.ts`.

---

## المتطلبات

- Node.js 20+ و npm
- **أندرويد:** Android Studio (Ladybug أو أحدث) مع SDK 36 و JDK 21
- **iOS:** macOS + Xcode 16+ (الملحق يُربط عبر Swift Package Manager تلقائياً؛ لا حاجة لـ CocoaPods)

## خطوات البناء

```bash
cd mobile
npm install                # يثبّت Capacitor 8 والملحق المحلي contact-picker
npx cap add android        # يولّد مجلد android/ (مرة واحدة)
npx cap add ios            # يولّد مجلد ios/ (مرة واحدة، على macOS)
npx cap sync               # ينسخ الإعدادات ويربط الملحق بالمنصتين
npx cap open android       # يفتح المشروع في Android Studio
npx cap open ios           # يفتح المشروع في Xcode
```

مجلدا `android/` و`ios/` مولَّدان ولا يُرفعان للمستودع (انظر `.gitignore`)؛
أعد `npx cap sync` بعد أي تعديل على `capacitor.config.json` أو على الملحق.

### ما يجب ضبطه يدوياً في المشروعين المولَّدين

**Android** — لا شيء إلزامي: إذن `READ_CONTACTS` يُدمج تلقائياً من بيان الملحق،
واسم التطبيق «دعوات» يأتي من `capacitor.config.json`. لإصدار المتجر أنشئ مفتاح
توقيع من Android Studio ← Build ← Generate Signed Bundle.

**iOS** — في Xcode بعد `cap add ios`:

1. اختر فريق التوقيع (Signing & Capabilities ← Team).
2. المنتقي الأصلي لا يحتاج `NSContactsUsageDescription`؛ أضفه فقط إذا أُضيف
   لاحقاً وضع قراءة دفتر العناوين كاملاً.
3. الأيقونة وشاشة البداية من `App/Assets.xcassets`.

## التشغيل على جهاز حقيقي

```bash
npx cap run android   # يعرض الأجهزة/المحاكيات المتصلة
npx cap run ios
```

لأن التطبيق يحمّل `dawaatly.top` مباشرة فهو يحتاج اتصالاً بالإنترنت؛ الصفحة في
`www/index.html` احتياطية تظهر فقط إن تعذّر الوصول للموقع.

## بنية المجلد

```
mobile/
├── capacitor.config.json      ← appId: top.dawaatly.app، server.url: https://dawaatly.top
├── package.json               ← Capacitor 8 + الملحق المحلي
├── www/index.html             ← صفحة احتياطية (بلا اتصال)
└── contact-picker/            ← ملحق DawaatContactPicker
    ├── package.json / index.js
    ├── Package.swift                                ← ربط iOS عبر SPM (افتراضي Capacitor 8)
    ├── DawaatContactPicker.podspec                  ← بديل لمن يستخدم CocoaPods
    ├── android/
    │   ├── build.gradle
    │   └── src/main/
    │       ├── AndroidManifest.xml                      ← READ_CONTACTS
    │       └── java/top/dawaatly/contactpicker/ContactPickerPlugin.java
    └── ios/Sources/ContactPickerPlugin/ContactPickerPlugin.swift
```

## واجهة الملحق

```ts
// من داخل الموقع (بلا حزمة @capacitor/core):
const plugin = window.Capacitor.registerPlugin("DawaatContactPicker");
const result = await plugin.pickContacts();
// result = {
//   contacts: [{ name: "سعود العتيبي", phones: ["+966501234567"] }],
//   mode: "picked" | "browse",   // picked: اختارهم المستخدم — browse: القائمة كاملة للاختيار داخل الموقع
//   cancelled?: true             // أغلق المنتقي بلا اختيار
// }
```

## ملاحظات

- لا يوجد أي مفتاح سري هنا: `capacitor.config.json` يحوي رابط الموقع العام فقط،
  ومفاتيح Supabase تبقى في الموقع (anon فقط) كما هي.
- سياسة App Store (4.2) تفضّل التطبيقات التي تقدّم أكثر من موقع داخل إطار؛
  منتقي جهات الاتصال الأصلي هو هذه الإضافة، ويمكن لاحقاً إضافة الإشعارات
  والمشاركة الأصلية بنفس الطريقة (ملحقات في هذا المجلد) دون تغيير الموقع.
