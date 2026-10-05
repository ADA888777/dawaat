/**
 * بوابة الدفع «بيلينك» — كل ما يلمس المفاتيح السرية يعيش هنا، في الخادم فقط.
 *
 * المسارات:
 *   POST /api/pay/create    ← الموقع (بجلسة المستخدم) يطلب رابط دفع لمناسبة.
 *                             ينشئ/يجلب عملية الدفع بجلسة المستخدم، ثم ينشئ
 *                             فاتورة في بيلينك ويربط رقمها بالعملية، ويعيد الرابط.
 *   GET  /api/pay/return    ← بيلينك يعيد العميل إلى هنا بعد الدفع. نتحقق من
 *                             بيلينك مباشرة ثم نؤكد في القاعدة ونحوّله للمناسبة.
 *   POST /api/pay/webhook   ← نداء خادم-لخادم من بيلينك. لا نثق بحمولته:
 *                             نعيد التحقق من بيلينك ثم نؤكد. يرد 200 دائماً
 *                             عند النجاح وإلا يعيد بيلينك المحاولة حتى 10 مرات.
 *
 * الأمان:
 *   • PAYLINK_API_ID و PAYLINK_SECRET_KEY أسرار تشغيل في Cloudflare، لا تصل
 *     المتصفح أبداً ولا تُكتب في المستودع.
 *   • تعليم العملية «مدفوعة» يتم بدالة confirm_gateway_payment التي تتطلب
 *     GATEWAY_SHARED_SECRET — فلا يكفي مفتاح anon العام لتزويرها.
 *   • لا نثق بأي مبلغ أو حالة قادمة من المتصفح أو من حمولة الـ webhook:
 *     المصدر الوحيد هو getInvoice من بيلينك، والقاعدة تتحقق من تطابق المبلغ.
 */

export interface PaylinkEnv {
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
  /** restapi.paylink.sa للإنتاج، restpilot.paylink.sa للتجربة */
  PAYLINK_BASE?: string;
  PAYLINK_API_ID?: string;
  PAYLINK_SECRET_KEY?: string;
  /** نفس القيمة المضبوطة في القاعدة عبر set_gateway_secret */
  GATEWAY_SHARED_SECRET?: string;
}

export interface SupabaseTarget {
  url: string;
  anonKey: string;
}

const PROD_BASE = "https://restapi.paylink.sa";
const JSON_HEADERS = { "content-type": "application/json", accept: "application/json" };

export function jsonResponse(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra },
  });
}

function paylinkBase(env: PaylinkEnv): string {
  return (env.PAYLINK_BASE || PROD_BASE).trim().replace(/\/$/, "");
}

export function paylinkConfigured(env: PaylinkEnv): boolean {
  return Boolean((env.PAYLINK_API_ID ?? "").trim() && (env.PAYLINK_SECRET_KEY ?? "").trim());
}

/** رمز بيلينك قصير العمر (persistToken=false ⇒ 30 دقيقة) — يُطلب لكل عملية */
async function paylinkToken(env: PaylinkEnv): Promise<string> {
  const res = await fetch(paylinkBase(env) + "/api/auth", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({
      apiId: (env.PAYLINK_API_ID ?? "").trim(),
      secretKey: (env.PAYLINK_SECRET_KEY ?? "").trim(),
      persistToken: false,
    }),
  });
  const data = (await res.json().catch(() => null)) as { id_token?: string } | null;
  if (!res.ok || !data?.id_token) {
    // رمز الحالة فقط — لا نسجّل المفاتيح ولا جسم الرد الذي قد يحويها
    console.error("paylink auth failed", { status: res.status, base: paylinkBase(env) });
    throw new Error("PAYLINK_AUTH_FAILED:" + res.status);
  }
  return data.id_token;
}

/**
 * رسالة دقيقة بدل «غير متاحة» العامة: 401/403 من بيلينك تعني أن المفاتيح في
 * Cloudflare لا تطابق حساب بيلينك (غالباً جُدِّد Secret Key بعد ضبطها)، وما
 * عداها عطل شبكة أو عند بيلينك. الرسالة للأدمن عملياً لكنها آمنة للعميل.
 */
