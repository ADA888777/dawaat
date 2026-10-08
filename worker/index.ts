/**
 * Worker دعوات — واجهة API صغيرة أمام الأصول الثابتة للموقع.
 *
 * المسارات:
 *   POST /api/contacts/import   ← يستقبل جهات الاتصال من اختصار الآيفون (Dawaat – Contacts)
 *                                  مع رمز الاستخدام الواحد، ويمرّرها إلى دالة قاعدة البيانات
 *                                  import_contacts_with_token التي تتحقق من الرمز وتُدخل المدعوين.
 *   POST /api/pay/create        ← ينشئ فاتورة في بوابة الدفع ويعيد رابط الدفع
 *                                  (بجلسة المستخدم؛ التفاصيل في worker/paylink.ts
 *                                  أو worker/moyasar.ts حسب PAYMENT_PROVIDER).
 *   GET  /api/pay/return        ← عودة العميل بعد الدفع: تحقق ثم تأكيد ثم تحويل للمناسبة.
 *   POST /api/pay/webhook       ← نداء خادم-لخادم من البوابة لتأكيد الدفع.
 *   GET  /api/health            ← فحص جاهزية بسيط.
 *   أي مسار آخر                 ← الأصول الثابتة (تطبيق React) كما كان تماماً.
 *
 * لا أسرار هنا: العنوان ومفتاح anon العام (نفسه الذي يحمّله كل زائر داخل حزمة
 * JavaScript) يُقرآن من runtime-config.json الذي يكتبه البناء بجانب الحزمة
 * (vite.config.ts ← emitRuntimeConfig)، ويمكن تجاوزهما بمتغيري التشغيل
 * SUPABASE_URL / SUPABASE_ANON_KEY في Cloudflare. لا service_role إطلاقاً —
 * التحقق الفعلي كله في قاعدة البيانات (الرمز المؤقت + RLS).
 */

import * as paylink from "./paylink";
import * as moyasar from "./moyasar";
import type { PaylinkEnv } from "./paylink";
import type { MoyasarEnv } from "./moyasar";

interface Env extends PaylinkEnv, MoyasarEnv {
  ASSETS: { fetch(request: Request): Promise<Response> };
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
  /** "moyasar" أو "paylink" — الافتراضي بيلينك حفاظاً على السلوك القائم */
  PAYMENT_PROVIDER?: string;
}

/**
 * اختيار البوابة من متغير تشغيل واحد في Cloudflare.
 *
 * كل بوابة تلتزم العقد نفسه (create / return / webhook) وتكتب في الجدول
 * نفسه عبر attach_gateway_payment و confirm_gateway_payment، فالتبديل بينهما
 * لا يمس قاعدة البيانات ولا الواجهة — متغيّر واحد ونشر.
 *
 * إن لم يُضبط المتغير نختار تلقائياً البوابة التي ضُبطت مفاتيحها، وبيلينك
 * أولاً حتى لا يتغيّر سلوك الموقع القائم من تلقاء نفسه.
 */
function gatewayFor(env: Env) {
  const chosen = (env.PAYMENT_PROVIDER ?? "").trim().toLowerCase();
  if (chosen === "moyasar") return moyasar;
  if (chosen === "paylink") return paylink;
  if (paylink.paylinkConfigured(env)) return paylink;
  if (moyasar.moyasarConfigured(env)) return moyasar;
  return paylink;
}

const MAX_CONTACTS = 1000;
const MAX_BODY_BYTES = 512 * 1024;

const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  "access-control-max-age": "86400",
};

/** رسائل عربية لرموز الخطأ التي ترفعها قاعدة البيانات */
const DB_ERRORS: Record<string, { status: number; message: string }> = {
  INVALID_TOKEN: { status: 401, message: "رمز الاستيراد غير صالح. افتح «جهات الاتصال» من صفحة المناسبة مرة أخرى." },
  TOKEN_USED: { status: 409, message: "هذا الرمز استُخدم من قبل. افتح «جهات الاتصال» من صفحة المناسبة للحصول على رمز جديد." },
  TOKEN_EXPIRED: { status: 410, message: "انتهت صلاحية الرمز (15 دقيقة). افتح «جهات الاتصال» من صفحة المناسبة مرة أخرى." },
  EVENT_NOT_OWNED: { status: 403, message: "المناسبة لم تعد لصاحب الرمز." },
  BAD_PAYLOAD: { status: 400, message: "صيغة البيانات غير صحيحة: المطلوب قائمة جهات اتصال." },
  TOO_MANY_CONTACTS: { status: 413, message: "الحد الأقصى " + MAX_CONTACTS + " جهة اتصال في الدفعة الواحدة." },
};

