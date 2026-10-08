/**
 * المشترك بين بوابات الدفع (بيلينك، ميسر، وأي بوابة لاحقة).
 *
 * العقد واحد لكل البوابات:
 *   POST /api/pay/create  ← الموقع بجلسة المستخدم
 *   GET  /api/pay/return  ← عودة العميل من صفحة البوابة
 *   POST /api/pay/webhook ← إشعار البوابة خادماً لخادم
 *
 * والأمان واحد أيضاً:
 *   • مفاتيح البوابة لا تخرج من الـ Worker.
 *   • لا تُصدَّق العودة ولا حمولة الـ webhook؛ نسأل البوابة عن حالة الفاتورة
 *     ومبلغها ثم نؤكد في القاعدة بالسر المشترك (confirm_gateway_payment).
 *   • لا مفتاح service_role في أي مكان.
 */

export interface SupabaseTarget {
  url: string;
  anonKey: string;
}

/** ما تحتاجه كل بوابة من البيئة، مهما كان مزوّدها */
export interface GatewayEnvBase {
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
  /** السر المشترك مع قاعدة البيانات لتأكيد الدفع */
  GATEWAY_SHARED_SECRET?: string;
}

export const JSON_HEADERS = { "content-type": "application/json", accept: "application/json" };

export function jsonResponse(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...extra },
  });
}