function authFailureResponse(err: unknown): Response {
  const msg = err instanceof Error ? err.message : String(err);
  const status = Number((msg.match(/^PAYLINK_AUTH_FAILED:(\d+)/) ?? [])[1] ?? 0);
  if (status === 401 || status === 403) {
    // التفصيل التقني (أسماء المتغيرات) في سجلات Cloudflare فقط — العميل يرى سبباً
    // مفهوماً بلا أي اسم متغير أو مفتاح.
    console.error(
      "paylink credentials rejected — update PAYLINK_API_ID / PAYLINK_SECRET_KEY in Cloudflare to match my.paylink.sa/private/api-keys",
    );
    return jsonResponse(
      {
        ok: false,
        code: "GATEWAY_AUTH",
        message: "تعذر بدء الدفع بالبطاقة — إعداد بوابة الدفع يحتاج مراجعة من الإدارة. حاول لاحقاً أو تواصل مع الدعم.",
      },
      502,
    );
  }
  return jsonResponse({ ok: false, code: "GATEWAY_UNAVAILABLE", message: "بوابة الدفع غير متاحة الآن." }, 502);
}

interface InvoiceResult {
  url: string;
  transactionNo: string;
}

async function addInvoice(
  env: PaylinkEnv,
  token: string,
  body: Record<string, unknown>,
): Promise<InvoiceResult> {
  const res = await fetch(paylinkBase(env) + "/api/addInvoice", {
    method: "POST",
    headers: { ...JSON_HEADERS, authorization: "Bearer " + token },
    body: JSON.stringify(body),
  });
  const raw = await res.text().catch(() => "");
  let data: { url?: string; transactionNo?: string; success?: boolean; detail?: string; message?: string } | null = null;
  try { data = JSON.parse(raw); } catch { data = null; }
  if (!res.ok || !data?.url || !data?.transactionNo) {
    // سبب بيلينك (مثل «تجاوزت الحد الشهري المسموح به … 0 ريال» لحساب لم يُفعَّل بعد)
    // يُسجَّل للإدارة فقط — بلا مفاتيح ولا رمز الجلسة.
    const reason = String(data?.detail ?? data?.message ?? raw).slice(0, 300);
    console.error("paylink addInvoice failed", { status: res.status, reason });
    throw new Error("PAYLINK_INVOICE_FAILED:" + res.status);
  }
  return { url: String(data.url), transactionNo: String(data.transactionNo) };
}

interface InvoiceState {
  orderStatus: string;
  amount: number;
  orderNumber: string;
}

/** المصدر الوحيد للحقيقة عن حالة الدفع */
async function getInvoice(env: PaylinkEnv, token: string, transactionNo: string): Promise<InvoiceState> {
  const res = await fetch(paylinkBase(env) + "/api/getInvoice/" + encodeURIComponent(transactionNo), {
    method: "GET",
    headers: { ...JSON_HEADERS, authorization: "Bearer " + token },
  });
  const data = (await res.json().catch(() => null)) as
    | { orderStatus?: string; amount?: number | string; orderNumber?: string }
    | null;
  if (!res.ok || !data) throw new Error("PAYLINK_LOOKUP_FAILED");
  return {
    orderStatus: String(data.orderStatus ?? ""),
    amount: Number(data.amount ?? 0),
    orderNumber: String(data.orderNumber ?? ""),
  };
}

// ─────────────────────────── جسر قاعدة البيانات ───────────────────────────