function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...CORS_HEADERS, ...extra },
  });
}

interface NormalizedContact {
  name: string;
  phones: string[];
}

/**
 * يقبل ما يرسله الاختصار بمرونة: {token, contacts:[{name, phones:[…]}]} أو
 * {token, contacts:[{name, phone}]}، وأرقاماً كنص واحد أو قائمة أو مفصولة بأسطر.
 */
function normalizeContacts(raw: unknown): NormalizedContact[] | null {
  if (!Array.isArray(raw)) return null;
  const out: NormalizedContact[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const name = typeof rec.name === "string" ? rec.name.trim().slice(0, 100) : "";
    const phones: string[] = [];
    const push = (v: unknown) => {
      if (typeof v === "string") {
        for (const part of v.split(/[\n,;]+/)) {
          const p = part.trim();
          if (p) phones.push(p.slice(0, 40));
        }
      } else if (typeof v === "number") {
        phones.push(String(v));
      }
    };
    if (Array.isArray(rec.phones)) rec.phones.forEach(push);
    else push(rec.phones);
    push(rec.phone);
    push(rec.tel);
    if (phones.length === 0) continue;
    out.push({ name, phones: phones.slice(0, 10) });
  }
  return out;
}

async function readPayload(request: Request): Promise<{ token: string; contacts: NormalizedContact[] } | Response> {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > MAX_BODY_BYTES) return json({ ok: false, code: "TOO_LARGE", message: "الحجم أكبر من المسموح." }, 413);

  const type = (request.headers.get("content-type") ?? "").toLowerCase();
  let body: unknown;
  try {
    if (type.includes("application/x-www-form-urlencoded") || type.includes("multipart/form-data")) {
      const form = await request.formData();
      const contactsRaw = form.get("contacts");
      body = {
        token: form.get("token"),
        contacts: typeof contactsRaw === "string" ? JSON.parse(contactsRaw) : contactsRaw,
      };
    } else {
      body = await request.json();
    }
  } catch {
    return json({ ok: false, code: "BAD_JSON", message: "تعذر قراءة البيانات: المطلوب JSON." }, 400);
  }

  const rec = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const token = typeof rec.token === "string" ? rec.token.trim() : "";
  if (!/^[a-f0-9]{32,128}$/i.test(token)) {
    return json({ ok: false, code: "INVALID_TOKEN", message: DB_ERRORS.INVALID_TOKEN.message }, 401);
  }
  const contacts = normalizeContacts(rec.contacts);
  if (!contacts) return json({ ok: false, code: "BAD_PAYLOAD", message: DB_ERRORS.BAD_PAYLOAD.message }, 400);
  if (contacts.length > MAX_CONTACTS) {
    return json({ ok: false, code: "TOO_MANY_CONTACTS", message: DB_ERRORS.TOO_MANY_CONTACTS.message }, 413);
  }
  return { token, contacts };
}

interface SupabaseTarget {
  url: string;
  anonKey: string;
}

let cachedTarget: SupabaseTarget | null = null;

/**
 * إعدادات Supabase: متغيرات التشغيل أولاً (إن ضُبطت)، وإلا runtime-config.json
 * من الأصول المبنية. تُحفظ في الذاكرة بعد أول قراءة ناجحة.
 */
async function resolveSupabase(request: Request, env: Env): Promise<SupabaseTarget | null> {
  const fromEnv: SupabaseTarget = {
    url: (env.SUPABASE_URL ?? "").trim().replace(/\/$/, ""),
    anonKey: (env.SUPABASE_ANON_KEY ?? "").trim(),
  };
  if (fromEnv.url && fromEnv.anonKey) return fromEnv;
  if (cachedTarget) return cachedTarget;

  try {
    const origin = new URL(request.url).origin;
    const res = await env.ASSETS.fetch(new Request(origin + "/runtime-config.json", { method: "GET" }));
    if (!res.ok) return null;
    const cfg = (await res.json()) as { supabaseUrl?: unknown; supabaseAnonKey?: unknown };
    const url = (fromEnv.url || String(cfg.supabaseUrl ?? "")).trim().replace(/\/$/, "");
    const anonKey = (fromEnv.anonKey || String(cfg.supabaseAnonKey ?? "")).trim();
    if (!url || !anonKey) return null;
    cachedTarget = { url, anonKey };
    return cachedTarget;
  } catch {
    return null;
  }
}

