/**
 * بوابة الدفع «ميسر» (Moyasar) — بديل بيلينك بنفس العقد تماماً.
 *
 * الفروق الجوهرية عن بيلينك:
 *   • المصادقة HTTP Basic بالمفتاح السري وكلمة مرور فارغة — لا رمز مؤقت.
 *   • المبالغ بالهللات (عدد صحيح)، والحد الأدنى 100 هللة = ريال واحد
 *     (بيلينك حدّه ٥ ريالات).
 *   • الفاتورة تُنشأ بطلب واحد وتُعيد `url` لصفحة دفع مستضافة و`id` نربطه
 *     بالعملية بدل transactionNo.
 *   • الإشعار يصل بصيغتين: callback_url للفاتورة (جسمه كائن الفاتورة)، أو
 *     webhook مسجَّل (جسمه { type, secret_token, data }). نقبل الاثنتين.
 *
 * الأمان كما هو: لا نثق بالعودة ولا بحمولة الإشعار — نسأل ميسر عن الفاتورة
 * (GET /v1/invoices/:id) ثم نؤكد في القاعدة بالسر المشترك.
 *
 * المرجع: docs.moyasar.com — Invoices API، Webhooks، Errors.
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
  returnRedirect,
  rpc,
} from "./gateway-common";

export interface MoyasarEnv extends GatewayEnvBase {
  /** sk_test_… أثناء التجربة، sk_live_… بعد تفعيل الحساب */
  MOYASAR_SECRET_KEY?: string;
  /** السر المشترك المسجَّل في لوحة ميسر للـ webhook (secret_token) */
  MOYASAR_WEBHOOK_SECRET?: string;
}

const API_BASE = "https://api.moyasar.com/v1";

/** ميسر: الحد الأدنى 100 هللة = ريال واحد */
export const MOYASAR_MIN_AMOUNT = 1;

export function moyasarConfigured(env: MoyasarEnv): boolean {
  return Boolean((env.MOYASAR_SECRET_KEY ?? "").trim());
}

/** Basic بالمفتاح السري وكلمة مرور فارغة — هكذا توثّقه ميسر */
function authHeader(env: MoyasarEnv): string {
  const key = (env.MOYASAR_SECRET_KEY ?? "").trim();
  return "Basic " + btoa(key + ":");
}

/** ريال → هللة. نُقرّب لتفادي أخطاء الفاصلة العائمة (17.75 ⇒ 1775) */
function toHalalas(amountSar: number): number {
  return Math.round(amountSar * 100);
}

function toSar(halalas: number): number {
  return Math.round(halalas) / 100;
}

interface MoyasarInvoice {
  id: string;
  status: string;
  amount: number;
  currency: string;
  url?: string;
}

/** أخطاء ميسر: { type, message, errors } — نلتقط النوع لتمييز الحساب غير المفعّل */
function moyasarError(status: number, raw: string): Error {
  let type = "";
  try {
    type = String((JSON.parse(raw) as { type?: string }).type ?? "");
  } catch {
    type = "";
  }
  // رمز الحالة ونوع الخطأ فقط في السجل — بلا مفاتيح ولا حمولة كاملة
  console.error("moyasar api error", { status, type });
  return new Error("MOYASAR_ERROR:" + status + ":" + type);
}

async function createInvoice(
  env: MoyasarEnv,
  fields: Record<string, unknown>,
): Promise<MoyasarInvoice> {
  const res = await fetch(API_BASE + "/invoices", {
    method: "POST",
    headers: { ...JSON_HEADERS, authorization: authHeader(env) },
    body: JSON.stringify(fields),
  });
  const raw = await res.text();
  if (!res.ok) throw moyasarError(res.status, raw);
  let data: MoyasarInvoice | null = null;
  try {
    data = JSON.parse(raw) as MoyasarInvoice;
  } catch {
    data = null;
  }
  if (!data?.id || !data?.url) throw moyasarError(res.status, raw);
  return data;
}