/** استدعاء دالة في القاعدة. userJwt موجود ⇒ تعمل بصلاحيات المستخدم نفسه. */
async function rpc(
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

function bearerFrom(request: Request): string {
  const raw = request.headers.get("authorization") ?? "";
  return /^Bearer\s+(.+)$/i.test(raw) ? raw.replace(/^Bearer\s+/i, "").trim() : "";
}

/** رسائل عربية لأخطاء القاعدة */
const DB_ERRORS: Record<string, { status: number; message: string }> = {
  AUTH_REQUIRED: { status: 401, message: "سجّل الدخول أولاً ثم أعد المحاولة." },
  EVENT_NOT_FOUND: { status: 404, message: "المناسبة غير موجودة أو ليست لحسابك." },
  PAYMENT_NOT_FOUND: { status: 404, message: "عملية الدفع غير موجودة." },
  PAYMENT_NOT_EDITABLE: { status: 409, message: "هذه العملية لا يمكن تعديلها — حدّث الصفحة." },
  AMOUNT_MISMATCH: { status: 409, message: "المبلغ المدفوع لا يطابق المطلوب." },
  BAD_GATEWAY_SECRET: { status: 403, message: "تعذر تأكيد الدفع." },
};

function dbError(message: string): Response {
  const code = Object.keys(DB_ERRORS).find((k) => message.includes(k));
  if (code) return jsonResponse({ ok: false, code, message: DB_ERRORS[code].message }, DB_ERRORS[code].status);
  return jsonResponse({ ok: false, code: "DB_ERROR", message: "تعذر إتمام العملية. حاول مرة أخرى." }, 502);
}

// ─────────────────────────── ١) إنشاء رابط الدفع ───────────────────────────

export async function handlePayCreate(
  request: Request,
  env: PaylinkEnv,
  target: SupabaseTarget,
): Promise<Response> {
  if (request.method !== "POST") {
    return jsonResponse({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405, { allow: "POST" });
  }
  if (!paylinkConfigured(env)) {
    return jsonResponse(
      { ok: false, code: "GATEWAY_NOT_CONFIGURED", message: "الدفع بالبطاقة غير مهيأ بعد — استخدم التحويل البنكي." },
      503,
    );
  }

  const jwt = bearerFrom(request);
  if (!jwt) return jsonResponse({ ok: false, code: "AUTH_REQUIRED", message: DB_ERRORS.AUTH_REQUIRED.message }, 401);

  let body: { eventId?: unknown; clientName?: unknown; clientMobile?: unknown; clientEmail?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonResponse({ ok: false, code: "BAD_JSON", message: "صيغة الطلب غير صحيحة." }, 400);
  }
  const eventId = Number(body.eventId);
  if (!Number.isInteger(eventId) || eventId <= 0) {
    return jsonResponse({ ok: false, code: "BAD_EVENT", message: "المناسبة غير صحيحة." }, 400);
  }

  // ١ـأ عملية الدفع تُنشأ/تُجلب بجلسة المستخدم نفسه (RLS تحمي الملكية)
  const created = await rpc(target, "request_event_payment", { p_event_id: eventId }, jwt);
  if (!created.ok) return dbError(created.message);

  const payment = (Array.isArray(created.data) ? created.data[0] : created.data) as {
    id?: number;
    amount?: number | string;
    currency?: string;
    status?: string;
  } | null;
  if (!payment?.id) {
    return jsonResponse({ ok: false, code: "PAYMENT_NOT_FOUND", message: DB_ERRORS.PAYMENT_NOT_FOUND.message }, 404);
  }

  const amount = Number(payment.amount ?? 0);
  // الرسوم صفر أو مدفوعة سلفاً: لا داعي لبوابة الدفع إطلاقاً
  if (payment.status === "paid" || amount <= 0) {
    return jsonResponse({ ok: true, alreadyPaid: true, paymentId: payment.id, eventId });
  }
  // بيلينك يرفض أقل من 5 ريال
  if (amount < 5) {
    return jsonResponse(
      { ok: false, code: "AMOUNT_TOO_SMALL", message: "أقل مبلغ للدفع بالبطاقة 5 ريالات — استخدم التحويل البنكي." },
      400,
    );
  }

  const origin = new URL(request.url).origin;
  const orderNumber = "DAWAAT-" + payment.id;
  let token: string;
  try {
    token = await paylinkToken(env);
  } catch (err) {
    return authFailureResponse(err);
  }

  let invoice: InvoiceResult;
  try {
    invoice = await addInvoice(env, token, {
      orderNumber,
      amount,
      clientName: String(body.clientName ?? "").trim().slice(0, 100) || "عميل دعوات",
      clientMobile: String(body.clientMobile ?? "").trim().slice(0, 20) || "0500000000",
      clientEmail: String(body.clientEmail ?? "").trim().slice(0, 120) || undefined,
      currency: String(payment.currency ?? "SAR"),
      callBackUrl: origin + "/api/pay/return",
      cancelUrl: origin + "/events/" + eventId + "?payment=cancelled",
      note: "رسوم إرسال دعوات المناسبة رقم " + eventId,
      products: [
        {
          title: "رسوم إرسال الدعوات",
          price: amount,
          qty: 1,
          isDigital: true,
          description: "فتح إرسال دعوات المناسبة رقم " + eventId + " على منصة دعوات",
        },
      ],
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    // 406 من بيلينك = حساب التاجر غير مفعّل للعمليات بعد (حد شهري 0) — ليس عطلاً عابراً
    if (/:406$/.test(msg)) {
      return jsonResponse(
        {
          ok: false,
          code: "GATEWAY_NOT_ACTIVE",
          message: "الدفع بالبطاقة غير متاح مؤقتاً لهذا الموقع. تواصل مع الدعم لإتمام الدفع.",
        },
        502,
      );
    }
    return jsonResponse({ ok: false, code: "GATEWAY_UNAVAILABLE", message: "تعذر إنشاء فاتورة الدفع. حاول مرة أخرى." }, 502);
  }

  // ١ـب ربط رقم الفاتورة بالعملية — بجلسة المستخدم أيضاً
  const attached = await rpc(
    target,
    "attach_gateway_payment",
    { p_payment_id: payment.id, p_provider: "paylink", p_provider_ref: invoice.transactionNo },
    jwt,
  );
  if (!attached.ok) return dbError(attached.message);

  return jsonResponse({
    ok: true,
    paymentId: payment.id,
    eventId,
    amount,
    transactionNo: invoice.transactionNo,
    url: invoice.url,
  });
}

// ──────────────────── ٢) التحقق والتأكيد (العودة والـ webhook) ────────────────────

interface ConfirmOutcome {
  ok: boolean;
  paid: boolean;
  eventId: number | null;
  code?: string;
}

/** يتحقق من بيلينك مباشرة ثم يؤكد في القاعدة بالسر المشترك */
async function verifyAndConfirm(
  env: PaylinkEnv,
  target: SupabaseTarget,
  transactionNo: string,
): Promise<ConfirmOutcome> {
  const secret = (env.GATEWAY_SHARED_SECRET ?? "").trim();
  if (!secret) return { ok: false, paid: false, eventId: null, code: "NO_SHARED_SECRET" };

  const token = await paylinkToken(env).catch(() => null);
  if (!token) return { ok: false, paid: false, eventId: null, code: "GATEWAY_UNAVAILABLE" };

  let state: InvoiceState;
  try {
    state = await getInvoice(env, token, transactionNo);
  } catch {
    return { ok: false, paid: false, eventId: null, code: "GATEWAY_UNAVAILABLE" };
  }

  const paid = state.orderStatus.toLowerCase() === "paid";
  // غير مدفوعة بعد (Pending): لا نغيّر شيئاً — قد يكمل الدفع لاحقاً
  if (!paid && state.orderStatus.toLowerCase() !== "canceled") {
    return { ok: true, paid: false, eventId: null, code: "PENDING" };
  }

  const res = await rpc(target, "confirm_gateway_payment", {
    p_secret: secret,
    p_provider_ref: transactionNo,
    p_amount: state.amount,
    p_paid: paid,
  });
  if (!res.ok) {
    return { ok: false, paid: false, eventId: null, code: res.message || "DB_ERROR" };
  }
  const out = (res.data ?? {}) as { event_id?: number; status?: string };
  return { ok: true, paid: out.status === "paid", eventId: Number(out.event_id) || null };
}

/** عودة العميل من صفحة الدفع */
export async function handlePayReturn(
  request: Request,
  env: PaylinkEnv,
  target: SupabaseTarget,
): Promise<Response> {
  const url = new URL(request.url);
  // بيلينك يمرر رقم العملية في transactionNo (وقد يختلف الاسم، فنقبل البدائل)
  const transactionNo =
    url.searchParams.get("transactionNo") ||
    url.searchParams.get("transactionNO") ||
    url.searchParams.get("orderNumber") ||
    "";

  const redirect = (to: string) => Response.redirect(url.origin + to, 302);

  if (!transactionNo) return redirect("/events?payment=unknown");

  const outcome = await verifyAndConfirm(env, target, transactionNo);
  if (!outcome.ok) return redirect("/events?payment=error");
  if (!outcome.paid) {
    return redirect(outcome.eventId ? "/events/" + outcome.eventId + "?payment=pending" : "/events?payment=pending");
  }
  return redirect(outcome.eventId ? "/events/" + outcome.eventId + "?payment=paid" : "/events?payment=paid");
}

/** نداء خادم-لخادم من بيلينك — لا نثق بالحمولة، نتحقق بأنفسنا */
export async function handlePayWebhook(
  request: Request,
  env: PaylinkEnv,
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
  const transactionNo = String(payload.transactionNo ?? payload.transactionNO ?? "").trim();
  if (!transactionNo) return jsonResponse({ ok: false, code: "NO_TRANSACTION" }, 400);

  const outcome = await verifyAndConfirm(env, target, transactionNo);
  // 200 فقط عند المعالجة الناجحة — غير ذلك يعيد بيلينك المحاولة (حتى 10 مرات)
  if (!outcome.ok) return jsonResponse({ ok: false, code: outcome.code ?? "ERROR" }, 503);
  return jsonResponse({ ok: true, paid: outcome.paid });
}
