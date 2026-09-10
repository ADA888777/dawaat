/**
 * رابط الدعوة + نص الرسالة + حالة المدعو، في وحدة واحدة.
 *
 * الهدف: صياغة واحدة للرسالة والرابط تستخدمها كل الأزرار، فلا تختلف
 * الرسالة بين "إرسال لمدعو" و "إرسال الدعوات" ولا يتسرب رقم المدعو في الرابط.
 */

// ───────────────────────────── الأرقام ─────────────────────────────

export const DEFAULT_COUNTRY_CODE = "966";

/**
 * تحويل الرقم إلى صيغة واتساب الدولية (أرقام فقط بلا +).
 * الافتراض السعودية لأنها السوق الأساسي، والأرقام الدولية الصريحة تُترك كما هي.
 */
export function toWhatsAppNumber(raw: string): string {
  const source = String(raw ?? "").trim();
  const digits = source.replace(/\D/g, "");
  if (!digits) return "";
  if (source.startsWith("+")) return digits;
  if (digits.startsWith("00")) return digits.slice(2);
  if (digits.startsWith(DEFAULT_COUNTRY_CODE)) return digits;
  if (digits.startsWith("0")) return DEFAULT_COUNTRY_CODE + digits.slice(1);
  return DEFAULT_COUNTRY_CODE + digits;
}

/** رقم قابل للاتصال المباشر: +9665xxxxxxxx */
export function toDialNumber(raw: string): string {
  const wa = toWhatsAppNumber(raw);
  return wa ? "+" + wa : "";
}

// ───────────────────────────── الروابط ─────────────────────────────

/** رابط الدعوة العام — الصالح للنشر وللـ QR (بلا أي بيان شخصي) */
export function buildPublicInviteUrl(origin: string, slug: string): string {
  return `${origin.replace(/\/$/, "")}/invite/${slug}`;
}

/**
 * رابط الدعوة الشخصي — يحمل رمزاً عشوائياً فقط.
 * لا يحمل الاسم ولا الجوال، فتمرير الرسالة لا يكشف بيانات المدعو.
 */
export function buildGuestInviteUrl(
  origin: string,
  slug: string,
  inviteToken: string,
): string {
  return `${buildPublicInviteUrl(origin, slug)}?t=${encodeURIComponent(inviteToken)}`;
}

// ───────────────────────────── الرسالة ─────────────────────────────

export interface InviteMessageInput {
  guestName: string;
  eventTitle: string;
  inviteUrl: string;
  eventDate?: string | null;
  location?: string | null;
}

function formatEventDate(value: string): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  try {
    // التقويم الميلادي صريح: ar-SA وحدها تُخرج تاريخاً هجرياً
    return new Intl.DateTimeFormat("ar-SA-u-ca-gregory", {
      dateStyle: "full",
      timeStyle: "short",
    }).format(date);
  } catch {
    return date.toLocaleString("ar");
  }
}

/**
 * نص الدعوة الجاهز: اسم المدعو + اسم المناسبة + رابط الدعوة
 * (مع الموعد والمكان إن توفرا).
 */
export function buildInviteMessage(input: InviteMessageInput): string {
  const name = (input.guestName ?? "").trim();
  const lines: string[] = [];

  lines.push(name ? `السلام عليكم يا ${name}،` : "السلام عليكم،");
  lines.push(`يشرفنا حضورك في ${input.eventTitle}`);

  const when = input.eventDate ? formatEventDate(input.eventDate) : null;
  if (when) lines.push(`الموعد: ${when}`);

  const place = (input.location ?? "").trim();
  if (place) lines.push(`المكان: ${place}`);

  lines.push(`رابط الدعوة: ${input.inviteUrl}`);
  lines.push("نتشرف بتأكيد حضورك من الرابط.");

  return lines.join("\n");
}

/**
 * رابط يفتح محادثة واتساب مع الرقم والرسالة مكتوبة مسبقاً.
 *
 * مهم: هذا يفتح واتساب فقط. الضغط على زر الإرسال داخل واتساب يبقى
 * على المستخدم — لا يستطيع أي موقع إرسال رسالة واتساب نيابة عنه.
 * الإرسال التلقائي الجماعي يحتاج WhatsApp Business Platform (Cloud API).
 */
