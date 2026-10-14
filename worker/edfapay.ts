/**
 * بوابة الدفع «إدفع باي» (EdfaPay) — ثالث مزوّد على العقد المشترك نفسه.
 *
 * الفروق الجوهرية عن ميسر وبيلينك:
 *   • المصادقة ترويسة ثابتة `X-API-KEY` — لا رمز مؤقت ولا Basic.
 *   • إنشاء العملية يعيد `data.redirectUrl` فقط ولا يعيد رقم عملية، فالمرجع
 *     الذي نربط به هو `orderId` الذي نولّده نحن.
 *   • الإشعار **موقَّع**: HMAC-SHA256 بالست المشترك على الجسم الخام في ترويسة
 *     `X-EdfaPay-Signature`. هذا توثيق تعمية حقيقي، بخلاف إشعار بيلينك العاري.
 *   • حالة العملية تُستعلم برقم عملية EdfaPay (UUID) لا برقم طلبنا، ولا نعرف
 *     ذلك الرقم إلا من الإشعار نفسه — لذلك العودة لا تؤكد شيئاً أبداً هنا،
 *     والإشعار الموقَّع وحده هو ما يحسم.
 *
 * المرجع: docs.edfapay.com — Checkout Integration / Initiate / Webhook.
 */

import {
  type ConfirmOutcome,
  type GatewayEnvBase,
  type RemoteInvoice,
  type SupabaseTarget,
  JSON_HEADERS,
  beginPayCreate,
  confirmWithDb,
  dbError,
  jsonResponse,
  rpc,
} from "./gateway-common";

export interface EdfaPayEnv extends GatewayEnvBase {
  /** مفتاح الـ API من لوحة إدفع باي ← الإعدادات ← General ← Api Key */
  EDFAPAY_API_KEY?: string;
  /** السر المشترك المسجَّل في Configurations ← Web Hook — بدونه لا يُؤكَّد دفع */
  EDFAPAY_WEBHOOK_SECRET?: string;
}

const API_BASE = "https://app-api.edfapay.com/api/v1";

/** الوثائق لا تنص على حد أدنى سوى «أكبر من صفر»؛ نضع ريالاً حدّاً عملياً */
export const EDFAPAY_MIN_AMOUNT = 1;

export function edfapayConfigured(env: EdfaPayEnv): boolean {
  return Boolean((env.EDFAPAY_API_KEY ?? "").trim());
}

function authHeaders(env: EdfaPayEnv): Record<string, string> {
  return { ...JSON_HEADERS, "X-API-KEY": (env.EDFAPAY_API_KEY ?? "").trim() };
}

/** مرجعنا الخاص: هو ما نخزّنه في provider_ref وما يعيده الإشعار في orderId */
function buildOrderId(paymentId: number): string {
  return "DAWAAT-" + paymentId + "-" + Date.now().toString(36);
}

/** أخطاء إدفع باي: { code, message, errorCode } — نلتقط الحالة فقط للسجل */
function edfaError(status: number, raw: string): Error {
  let errorCode = "";
  try {
    errorCode = String((JSON.parse(raw) as { errorCode?: string }).errorCode ?? "");
  } catch {
    errorCode = "";
  }
  // رمز الحالة ورمز الخطأ فقط — بلا مفاتيح ولا حمولة كاملة
  console.error("edfapay api error", { status, errorCode });
  return new Error("EDFAPAY_ERROR:" + status + ":" + errorCode);
}

interface InitiateResponse {
  code?: number;
  data?: { redirectUrl?: string } | null;
}

async function initiatePayment(env: EdfaPayEnv, fields: Record<string, unknown>): Promise<string> {
  const res = await fetch(API_BASE + "/payment-gateway/initiate", {
    method: "POST",
    headers: authHeaders(env),
    body: JSON.stringify(fields),
  });
  const raw = await res.text();
  if (!res.ok) throw edfaError(res.status, raw);
  let data: InitiateResponse | null = null;
  try {
    data = JSON.parse(raw) as InitiateResponse;
  } catch {
    data = null;
  }
  const url = data?.data?.redirectUrl ?? "";
  if (!url) throw edfaError(res.status, raw);
  return url;
}