async function fetchInvoice(env: MoyasarEnv, id: string): Promise<MoyasarInvoice> {
  const res = await fetch(API_BASE + "/invoices/" + encodeURIComponent(id), {
    headers: { ...JSON_HEADERS, authorization: authHeader(env) },
  });
  const raw = await res.text();
  if (!res.ok) throw moyasarError(res.status, raw);
  return JSON.parse(raw) as MoyasarInvoice;
}

/**
 * رسالة للعميل بلا أي تفصيل تقني.
 * 405 + account_inactive_error = الحساب لم يُفعَّل للمدفوعات الحقيقية بعد.
 */
function createFailureResponse(err: unknown): Response {
  const msg = err instanceof Error ? err.message : "";
  const [, statusText, type] = msg.split(":");
  const status = Number(statusText);
  if (status === 405 || type === "account_inactive_error") {
    console.error("moyasar account not activated for live payments — activate the account in the Moyasar dashboard");
    return jsonResponse(
      {
        ok: false,
        code: "GATEWAY_NOT_ACTIVE",
        message: "الدفع بالبطاقة غير متاح مؤقتاً لهذا الموقع. تواصل مع الدعم لإتمام الدفع.",
      },
      502,
    );
  }
  if (status === 401 || status === 403 || type === "authentication_error") {
    console.error("moyasar credentials rejected — update MOYASAR_SECRET_KEY in Cloudflare");
    return jsonResponse(
      {
        ok: false,
        code: "GATEWAY_AUTH",
        message: "تعذر بدء الدفع بالبطاقة — إعداد بوابة الدفع يحتاج مراجعة من الإدارة. حاول لاحقاً أو تواصل مع الدعم.",
      },
      502,
    );
  }
  return jsonResponse({ ok: false, code: "GATEWAY_UNAVAILABLE", message: "تعذر إنشاء فاتورة الدفع. حاول مرة أخرى." }, 502);
}

// ─────────────────────────── ١) إنشاء رابط الدفع ───────────────────────────

export async function handlePayCreate(
  request: Request,
  env: MoyasarEnv,
  target: SupabaseTarget,
): Promise<Response> {
  if (!moyasarConfigured(env)) {
    return jsonResponse(
      { ok: false, code: "GATEWAY_NOT_CONFIGURED", message: "الدفع بالبطاقة غير مهيأ بعد — استخدم التحويل البنكي." },
      503,
    );
  }

  const begun = await beginPayCreate(request, target, MOYASAR_MIN_AMOUNT);
  if ("done" in begun) return begun.done;
  const { jwt, eventId, payment } = begun;

  const origin = new URL(request.url).origin;

  let invoice: MoyasarInvoice;
  try {
    invoice = await createInvoice(env, {
      amount: toHalalas(payment.amount),
      currency: payment.currency || "SAR",
      description: "رسوم إرسال دعوات المناسبة رقم " + eventId,
      // إشعار خادم لخادم بكائن الفاتورة — لا يعيد توجيه العميل
      callback_url: origin + "/api/pay/webhook",
      // وجهة العميل بعد الدفع، ومنها نتحقق مرة أخرى قبل أي إقرار
      success_url: origin + "/api/pay/return",
      back_url: origin + "/events/" + eventId + "?payment=cancelled",
      metadata: { event_id: String(eventId), payment_id: String(payment.id) },
    });
  } catch (err) {
    return createFailureResponse(err);
  }

  // ربط معرّف فاتورة ميسر بالعملية — بجلسة المستخدم (RLS تحمي الملكية)
  const attached = await rpc(
    target,
    "attach_gateway_payment",
    { p_payment_id: payment.id, p_provider: "moyasar", p_provider_ref: invoice.id },
    jwt,
  );
  if (!attached.ok) return dbError(attached.message);

  return jsonResponse({
    ok: true,
    paymentId: payment.id,
    eventId,
    amount: payment.amount,
    transactionNo: invoice.id,
    url: invoice.url,
  });
}