export function buildWhatsAppUrl(phone: string, message: string): string {
  return `https://wa.me/${toWhatsAppNumber(phone)}?text=${encodeURIComponent(message)}`;
}

/** بديل للرقم الذي لا يستخدم واتساب: رسالة نصية جاهزة */
export function buildSmsUrl(phone: string, message: string): string {
  return `sms:${toDialNumber(phone)}?&body=${encodeURIComponent(message)}`;
}

// ────────────────────────── حالة المدعو ──────────────────────────

export type AttendanceStatusValue = "pending" | "attending" | "maybe" | "declined";
export type InviteStatusValue = "pending" | "prepared" | "sent" | "no_response";

/** الحالة الواحدة التي تُعرض لصاحب الدعوة في الجدول */
export type GuestDisplayStatus =
  | "pending"
  | "prepared"
  | "sent"
  | "attending"
  | "maybe"
  | "declined"
  | "no_response";

export const GUEST_STATUS_LABELS: Record<GuestDisplayStatus, string> = {
  pending: "بانتظار الإرسال",
  prepared: "تم تجهيز الدعوة",
  sent: "تم الإرسال",
  attending: "مؤكد",
  maybe: "محتمل",
  declined: "معتذر",
  no_response: "لم يرد",
};

export const GUEST_STATUS_CLASSES: Record<GuestDisplayStatus, string> = {
  pending: "bg-gray-50 text-gray-700 border-gray-200",
  prepared: "bg-sky-50 text-sky-700 border-sky-200",
  sent: "bg-indigo-50 text-indigo-700 border-indigo-200",
  attending: "bg-emerald-50 text-emerald-700 border-emerald-200",
  maybe: "bg-orange-50 text-orange-700 border-orange-200",
  declined: "bg-red-50 text-red-700 border-red-200",
  no_response: "bg-amber-50 text-amber-800 border-amber-200",
};

/** ترتيب الخيارات في قائمة تغيير الحالة اليدوي */
export const GUEST_STATUS_ORDER: GuestDisplayStatus[] = [
  "pending",
  "prepared",
  "sent",
  "attending",
  "maybe",
  "declined",
  "no_response",
];

export interface GuestStatusInput {
  attendanceStatus: AttendanceStatusValue;
  inviteStatus: InviteStatusValue;
}

/**
 * الحالة المعروضة تُشتق من حقلين حقيقيين في قاعدة البيانات:
 * ردّ المدعو (attendance_status) وحالة إرسال الدعوة (invite_status).
 * "لم يرد" تظهر إذا أُرسلت الدعوة ومضى موعد المناسبة بلا رد.
 */
export function getGuestDisplayStatus(
  guest: GuestStatusInput,
  eventDate?: string | null,
): GuestDisplayStatus {
  if (guest.attendanceStatus === "attending") return "attending";
  if (guest.attendanceStatus === "declined") return "declined";
  if (guest.attendanceStatus === "maybe") return "maybe";

  if (guest.inviteStatus === "no_response") return "no_response";

  if (guest.inviteStatus === "sent") {
    if (eventDate) {
      const end = new Date(eventDate).getTime();
      if (!Number.isNaN(end) && end < Date.now()) return "no_response";
    }
    return "sent";
  }

  if (guest.inviteStatus === "prepared") return "prepared";
  return "pending";
}

/**
 * تحويل الخيار الذي اختاره صاحب الدعوة يدوياً إلى تحديث الحقلين.
 * اختيار حالة إرسال يعني أن المدعو لم يرد بعد، فيُصفَّر ردّه.
 */
export function statusSelectionToUpdate(status: GuestDisplayStatus): {
  attendanceStatus: AttendanceStatusValue;
  inviteStatus: InviteStatusValue;
} {
  switch (status) {
    case "attending":
      return { attendanceStatus: "attending", inviteStatus: "sent" };
    case "maybe":
      return { attendanceStatus: "maybe", inviteStatus: "sent" };
    case "declined":
      return { attendanceStatus: "declined", inviteStatus: "sent" };
    case "prepared":
      return { attendanceStatus: "pending", inviteStatus: "prepared" };
    case "sent":
      return { attendanceStatus: "pending", inviteStatus: "sent" };
    case "no_response":
      return { attendanceStatus: "pending", inviteStatus: "no_response" };
    default:
      return { attendanceStatus: "pending", inviteStatus: "pending" };
  }
}
