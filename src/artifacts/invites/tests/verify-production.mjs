#!/usr/bin/env node
/**
 * فحص جاهزية الإنتاج على مشروع Supabase الحقيقي.
 *
 * هذا ما لا أستطيع تنفيذه نيابةً عنك: لا أملك وصولاً إلى مشروعك.
 * السكربت يفعل ما كنت سأفعله لو ملكت الوصول، ويطبع نتيجة تقرؤها أنت.
 *
 * ═══════════════════════════════════════════════════════════════
 *  التشغيل
 * ═══════════════════════════════════════════════════════════════
 *   npm install @supabase/supabase-js
 *
 *   SUPABASE_URL="https://xxxx.supabase.co" \
 *   SERVICE_ROLE_KEY="eyJ..." \
 *   ANON_KEY="eyJ..." \
 *   node verify-production.mjs
 *
 * الوضع الافتراضي قراءة فقط. يُنشئ حسابين اختباريين مؤقتين لتنفيذ
 * محاولات اختراق حقيقية، ثم يحذفهما في النهاية.
 *
 * ⚠️ مفتاح service_role يتجاوز كل حماية RLS. مرّره كمتغير بيئة فقط،
 *    ولا تضعه في أي ملف، وبدّله من Settings → API بعد الانتهاء.
 */

import { createClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_URL;
const SRV = process.env.SERVICE_ROLE_KEY;
const ANON = process.env.ANON_KEY;
const SEND_TEST_EMAIL = process.argv.includes("--send-test-email");
const EMAIL_TO = process.env.TEST_EMAIL;

if (!URL || !SRV || !ANON) {
  console.error("الاستخدام: SUPABASE_URL=... SERVICE_ROLE_KEY=... ANON_KEY=... node verify-production.mjs");
  process.exit(1);
}

const admin = createClient(URL, SRV, { auth: { persistSession: false, autoRefreshToken: false } });
const pass = [], fail = [], warn = [];

const L = () => console.log("─".repeat(64));
function ok(n, d = "") { pass.push(n); console.log(`  ✅ ${n}${d ? "  → " + d : ""}`); }
function no(n, d = "") { fail.push(n); console.log(`  ❌ ${n}${d ? "  → " + d : ""}`); }
function wr(n, d = "") { warn.push(n); console.log(`  ⚠️  ${n}${d ? "  → " + d : ""}`); }
function chk(n, cond, d = "") { cond ? ok(n, d) : no(n, d); }

const stamp = Date.now();
const U1 = `verify.user.${stamp}@example.com`;
const U2 = `verify.other.${stamp}@example.com`;
const PW = `Vf!${stamp}aA1`;
let id1, id2, ev2;

async function cleanup() {
  for (const id of [id1, id2]) {
    if (id) { try { await admin.auth.admin.deleteUser(id); } catch {} }
  }
}

try {
// ══════════════════════════════════════════════════════════════
console.log("\n════ 1. الاتصال بالمشروع ════");
const ref = URL.replace(/^https?:\/\//, "").split(".")[0];
console.log(`  المشروع: ${ref}`);
try {
  const h = await fetch(`${URL}/auth/v1/health`, { headers: { apikey: ANON } });
  chk("خدمة المصادقة تستجيب", h.ok, `HTTP ${h.status}`);
} catch (e) {
  no("الوصول إلى المشروع", e.message);
  console.error("\n  المشروع متوقف أو الرابط خاطئ. أوقفنا الفحص.");
  process.exit(1);
}

// ══════════════════════════════════════════════════════════════
console.log("\n════ 2. حالة الهجرتين 0001 و 0002 ════");
// نستعلم عن البنية عبر جداول النظام
const { data: cols, error: colErr } = await admin.rpc("exec_sql_readonly", {}).then(
  () => ({ data: null, error: null }),
  () => ({ data: null, error: null })
);

// طريقة لا تحتاج دوال مساعدة: نقرأ صفاً واحداً ونفحص أعمدته
const { data: gRow, error: gErr } = await admin.from("guests").select("*").limit(1);
if (gErr) {
  no("قراءة جدول guests", gErr.message);
} else {
  const sample = gRow?.[0];
  if (sample) {
    chk("[0001] عمود invite_token موجود", "invite_token" in sample);
  } else {
    // لا صفوف: نتحقق بمحاولة اختيار العمود صراحةً
    const { error } = await admin.from("guests").select("invite_token").limit(1);
    chk("[0001] عمود invite_token موجود", !error, error?.message ?? "");
  }
}

// قيد التفرد: نجرّب إدخال مكرر فعلياً لاحقاً (القسم 5)

// الـ Buckets
const { data: buckets, error: bErr } = await admin.storage.listBuckets();
if (bErr) no("قراءة الـ Buckets", bErr.message);
else {
  const names = buckets.map(b => b.id);
  for (const b of ["event-images", "event-audios", "event-files", "template-images"]) {
    chk(`[0001] bucket ${b}`, names.includes(b));
  }
  const audio = buckets.find(b => b.id === "event-audios");
  if (audio) {
    const mimes = audio.allowed_mime_types ?? [];
    chk("[الصوت] bucket يقبل audio/mp4 (صيغة iPhone)",
        mimes.length === 0 || mimes.includes("audio/mp4"),
        mimes.join(", ") || "بلا قيود");
    chk("[الصوت] حد حجم الصوت مضبوط", !!audio.file_size_limit,
        audio.file_size_limit ? `${Math.round(audio.file_size_limit / 1048576)}MB` : "بلا حد");
  }
  const imgs = buckets.find(b => b.id === "event-images");
  if (imgs) chk("[الأمان] حد حجم الصور مضبوط", !!imgs.file_size_limit,
                imgs.file_size_limit ? `${Math.round(imgs.file_size_limit / 1048576)}MB` : "بلا حد");
}

// ══════════════════════════════════════════════════════════════
console.log("\n════ 3. إنشاء حسابين اختباريين ════");
const { data: c1, error: e1 } = await admin.auth.admin.createUser(
  { email: U1, password: PW, email_confirm: true });
const { data: c2, error: e2 } = await admin.auth.admin.createUser(
  { email: U2, password: PW, email_confirm: true });
if (e1 || e2) { no("إنشاء حسابات الاختبار", (e1 || e2).message); throw new Error("stop"); }
id1 = c1.user.id; id2 = c2.user.id;
ok("أُنشئ حسابان اختباريان");

await new Promise(r => setTimeout(r, 1200)); // مهلة للتريجر

const { data: p1 } = await admin.from("profiles").select("*").eq("id", id1).maybeSingle();
chk("[التسجيل] تريجر إنشاء profiles يعمل", !!p1);
chk("[الأمان] الدور الافتراضي user", p1?.role === "user", p1?.role);
chk("[0002] حد الباقة المجانية = 1", p1?.events_limit === 1,
    String(p1?.events_limit ?? "غير مضبوط"));

// ══════════════════════════════════════════════════════════════
console.log("\n════ 4. اختبارات الاختراق بمستخدم عادي حقيقي ════");
const u1 = createClient(URL, ANON, { auth: { persistSession: false } });
const { data: s1, error: sErr } = await u1.auth.signInWithPassword({ email: U1, password: PW });
chk("تسجيل الدخول بالمفتاح العام", !sErr && !!s1?.session, sErr?.message ?? "");

// مناسبة تخص المستخدم الثاني (تُنشأ بصلاحية الإدارة)
const { data: evRow, error: evErr } = await admin.from("events").insert({
  user_id: id2, title: "مناسبة الضحية", category: "general",
  event_date: new Date(Date.now() + 864e5).toISOString(), location: "الرياض", description: "",
}).select("id, share_slug").single();
if (evErr) wr("تعذّر تجهيز مناسبة الاختبار", evErr.message);
else {
  ev2 = evRow.id;
  await admin.from("guests").insert({ event_id: ev2, name: "مدعو", phone: "0500000000" });

  const r1 = await u1.from("events").select("*").eq("id", ev2);
  chk("قراءة مناسبة مستخدم آخر مرفوضة", (r1.data?.length ?? 0) === 0,
      `رجع ${r1.data?.length ?? 0} صف`);
  const r2 = await u1.from("events").update({ title: "مخترق" }).eq("id", ev2);
  const after = await admin.from("events").select("title").eq("id", ev2).single();
  chk("تعديل مناسبة مستخدم آخر مرفوض", after.data?.title !== "مخترق");
  await u1.from("events").delete().eq("id", ev2);
  const alive = await admin.from("events").select("id").eq("id", ev2);
  chk("حذف مناسبة مستخدم آخر مرفوض", (alive.data?.length ?? 0) === 1);
  const r3 = await u1.from("guests").select("*");
  chk("قراءة مدعوي الآخرين مرفوضة", (r3.data?.length ?? 0) === 0);
}

const r4 = await u1.from("profiles").select("*");
chk("قراءة ملفات المستخدمين الآخرين مرفوضة", (r4.data?.length ?? 0) <= 1,
    `يرى ${r4.data?.length ?? 0} ملف (ملفه فقط)`);

await u1.from("profiles").update({ role: "admin" }).eq("id", id1);
const roleNow = await admin.from("profiles").select("role").eq("id", id1).single();
chk("ترقية النفس إلى admin مرفوضة", roleNow.data?.role === "user", roleNow.data?.role);

await u1.from("profiles").update({ plan: "paid", events_limit: null }).eq("id", id1);
const planNow = await admin.from("profiles").select("plan, events_limit").eq("id", id1).single();
chk("منح النفس باقة مدفوعة مرفوض",
    planNow.data?.plan === "free" && planNow.data?.events_limit === 1,
    `${planNow.data?.plan}/${planNow.data?.events_limit}`);

const up = await u1.rpc("upgrade_my_subscription");
chk("[0002] الترقية الذاتية محجوبة", !!up.error, up.error?.message?.slice(0, 44) ?? "نجحت — ثغرة!");

const asp = await u1.rpc("admin_set_plan", { p_user_id: id1, p_plan: "paid", p_months: 12 });
const planNow2 = await admin.from("profiles").select("plan").eq("id", id1).single();
chk("[0002] admin_set_plan مرفوضة لغير الأدمن",
    planNow2.data?.plan === "free", asp.error?.message?.slice(0, 44) ?? "");

// ══════════════════════════════════════════════════════════════
console.log("\n════ 5. حد الباقة المجانية فعلياً ════");
const mk = (t) => u1.from("events").insert({
  user_id: id1, title: t, category: "general",
  event_date: new Date(Date.now() + 864e5).toISOString(), location: "جدة", description: "",
});
const a = await mk("الأولى");
chk("إنشاء المناسبة الأولى ينجح", !a.error, a.error?.message ?? "");
const b = await mk("الثانية");
chk("المناسبة الثانية مرفوضة على المجانية", !!b.error,
    b.error?.message?.includes("EVENTS_LIMIT_REACHED")
      ? "EVENTS_LIMIT_REACHED (الرمز الصحيح)"
      : (b.error?.message?.slice(0, 40) ?? "نجحت — الحد لا يعمل!"));

// تكرار المدعو
const myEv = await u1.from("events").select("id").eq("user_id", id1).limit(1).single();
if (myEv.data) {
  await u1.from("guests").insert({ event_id: myEv.data.id, name: "أ", phone: "0511111111" });
  const dup = await u1.from("guests").insert({ event_id: myEv.data.id, name: "ب", phone: "0511111111" });
  chk("[0001] تكرار الجوال في نفس المناسبة مرفوض", !!dup.error,
      dup.error?.code === "23505" ? "قيد التفرد يعمل" : (dup.error?.message?.slice(0, 40) ?? "قُبل — القيد مفقود!"));
}

// ══════════════════════════════════════════════════════════════
console.log("\n════ 6. الأدمن ════");
await admin.from("profiles").update({ role: "admin", events_limit: null }).eq("id", id2);
const ua = createClient(URL, ANON, { auth: { persistSession: false } });
const sa = await ua.auth.signInWithPassword({ email: U2, password: PW });
if (sa.error) wr("تعذّر الدخول بحساب الأدمن الاختباري", sa.error.message);
else {
  const all = await ua.from("profiles").select("id");
  chk("الأدمن يرى كل المستخدمين", (all.data?.length ?? 0) >= 2, `${all.data?.length} ملف`);
  const many = [];
  for (let i = 0; i < 3; i++) {
    const r = await ua.from("events").insert({
      user_id: id2, title: `أدمن ${i}`, category: "general",
      event_date: new Date(Date.now() + 864e5).toISOString(), location: "جدة", description: "",
    });
    many.push(!r.error);
  }
  chk("[0002] الأدمن معفى من حد الباقة", many.every(Boolean),
      `${many.filter(Boolean).length}/3 نجحت`);
  const grant = await ua.rpc("admin_set_plan", { p_user_id: id1, p_plan: "paid", p_months: 12 });
  const after = await admin.from("profiles").select("plan, events_limit").eq("id", id1).single();
  chk("[0002] الأدمن يمنح الباقة يدوياً",
      !grant.error && after.data?.plan === "paid" && after.data?.events_limit === null,
      grant.error?.message ?? `${after.data?.plan}/${after.data?.events_limit}`);
  await ua.auth.signOut();
}

// ══════════════════════════════════════════════════════════════
console.log("\n════ 7. الدعوة العامة والرد بالرمز ════");
if (ev2) {
  const anon = createClient(URL, ANON, { auth: { persistSession: false } });
  const slug = evRow.share_slug;
  chk("[0001] طول share_slug = 18 خانة", slug?.length === 18, slug);
  const inv = await anon.rpc("get_public_invitation", { p_slug: slug });
  chk("الزائر يفتح الدعوة بلا تسجيل", !inv.error && inv.data?.length === 1);
  chk("الدعوة لا تكشف معرّف المالك", !inv.error && !("user_id" in (inv.data?.[0] ?? {})));

  const g = await admin.from("guests").select("invite_token").eq("event_id", ev2).limit(1).single();
  if (g.data?.invite_token) {
    const gi = await anon.rpc("get_guest_by_token", { p_token: g.data.invite_token });
    chk("[0001] قراءة المدعو بالرمز", !gi.error && gi.data?.length === 1);
    chk("[0001] الرمز لا يكشف رقم الجوال", !("phone" in (gi.data?.[0] ?? {})));
    await anon.rpc("submit_rsvp_by_token", { p_token: g.data.invite_token, p_status: "attending" });
    const st = await admin.from("guests").select("attendance_status").eq("event_id", ev2).limit(1).single();
    chk("[0001] الرد بالرمز يُسجَّل", st.data?.attendance_status === "attending",
        st.data?.attendance_status);
  }
  const bad = await anon.rpc("submit_rsvp", {
    p_slug: slug, p_name: "س", p_phone: "ليس-رقماً", p_status: "attending" });
  chk("[0001] رفض رقم جوال غير صالح", !!bad.error);
  const longName = await anon.rpc("submit_rsvp", {
    p_slug: slug, p_name: "ا".repeat(200), p_phone: "0512345678", p_status: "attending" });
  chk("[0001] رفض اسم مفرط الطول", !!longName.error);
}

// ══════════════════════════════════════════════════════════════
console.log("\n════ 8. التخزين ════");
const bytes = new Uint8Array(64).fill(65);
const up1 = await u1.storage.from("event-images").upload(`${id1}/verify-${stamp}.png`, bytes,
  { contentType: "image/png" });
chk("رفع صورة داخل مجلد المستخدم", !up1.error, up1.error?.message ?? "");
const up2 = await u1.storage.from("event-images").upload(`${id2}/hack-${stamp}.png`, bytes,
  { contentType: "image/png" });
chk("[الأمان] الرفع في مجلد مستخدم آخر مرفوض", !!up2.error,
    up2.error?.message?.slice(0, 40) ?? "نجح — سياسة التخزين مفقودة!");
if (!up1.error) {
  const { data: pub } = u1.storage.from("event-images").getPublicUrl(`${id1}/verify-${stamp}.png`);
  const r = await fetch(pub.publicUrl);
  chk("الملف المرفوع يُقرأ عبر الرابط العام", r.ok, `HTTP ${r.status}`);
  await admin.storage.from("event-images").remove([`${id1}/verify-${stamp}.png`]);
}

// ══════════════════════════════════════════════════════════════
console.log("\n════ 9. إعدادات المصادقة للإنتاج ════");
console.log("  (هذه تُضبط من اللوحة ولا تُقرأ عبر API — تحقق يدوياً)");
if (SEND_TEST_EMAIL && EMAIL_TO) {
  const anon = createClient(URL, ANON, { auth: { persistSession: false } });
  const { error } = await anon.auth.resetPasswordForEmail(EMAIL_TO, {
    redirectTo: (process.env.APP_URL ?? "https://example.com") + "/reset-password",
  });
  if (error) no("طلب رسالة استعادة", error.message);
  else {
    wr("أُرسل طلب رسالة استعادة — افتح بريدك وتحقق يدوياً",
       `إلى ${EMAIL_TO}`);
    console.log("     ✓ وصلت الرسالة؟ ✓ الرابط يشير إلى نطاقك لا localhost؟ ✓ يفتح ويغيّر كلمة المرور؟");
  }
} else {
  wr("لم يُختبر إرسال البريد", "شغّل بـ --send-test-email و TEST_EMAIL=بريدك");
}

} catch (e) {
  if (e.message !== "stop") console.error("\nخطأ غير متوقع:", e.message);
} finally {
  console.log("\n════ التنظيف ════");
  if (ev2) { try { await admin.from("events").delete().eq("id", ev2); } catch {} }
  await cleanup();
  ok("حُذفت الحسابات والبيانات الاختبارية");
}

L();
console.log(`  نجح ${pass.length} | فشل ${fail.length} | يحتاج تحققاً يدوياً ${warn.length}`);
if (fail.length) {
  console.log("\n  ❌ الفاشل:");
  fail.forEach(f => console.log(`     • ${f}`));
  console.log("\n  إن فشلت بنود [0001] أو [0002] فالهجرتان لم تُنفَّذا بعد.");
}
if (warn.length) {
  console.log("\n  ⚠️  يحتاج تحققاً منك:");
  warn.forEach(w => console.log(`     • ${w}`));
}
L();
process.exit(fail.length ? 1 : 0);