/** رسالة للعميل بلا أي تفصيل تقني — الشرط العاشر */
function createFailureResponse(err: unknown): Response {
  const msg = err instanceof Error ? err.message : "";
  const status = Number(msg.split(":")[1]);
  if (status === 401 || status === 403) {
    console.error("edfapay credentials rejected — update EDFAPAY_API_KEY in Cloudflare");
    return jsonResponse(
      {
        ok: false,
        code: "GATEWAY_AUTH",
        message: "تعذر بدء الدفع بالبطاقة — إعداد بوابة الدفع يحتاج مراجعة من الإدارة. حاول لاحقاً أو تواصل مع الدعم.",
      },
      502,
    );
  }
  return jsonResponse(
    { ok: false, code: "GATEWAY_UNAVAILABLE", message: "تعذر إنشاء عملية الدفع. حاول مرة أخرى." },
    502,
  );
}

// ─────────────────────────── ١) إنشاء رابط الدفع ───────────────────────────

export async function handlePayCreate(
  request: Request,
  env: EdfaPayEnv,
  target: SupabaseTarget,
): Promise<Response> {
  if (!edfapayConfigured(env)) {
    return jsonResponse(
      { ok: false, code: "GATEWAY_NOT_CONFIGURED", message: "الدفع بالبطاقة غير مهيأ بعد — استخدم التحويل البنكي." },
      503,
    );
  }

  const begun = await beginPayCreate(request, target, EDFAPAY_MIN_AMOUNT);
  if ("done" in begun) return begun.done;
  const { jwt, eventId, payment, body } = begun;

  const origin = new URL(request.url).origin;
  const orderId = buildOrderId(payment.id);
  // العودة تحمل مناسبتنا فقط لنعرف أين نعيد العميل — ولا تُستعمل إثباتاً إطلاقاً
  const backTo = origin + "/api/pay/return?event=" + eventId;

  let redirectUrl: string;
  try {
    redirectUrl = await initiatePayment(env, {
      orderId,
      currency: payment.currency || "SAR",
      amount: payment.amount,
      auth: "N",
      successUrl: backTo,
      failureUrl: backTo,
      customerDetails: {
        name: String(body.clientName ?? "عميل دعوات").slice(0, 80),
        email: String(body.clientEmail ?? "").slice(0, 120),
        phone: String(body.clientMobile ?? "").slice(0, 20),
      },
    });
  } catch (err) {
    return createFailureResponse(err);
  }

  // ربط مرجعنا بالعملية — بجلسة المستخدم (RLS تحمي الملكية)
  const attached = await rpc(
    target,
    "attach_gateway_payment",
    { p_payment_id: payment.id, p_provider: "edfapay", p_provider_ref: orderId },
    jwt,
  );
  if (!attached.ok) return dbError(attached.message);

  return jsonResponse({
    ok: true,
    paymentId: payment.id,
    eventId,
    amount: payment.amount,
    transactionNo: orderId,
    url: redirectUrl,
  });
}

// ──────────────────────────── ٢) العودة من الصفحة ────────────────────────────

/**
 * إدفع باي لا تتيح الاستعلام برقم طلبنا، ولا تمرّر رقم عمليتها في العودة.
 * فالعودة هنا لا تؤكد ولا ترفض: تعيد العميل لمناسبته والواجهة تستطلع الحالة
 * كل خمس ثوانٍ حتى يصل الإشعار الموقَّع ويحسمها.
 */
export async function handlePayReturn(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const eventId = Number(url.searchParams.get("event"));
  const base = Number.isInteger(eventId) && eventId > 0 ? "/events/" + eventId : "/events";
  return Response.redirect(url.origin + base + "?payment=pending", 302);
}

// ───────────────────────── ٣) الإشعار الموقَّع (الحاسم) ─────────────────────────

/** HMAC-SHA256 بالهكس على الجسم الخام — كما توثّقه إدفع باي */
async function hmacHex(secret: string, raw: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(raw));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** مقارنة ثابتة الزمن — لا تُسرّب طول السر ولا موضع الاختلاف */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

interface WebhookBody {
  transactionId?: string;
  orderId?: string;
  amount?: number | string;
  status?: string;
  type?: string;
}