// ──────────────────── ٢) التحقق والتأكيد (العودة والإشعار) ────────────────────

/** نسأل ميسر عن الفاتورة؛ حالتها ومبلغها وحدهما مصدر الحقيقة */
async function verifyAndConfirm(
  env: MoyasarEnv,
  target: SupabaseTarget,
  invoiceId: string,
): Promise<ConfirmOutcome> {
  let invoice: MoyasarInvoice;
  try {
    invoice = await fetchInvoice(env, invoiceId);
  } catch {
    return { ok: false, paid: false, eventId: null, code: "GATEWAY_UNAVAILABLE" };
  }

  const status = String(invoice.status ?? "").toLowerCase();
  const state: RemoteInvoice = {
    paid: status === "paid",
    // initiated/on_hold = لم يُحسم بعد؛ ما عداهما فشل أو إلغاء أو انتهاء
    pending: status === "initiated" || status === "on_hold",
    amount: toSar(Number(invoice.amount ?? 0)),
  };
  return confirmWithDb(env, target, invoiceId, state);
}

export async function handlePayReturn(
  request: Request,
  env: MoyasarEnv,
  target: SupabaseTarget,
): Promise<Response> {
  const url = new URL(request.url);
  // ميسر توثّق إلحاق id فقط؛ نقبل بدائل تحسباً ولا نثق بأي منها كإثبات دفع
  const invoiceId =
    url.searchParams.get("invoice_id") || url.searchParams.get("id") || "";

  if (!invoiceId) return Response.redirect(url.origin + "/events?payment=unknown", 302);

  const outcome = await verifyAndConfirm(env, target, invoiceId);
  return returnRedirect(request, outcome);
}

export async function handlePayWebhook(
  request: Request,
  env: MoyasarEnv,
  target: SupabaseTarget,
): Promise<Response> {
  if (request.method !== "POST") {
    return jsonResponse({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405, { allow: "POST" });
  }

  let payload: Record<string, unknown> = {};
  try {
    payload = (await request.json()) as Record<string, unknown>;
  } catch {
    payload = {};
  }

  // صيغة (أ): webhook مسجَّل — { type, secret_token, data }
  // ميسر لا توقّع الطلب، فالسر المشترك في الجسم هو وسيلة التحقق الوحيدة.
  const expected = (env.MOYASAR_WEBHOOK_SECRET ?? "").trim();
  const token = String(payload.secret_token ?? "");
  let invoiceId = "";

  if (payload.data && typeof payload.data === "object") {
    if (expected && !timingSafeEqual(token, expected)) {
      // لا نكشف السبب للمُرسِل
      return jsonResponse({ ok: false, code: "FORBIDDEN" }, 403);
    }
    const data = payload.data as Record<string, unknown>;
    invoiceId = String(data.invoice_id ?? "");
    // حدث card_auth أو دفعة بلا فاتورة: لا شيء نؤكده
    if (!invoiceId) return jsonResponse({ ok: true, ignored: true });
  } else {
    // صيغة (ب): callback_url للفاتورة — الجسم كائن الفاتورة نفسه
    invoiceId = String(payload.id ?? "");
  }

  if (!invoiceId) return jsonResponse({ ok: false, code: "NO_INVOICE" }, 400);

  const outcome = await verifyAndConfirm(env, target, invoiceId);
  // 2xx فقط عند المعالجة الناجحة — غير ذلك تعيد ميسر المحاولة (٥ مرات)
  if (!outcome.ok) return jsonResponse({ ok: false, code: outcome.code ?? "ERROR" }, 503);
  return jsonResponse({ ok: true, paid: outcome.paid });
}

/** مقارنة ثابتة الزمن — لا تُسرّب طول السر ولا موضع الاختلاف */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
