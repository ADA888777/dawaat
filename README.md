# دعوات — منصة دعوات إلكترونية

منصة لإنشاء دعوات رقمية أنيقة وإرسالها عبر واتساب وتتبع ردود المدعوين.

---

## محتوى المستودع

```
dawaat/
├── src/    ← شيفرة المشروع الكاملة (React + Vite + Supabase)
├── site/   ← الموقع المبني الجاهز للرفع على Cloudflare
└── README.md
```

---

## رفع الموقع على Cloudflare

1. افتح [Cloudflare Dashboard](https://dash.cloudflare.com)
2. في بطاقة **Ship something new** — اسحب مجلد `site/` إلى المربع
3. بعد النشر افتح `site/config.js` من لوحة Cloudflare
4. ضع مفتاح **anon public** من Supabase → Settings → API
5. احفظ وحدّث الصفحة

---

## إعداد قاعدة البيانات (Supabase)

نفّذ بالترتيب من SQL Editor:

```
src/artifacts/invites/supabase/migrations/0001_security_and_integrity_fixes.sql
src/artifacts/invites/supabase/migrations/0002_prelaunch_plan_fixes.sql
```

---

## البناء من المصدر

```bash
cd src
pnpm install
pnpm --filter @workspace/invites build
# النتيجة في: src/artifacts/invites/dist/public
```

---

## التقنيات

- **Frontend:** React 19 + TypeScript + Vite + Tailwind CSS
- **Backend:** Supabase (Auth + Postgres + Storage)
- **Hosting:** Cloudflare Workers
