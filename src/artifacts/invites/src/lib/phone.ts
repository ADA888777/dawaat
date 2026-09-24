/**
 * توحيد أرقام الجوال — مصدر واحد تستخدمه كل المنصة.
 *
 * الصيغة المخزّنة للجوال السعودي دائماً: +9665XXXXXXXX
 *   0501234567       → +966501234567
 *   501234567        → +966501234567
 *   966501234567     → +966501234567
 *   00966501234567   → +966501234567
 *   +966 050 123 4567 → +966501234567
 *   ٠٥٠١٢٣٤٥٦٧       → +966501234567
 * الأرقام الدولية الأخرى تبقى +<أرقام> كما هي، وما لا يمكن الجزم به يبقى أرقاماً فقط.
 *
 * نفس القواعد مطبّقة في قاعدة البيانات (public.normalize_sa_phone + trigger على guests)
 * حتى لا يتكرر نفس الشخص بصيغتين مهما كان مصدر الإدخال.
 */

const EASTERN_DIGITS: Record<string, string> = {
  "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4",
  "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
  "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4",
  "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9",
};

/** يحوّل أي أرقام شرقية (عربية/فارسية) إلى أرقام لاتينية */
export function toWesternDigits(raw: string): string {
  return String(raw ?? "").replace(
    /[٠-٩۰-۹]/g,
    (d) => EASTERN_DIGITS[d] ?? d,
  );
}

/** الصيغة الموحّدة للتخزين والمقارنة */
export function normalizePhone(raw: string): string {
  const trimmed = toWesternDigits(raw).trim();
  let plus = trimmed.startsWith("+");
  let digits = trimmed.replace(/\D/g, "");
  if (!digits) return "";

  if (!plus && digits.startsWith("00")) {
    digits = digits.slice(2);
    plus = true;
  }

  // جوال سعودي بكل صيغه الشائعة
  if (/^05\d{8}$/.test(digits)) return "+966" + digits.slice(1);
  if (!plus && /^5\d{8}$/.test(digits)) return "+966" + digits;
  if (/^9665\d{8}$/.test(digits)) return "+" + digits;
  if (/^96605\d{8}$/.test(digits)) return "+966" + digits.slice(4);

  return plus ? "+" + digits : digits;
}

/** نفس تحقق قاعدة البيانات */
export function isValidPhone(phone: string): boolean {
  return /^\+?[0-9]{9,15}$/.test(phone);
}

/** هل الرقم (بعد التوحيد) جوال سعودي مكتمل؟ */
export function isSaudiMobile(phone: string): boolean {
  return /^\+9665\d{8}$/.test(normalizePhone(phone));
}

/**
 * مفتاح مطابقة: آخر تسع خانات من الصيغة الموحّدة.
 * يمنع التكرار حتى مع بيانات قديمة لم تُوحَّد بعد.
 */
export function phoneMatchKey(raw: string): string {
  const digits = normalizePhone(raw).replace(/\D/g, "");
  return digits.length > 9 ? digits.slice(-9) : digits;
}

/** للعرض: +966501234567 → 050 123 4567 ، وغير السعودي يبقى كما هو */
export function formatPhoneForDisplay(phone: string): string {
  const n = normalizePhone(phone);
  const m = n.match(/^\+966(5\d)(\d{3})(\d{4})$/);
  return m ? `0${m[1]} ${m[2]} ${m[3]}` : n || phone;
}