/**
 * قراءة حالة العملية من حمولة موقَّعة.
 *   Approved + Purchase/Capture ⇒ مدفوعة
 *   Declined                    ⇒ مرفوضة
 *   Redirect/Pending            ⇒ لم تُحسم بعد
 * ما عداها (Refund/Void/Authorization) لا يغيّر حالة الدفع عندنا.
 */
function readState(payload: WebhookBody): RemoteInvoice | null {
  const status = String(payload.status ?? "").toLowerCase();
  const type = String(payload.type ?? "").toLowerCase();
  const amount = Number(payload.amount ?? 0);

  if (status === "redirect" || status === "pending") {
    return { paid: false, pending: true, amount };
  }
  if (status === "approved" && (type === "purchase" || type === "capture")) {
    return { paid: true, pending: false, amount };
  }
  if (status === "declined") {
    return { paid: false, pending: false, amount };
  }
  return null;
}

/**
 * تحقّق إضافي من إدفع باي نفسها برقم عمليتها. الحمولة موقَّعة أصلاً بسر لا
 * يعرفه غيرنا وغيرهم، فهذا دفاع ثانٍ لا أساسي: تعذّر الوصول لا يمنع التأكيد،
 * لكن إقرارهم الصريح بالفشل يمنعه.
 */
async function contradictedByApi(env: EdfaPayEnv, transactionId: string): Promise<boolean> {
  if (!transactionId) return false;
  try {
    const res = await fetch(
      API_BASE + "/transactions/filterTransaction?id=" + encodeURIComponent(transactionId),
      { headers: authHeaders(env) },
    );
    if (!res.ok) return false;
    const data = (await res.json()) as {
      data?: { content?: Array<{ transactionStatus?: string; paymentStatus?: string }> };
    };
    const row = data?.data?.content?.[0];
    if (!row) return false;
    const t = String(row.transactionStatus ?? "").toUpperCase();
    const p = String(row.paymentStatus ?? "").toUpperCase();
    return t === "FAILED" || p === "DECLINED";
  } catch {
    return false;
  }
}

export async function handlePayWebhook(
  request: Request,
  env: EdfaPayEnv,
  target: SupabaseTarget,
): Promise<Response> {
  if (request.method !== "POST") {
    return jsonResponse({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405, { allow: "POST" });
  }

  const secret = (env.EDFAPAY_WEBHOOK_SECRET ?? "").trim();
  if (!secret) {
    // بلا سر لا توقيع، وبلا توقيع لا سبيل لتمييز إشعار حقيقي من مزوَّر
    console.error("edfapay webhook secret missing — set EDFAPAY_WEBHOOK_SECRET in Cloudflare");
    return jsonResponse({ ok: false, code: "NO_WEBHOOK_SECRET" }, 503);
  }

  // الجسم الخام كما وصل تماماً — إعادة ترتيب JSON تكسر التوقيع
  const raw = await request.text();
  const given = (request.headers.get("x-edfapay-signature") ?? "").trim().toLowerCase();
  const expected = await hmacHex(secret, raw);
  if (!given || !timingSafeEqual(given, expected)) {
    // لا نكشف السبب للمُرسِل
    return jsonResponse({ ok: false, code: "FORBIDDEN" }, 403);
  }

  let payload: WebhookBody = {};
  try {
    payload = JSON.parse(raw) as WebhookBody;
  } catch {
    return jsonResponse({ ok: false, code: "BAD_JSON" }, 400);
  }

  const orderId = String(payload.orderId ?? "");
  if (!orderId) return jsonResponse({ ok: true, ignored: true });

  const state = readState(payload);
  // حدث لا يخص حسم الدفع (استرداد أو إلغاء تفويض): نستلمه ولا نغيّر شيئاً
  if (!state) return jsonResponse({ ok: true, ignored: true });

  if (state.paid && (await contradictedByApi(env, String(payload.transactionId ?? "")))) {
    console.error("edfapay webhook says approved but status api reports failure", { orderId });
    return jsonResponse({ ok: false, code: "CONTRADICTED" }, 503);
  }

  const outcome: ConfirmOutcome = await confirmWithDb(env, target, orderId, state);
  // 2xx فقط عند المعالجة الناجحة — غير ذلك يعيد المزود المحاولة
  if (!outcome.ok) return jsonResponse({ ok: false, code: outcome.code ?? "ERROR" }, 503);
  return jsonResponse({ ok: true, paid: outcome.paid });
}