/** استدعاء دالة في القاعدة. userJwt موجود ⇒ تعمل بصلاحيات المستخدم نفسه. */
export async function rpc(
  target: SupabaseTarget,
  fn: string,
  args: Record<string, unknown>,
  userJwt?: string,
): Promise<{ ok: boolean; status: number; data: unknown; message: string }> {
  const res = await fetch(target.url + "/rest/v1/rpc/" + fn, {
    method: "POST",
    headers: {
      apikey: target.anonKey,
      authorization: "Bearer " + (userJwt || target.anonKey),
      ...JSON_HEADERS,
    },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  const message = String((data as { message?: string } | null)?.message ?? "");
  return { ok: res.ok, status: res.status, data, message };
}

export function bearerFrom(request: Request): string {
  const raw = request.headers.get("authorization") ?? "";
  return /^Bearer\s+(.+)$/i.test(raw) ? raw.replace(/^Bearer\s+/i, "").trim() : "";
}

/** رسائل عربية لأخطاء القاعدة */
export const DB_ERRORS: Record<string, { status: number; message: string }> = {
  AUTH_REQUIRED: { status: 401, message: "سجّل الدخول أولاً ثم أعد المحاولة." },
  EVENT_NOT_FOUND: { status: 404, message: "المناسبة غير موجودة أو ليست لحسابك." },
  PAYMENT_NOT_FOUND: { status: 404, message: "عملية الدفع غير موجودة." },
  PAYMENT_NOT_EDITABLE: { status: 409, message: "هذه العملية لا يمكن تعديلها — حدّث الصفحة." },
  AMOUNT_MISMATCH: { status: 409, message: "المبلغ المدفوع لا يطابق المطلوب." },
  BAD_GATEWAY_SECRET: { status: 403, message: "تعذر تأكيد الدفع." },
};

export function dbError(message: string): Response {
  const code = Object.keys(DB_ERRORS).find((k) => message.includes(k));
  if (code) return jsonResponse({ ok: false, code, message: DB_ERRORS[code].message }, DB_ERRORS[code].status);
  return jsonResponse({ ok: false, code: "DB_ERROR", message: "تعذر إتمام العملية. حاول مرة أخرى." }, 502);
}

/** عملية الدفع كما ترجعها request_event_payment */
export interface PaymentRow {
  id: number;
  amount: number;
  currency: string;
  status: string;
}

/**
 * الخطوة الأولى المشتركة في /api/pay/create: التحقق من الجلسة وقراءة
 * المناسبة وإنشاء/جلب عملية الدفع بجلسة المستخدم (RLS تحمي الملكية).
 *
 * ترجع إمّا Response جاهزة للإرجاع فوراً (خطأ أو «مدفوعة سلفاً»)، أو العملية.
 */
export async function beginPayCreate(
  request: Request,
  target: SupabaseTarget,
  minAmount: number,
): Promise<{ done: Response } | { jwt: string; eventId: number; payment: PaymentRow; body: Record<string, unknown> }> {
  if (request.method !== "POST") {
    return { done: jsonResponse({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405, { allow: "POST" }) };
  }

  const jwt = bearerFrom(request);
  if (!jwt) {
    return { done: jsonResponse({ ok: false, code: "AUTH_REQUIRED", message: DB_ERRORS.AUTH_REQUIRED.message }, 401) };
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return { done: jsonResponse({ ok: false, code: "BAD_JSON", message: "صيغة الطلب غير صحيحة." }, 400) };
  }

  const eventId = Number(body.eventId);
  if (!Number.isInteger(eventId) || eventId <= 0) {
    return { done: jsonResponse({ ok: false, code: "BAD_EVENT", message: "المناسبة غير صحيحة." }, 400) };
  }

  const created = await rpc(target, "request_event_payment", { p_event_id: eventId }, jwt);
  if (!created.ok) return { done: dbError(created.message) };

  const row = (Array.isArray(created.data) ? created.data[0] : created.data) as {
    id?: number;
    amount?: number | string;
    currency?: string;
    status?: string;
  } | null;
  if (!row?.id) {
    return {
      done: jsonResponse({ ok: false, code: "PAYMENT_NOT_FOUND", message: DB_ERRORS.PAYMENT_NOT_FOUND.message }, 404),
    };
  }

  const amount = Number(row.amount ?? 0);
  // الرسوم صفر أو مدفوعة سلفاً: لا داعي لبوابة الدفع إطلاقاً
  if (row.status === "paid" || amount <= 0) {
    return { done: jsonResponse({ ok: true, alreadyPaid: true, paymentId: row.id, eventId }) };
  }
  if (amount < minAmount) {
    return {
      done: jsonResponse(
        {
          ok: false,
          code: "AMOUNT_TOO_SMALL",
          message: `أقل مبلغ للدفع بالبطاقة ${minAmount} ريال — استخدم التحويل البنكي.`,
        },
        400,
      ),
    };
  }

  return {
    jwt,
    eventId,
    body,
    payment: { id: row.id, amount, currency: String(row.currency ?? "SAR"), status: String(row.status ?? "pending") },
  };
}

export interface ConfirmOutcome {
  ok: boolean;
  paid: boolean;
  eventId: number | null;
  code?: string;
}

/** ما تعرفه البوابة عن فاتورة بعد سؤالها مباشرة */
export interface RemoteInvoice {
  /** مدفوعة فعلاً عند البوابة */
  paid: boolean;
  /** ما زالت معلّقة — لا تُرفض بل تُترك */
  pending: boolean;
  /** المبلغ الحقيقي كما سجّلته البوابة، بالريال */
  amount: number;
}

/**
 * التأكيد المشترك: بعد أن تسأل البوابةُ نفسَها عن الفاتورة، نؤكد في القاعدة
 * بالسر المشترك. المبلغ المرسل هو ما قالته البوابة لا ما قاله المتصفح.
 */
export async function confirmWithDb(
  env: GatewayEnvBase,
  target: SupabaseTarget,
  providerRef: string,
  state: RemoteInvoice,
): Promise<ConfirmOutcome> {
  const secret = (env.GATEWAY_SHARED_SECRET ?? "").trim();
  if (!secret) return { ok: false, paid: false, eventId: null, code: "NO_SHARED_SECRET" };

  // معلّقة: ليست فشلاً — نتركها كما هي ليُعيد المزود المحاولة لاحقاً
  if (state.pending) return { ok: true, paid: false, eventId: null, code: "PENDING" };

  const confirmed = await rpc(target, "confirm_gateway_payment", {
    p_secret: secret,
    p_provider_ref: providerRef,
    p_amount: state.amount,
    p_paid: state.paid,
  });
  if (!confirmed.ok) {
    return { ok: false, paid: false, eventId: null, code: confirmed.message || "CONFIRM_FAILED" };
  }

  const out = confirmed.data as { event_id?: number; status?: string } | null;
  return {
    ok: true,
    paid: out?.status === "paid",
    eventId: typeof out?.event_id === "number" ? out.event_id : null,
  };
}

/** إعادة توجيه موحّدة بعد العودة من صفحة البوابة */
export function returnRedirect(request: Request, outcome: ConfirmOutcome): Response {
  const origin = new URL(request.url).origin;
  const to = (path: string) => Response.redirect(origin + path, 302);
  if (!outcome.ok) return to("/events?payment=error");
  const base = outcome.eventId ? "/events/" + outcome.eventId : "/events";
  return to(base + (outcome.paid ? "?payment=paid" : "?payment=pending"));
}