async function handleImport(request: Request, env: Env): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (request.method !== "POST") return json({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405, { allow: "POST, OPTIONS" });

  const target = await resolveSupabase(request, env);
  if (!target) {
    return json({ ok: false, code: "NOT_CONFIGURED", message: "خدمة الاستيراد غير مهيأة على هذا النطاق." }, 503);
  }
  const { url: supabaseUrl, anonKey } = target;

  const payload = await readPayload(request);
  if (payload instanceof Response) return payload;

  const upstream = await fetch(supabaseUrl + "/rest/v1/rpc/import_contacts_with_token", {
    method: "POST",
    headers: {
      apikey: anonKey,
      authorization: "Bearer " + anonKey,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({ p_token: payload.token, p_contacts: payload.contacts }),
  });

  const text = await upstream.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (!upstream.ok) {
    const message = String((data as { message?: string } | null)?.message ?? "");
    const code = Object.keys(DB_ERRORS).find((k) => message.includes(k));
    if (code) return json({ ok: false, code, message: DB_ERRORS[code].message }, DB_ERRORS[code].status);
    return json({ ok: false, code: "UPSTREAM_ERROR", message: "تعذر حفظ جهات الاتصال. حاول مرة أخرى." }, 502);
  }

  const result = (data ?? {}) as Record<string, unknown>;
  const eventId = Number(result.event_id);
  const origin = new URL(request.url).origin;
  return json({
    ok: true,
    event_id: eventId,
    inserted: Number(result.inserted ?? 0),
    duplicates: Number(result.duplicates ?? 0),
    skipped: Number(result.skipped ?? 0),
    received: Number(result.received ?? 0),
    // الاختصار يفتح هذا الرابط في النهاية ليعود المستخدم إلى المناسبة وتظهر الجهات
    redirect: Number.isFinite(eventId) ? origin + "/events/" + eventId + "?imported=1" : origin + "/events",
    message:
      "أُضيف " + Number(result.inserted ?? 0) + " مدعو" +
      (Number(result.duplicates ?? 0) > 0 ? "، ومكرر " + Number(result.duplicates ?? 0) : "") +
      (Number(result.skipped ?? 0) > 0 ? "، وبلا رقم صالح " + Number(result.skipped ?? 0) : "") + ".",
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (pathname === "/api/contacts/import") return handleImport(request, env);

    // بوابة الدفع: تحتاج إعدادات Supabase نفسها (anon عام + جلسة المستخدم)
    if (pathname === "/api/pay/create" || pathname === "/api/pay/return" || pathname === "/api/pay/webhook") {
      const target = await resolveSupabase(request, env);
      if (!target) {
        return json({ ok: false, code: "NOT_CONFIGURED", message: "خدمة الدفع غير مهيأة على هذا النطاق." }, 503);
      }
      const gateway = gatewayFor(env);
      if (pathname === "/api/pay/create") return gateway.handlePayCreate(request, env, target);
      if (pathname === "/api/pay/return") return gateway.handlePayReturn(request, env, target);
      return gateway.handlePayWebhook(request, env, target);
    }

    if (pathname === "/api/health") return json({ ok: true, service: "dawaat", time: new Date().toISOString() });
    if (pathname.startsWith("/api/")) return json({ ok: false, code: "NOT_FOUND" }, 404);

    // كل ما عدا /api يبقى كما كان: الأصول الثابتة مع سلوك SPA للمسارات الداخلية
    return serveAssets(request, env);
  },
};

/**
 * الأصول الثابتة. المسارات الداخلية للتطبيق (/events/47 مثلاً) لا تطابق ملفاً،
 * فتُعاد index.html بحالة 200 ليتولى React التوجيه — نفس سلوك
 * not_found_handling: single-page-application، مكتوب صراحةً حتى لا يعتمد على
 * إصدار wrangler أو بيئة التشغيل.
 */
async function serveAssets(request: Request, env: Env): Promise<Response> {
  const response = await env.ASSETS.fetch(request);
  if (response.status !== 404) return response;
  if (request.method !== "GET" && request.method !== "HEAD") return response;

  const url = new URL(request.url);
  const lastSegment = url.pathname.split("/").pop() ?? "";
  // ملف مفقود فعلاً (له امتداد) يبقى 404 حتى لا تُخدم صفحة HTML مكان صورة أو سكربت
  if (lastSegment.includes(".")) return response;

  const index = await env.ASSETS.fetch(new Request(url.origin + "/index.html", { method: "GET", headers: request.headers }));
  if (index.status !== 200) return response;
  const headers = new Headers(index.headers);
  headers.set("cache-control", "no-cache");
  return new Response(request.method === "HEAD" ? null : index.body, { status: 200, headers });
}
