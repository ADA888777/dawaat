/**
 * استيراد جهات الاتصال — طبقة واحدة بعدة طرق حقيقية.
 *
 * الوضع الفعلي لدعم المتصفحات للوصول لجهات الاتصال:
 *   • أندرويد Chrome/Edge (منذ 80) → Contact Picker API متاح فعلاً
 *   • iPhone: Safari و Chrome و أي متصفح آخر → غير متاح إطلاقاً
 *     (WebKit لم يشغّل الميزة، ولا يوجد "خيار" لتشغيلها)
 *   • الكمبيوتر (Chrome/Edge/Firefox/Safari) → غير متاح
 *   • داخل iframe أو على اتصال غير آمن (http) → غير متاح حتى على أندرويد
 *
 * لذلك لا تُعتبر هذه الـ API طريقاً وحيداً أبداً. لكل جهاز طريق بديل يعمل:
 *   • iPhone: مشاركة جهة الاتصال (أو عدة جهات) كملف vCard ‎.vcf‎ ثم استيراده.
 *     iOS يصدّر عدة أشخاص في ملف vcf واحد متعدد البطاقات، فيُستورد الجميع.
 *   • أي جهاز: استيراد CSV، أو لصق قائمة أسماء/أرقام، أو الإدخال اليدوي.
 */

export interface PickedContact {
  name: string;
  phone: string;
}

export type ContactPlatform = "android" | "ios" | "desktop" | "unknown";

export interface ContactPickerSupport {
  /** هل يمكن فتح جهات اتصال الجهاز من هذا المتصفح الآن؟ */
  supported: boolean;
  /** سبب عدم الدعم، جاهز للعرض للمستخدم */
  reason: string | null;
  platform: ContactPlatform;
}

export type ContactImportErrorCode =
  | "unsupported"
  | "insecure"
  | "denied"
  | "failed";

export class ContactImportError extends Error {
  code: ContactImportErrorCode;
  constructor(code: ContactImportErrorCode, message: string) {
    super(message);
    this.name = "ContactImportError";
    this.code = code;
  }
}

interface ContactsManagerLike {
  select(
    properties: string[],
    options?: { multiple?: boolean },
  ): Promise<Array<{ name?: string[]; tel?: string[] }>>;
  getProperties?: () => Promise<string[]>;
}

function getContactsManager(): ContactsManagerLike | null {
  if (typeof navigator === "undefined") return null;
  const nav = navigator as Navigator & { contacts?: ContactsManagerLike };
  return typeof nav.contacts?.select === "function" ? nav.contacts : null;
}

export function detectPlatform(): ContactPlatform {
  if (typeof navigator === "undefined") return "unknown";
  const ua = navigator.userAgent || "";
  // iPadOS 13+ يتنكر كـ Macintosh، فيُكشف بوجود لمس متعدد
  const isIpadOS =
    /Macintosh/.test(ua) && (navigator.maxTouchPoints ?? 0) > 1;
  if (/iPhone|iPad|iPod/.test(ua) || isIpadOS) return "ios";
  if (/Android/.test(ua)) return "android";
  if (/Windows|Macintosh|Linux|CrOS/.test(ua)) return "desktop";
  return "unknown";
}

/**
 * فحص القدرات كما هي على الجهاز، لا كما نتمناها.
 * الـ API تتطلب: سياق آمن + إطار أعلى (غير iframe) + وجود navigator.contacts.
 */
export function getContactPickerSupport(): ContactPickerSupport {
  const platform = detectPlatform();

  if (typeof window === "undefined") {
    return { supported: false, reason: null, platform };
  }

  const isSecure = window.isSecureContext ?? location.protocol === "https:";
  if (!isSecure) {
    return {
      supported: false,
      platform,
      reason:
        "الوصول لجهات الاتصال يحتاج اتصالاً آمناً (https). استخدم أحد البدائل بالأسفل.",
    };
  }

  let isTopLevel = true;
  try {
    isTopLevel = window.top === window.self;
  } catch {
    isTopLevel = false; // نطاق مختلف => داخل iframe
  }
  if (!isTopLevel) {
    return {
      supported: false,
      platform,
      reason:
        "لا يمكن فتح جهات الاتصال داخل نافذة مدمجة. افتح الموقع في المتصفح مباشرة، أو استخدم أحد البدائل بالأسفل.",
    };
  }

  if (!getContactsManager()) {
    const reason =
      platform === "ios"
        ? "متصفح iPhone/iPad لا يسمح لأي موقع بقراءة جهات الاتصال. الطريقة العملية على الآيفون: شارِك جهات الاتصال كملف ‎.vcf‎ واستوردها من التبويب المجاور."
        : platform === "desktop"
          ? "متصفحات الكمبيوتر لا تدعم الوصول لجهات الاتصال. استورد ملف CSV أو ‎.vcf‎، أو الصق القائمة، أو أضف الرقم يدوياً."
          : "متصفحك لا يدعم فتح جهات الاتصال. استخدم أحد البدائل بالأسفل.";
    return { supported: false, platform, reason };
  }

  return { supported: true, reason: null, platform };
}

/** يبقى للتوافق مع الاستدعاءات القديمة */
export function isContactPickerSupported(): boolean {
  return getContactPickerSupport().supported;
}

// ───────────────────────── توحيد الأرقام ─────────────────────────

const EASTERN_DIGITS: Record<string, string> = {
  "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4",
  "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
  "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4",
  "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9",
};

/** يحوّل الأرقام العربية/الفارسية إلى أرقام لاتينية */
export function toWesternDigits(input: string): string {
  return String(input ?? "").replace(
    /[\u0660-\u0669\u06F0-\u06F9]/g,
    (d) => EASTERN_DIGITS[d] ?? d,
  );
}

/**
 * صيغة موحّدة للتخزين: أرقام فقط، مع الإبقاء على + الدولية.
 * ‎00‎ الدولية تُحوَّل إلى ‎+‎ حتى لا يتجاوز الرقم حد 15 خانة في قاعدة البيانات.
 */
export function normalizeContactPhone(raw: string): string {
  const s = toWesternDigits(raw).trim();
  const digits = s.replace(/\D/g, "");
  if (!digits) return "";
  if (s.startsWith("+")) return "+" + digits;
  if (digits.startsWith("00")) return "+" + digits.slice(2);
  return digits;
}

/** نفس تحقق قاعدة البيانات — رفض مبكر برسالة أوضح */
export function isValidContactPhone(phone: string): boolean {
  return /^\+?[0-9]{9,15}$/.test(phone);
}

export function dedupeContacts(list: PickedContact[]): PickedContact[] {
  const seen = new Set<string>();
  const out: PickedContact[] = [];
  for (const c of list) {
    const phone = normalizeContactPhone(c.phone);
    if (!phone || seen.has(phone)) continue;
    seen.add(phone);
    out.push({ name: (c.name ?? "").trim().slice(0, 100) || phone, phone });
  }
  return out;
}

// ──────────────────── جهات اتصال الجهاز (أندرويد) ────────────────────

/**
 * يفتح منتقي جهات الاتصال (اختيار متعدد) ويرجع أزواج اسم/رقم موحّدة.
 * يرجع مصفوفة فارغة إذا ألغى المستخدم — وهذا ليس خطأً.
 * يرمي ContactImportError مع code يشرح السبب في الحالات الأخرى.
 */
export async function pickContacts(): Promise<PickedContact[]> {
  const support = getContactPickerSupport();
  if (!support.supported) {
    throw new ContactImportError(
      "unsupported",
      support.reason ?? "الوصول لجهات الاتصال غير متاح في هذا المتصفح",
    );
  }

  const manager = getContactsManager();
  if (!manager) {
    throw new ContactImportError(
      "unsupported",
      "الوصول لجهات الاتصال غير متاح في هذا المتصفح",
    );
  }

  // بعض الإصدارات ترفض الطلب كله إذا ذُكرت خاصية لا تدعمها
  let properties = ["name", "tel"];
  if (typeof manager.getProperties === "function") {
    try {
      const available = await manager.getProperties();
      if (Array.isArray(available) && available.length > 0) {
        if (!available.includes("tel")) {
          throw new ContactImportError(
            "unsupported",
            "جهازك لا يسمح بقراءة أرقام الجوال من جهات الاتصال. استخدم أحد البدائل بالأسفل.",
          );
        }
        properties = properties.filter((p) => available.includes(p));
      }
    } catch (err) {
      if (err instanceof ContactImportError) throw err;
      // فشل استعلام الخصائص لا يمنع المحاولة بالخصائص الافتراضية
    }
  }

  let selected: Array<{ name?: string[]; tel?: string[] }>;
  try {
    selected = await manager.select(properties, { multiple: true });
  } catch (err) {
    const name = (err as DOMException)?.name;
    // الإلغاء نتيجة طبيعية لا خطأ
    if (name === "AbortError") return [];
    if (name === "NotAllowedError") {
      throw new ContactImportError(
        "denied",
        "تم رفض إذن الوصول لجهات الاتصال. اسمح به من إعدادات المتصفح، أو استخدم أحد البدائل بالأسفل.",
      );
    }
    if (name === "SecurityError" || name === "InvalidStateError") {
      throw new ContactImportError(
        "insecure",
        "المتصفح منع فتح جهات الاتصال في هذا السياق. افتح الموقع في نافذة عادية، أو استخدم أحد البدائل بالأسفل.",
      );
    }
    throw new ContactImportError(
      "failed",
      "تعذر فتح جهات الاتصال. استخدم أحد البدائل بالأسفل.",
    );
  }

  if (!Array.isArray(selected) || selected.length === 0) return [];

  const mapped: PickedContact[] = [];
  for (const entry of selected) {
    const rawName = (entry.name ?? []).find((n) => (n ?? "").trim() !== "") ?? "";
    const numbers = (entry.tel ?? [])
      .map((t) => normalizeContactPhone(t))
      .filter((t) => t !== "");
    const phone = numbers.find(isValidContactPhone) ?? numbers[0] ?? "";
    if (!phone) continue;
    mapped.push({ name: rawName.trim() || phone, phone });
  }

  return dedupeContacts(mapped);
}

// ──────────────────────── ملفات vCard (.vcf) ────────────────────────

function decodeVCardValue(value: string, params: string): string {
  let v = value;
  if (params.includes("QUOTED-PRINTABLE")) {
    v = v
      .replace(/=\n/g, "")
      .replace(/=([0-9A-Fa-f]{2})/g, (_m, hex) =>
        String.fromCharCode(parseInt(hex, 16)),
      );
    try {
      const bytes = Uint8Array.from(Array.from(v, (ch) => ch.charCodeAt(0) & 0xff));
      v = new TextDecoder("utf-8").decode(bytes);
    } catch {
      // اتركه كما هو إن فشل الترميز
    }
  }
  return v
    .replace(/\\n/gi, " ")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\")
    .trim();
}

/**
 * يحلّل ملف vCard واحداً أو متعدد البطاقات (كما يصدّره iPhone وأندرويد).
 * يفضّل رقم الجوال (CELL/MOBILE/IPHONE/PREF) على الهاتف الثابت.
 */
export function parseVCards(raw: string): PickedContact[] {
  const text = String(raw ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  // فك التغليف: سطر يبدأ بمسافة أو tab هو امتداد للسطر السابق (RFC 6350)
  const unfolded = text.replace(/\n[ \t]/g, "");
  const cards = unfolded.split(/BEGIN:VCARD/i).slice(1);
  const out: PickedContact[] = [];

  for (const card of cards) {
    const body = card.split(/END:VCARD/i)[0];
    let fn = "";
    let structured = "";
    let org = "";
    const tels: Array<{ value: string; score: number }> = [];

    for (const line of body.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const sep = trimmed.indexOf(":");
      if (sep === -1) continue;

      const rawKey = trimmed.slice(0, sep);
      const rawValue = trimmed.slice(sep + 1);
      const params = rawKey.toUpperCase();
      const firstSegment = params.split(";")[0];
      // تجاهل بادئة المجموعة مثل item1.TEL
      const key = firstSegment.includes(".")
        ? firstSegment.split(".").pop() ?? firstSegment
        : firstSegment;

      if (key === "FN") {
        fn = decodeVCardValue(rawValue, params);
      } else if (key === "N") {
        const seg = decodeVCardValue(rawValue, params).split(";");
        // الترتيب في vCard: العائلة;الاسم;الأوسط;اللقب;اللاحقة
        structured = [seg[3], seg[1], seg[2], seg[0], seg[4]]
          .filter((s) => (s ?? "").trim() !== "")
          .join(" ")
          .trim();
      } else if (key === "ORG") {
        org = decodeVCardValue(rawValue, params).split(";")[0];
      } else if (key === "TEL") {
        const cleaned = decodeVCardValue(rawValue, params).replace(/^tel:/i, "");
        const phone = normalizeContactPhone(cleaned);
        if (!phone) continue;
        let score = 0;
        if (/CELL|MOBILE|IPHONE/.test(params)) score += 3;
        if (/PREF/.test(params)) score += 1;
        if (/FAX|PAGER/.test(params)) score -= 5;
        tels.push({ value: phone, score });
      }
    }

    if (tels.length === 0) continue;
    tels.sort((a, b) => b.score - a.score);
    const best = tels.find((t) => isValidContactPhone(t.value)) ?? tels[0];
    const name = (fn || structured || org || "").trim();
    out.push({ name: name || best.value, phone: best.value });
  }

  return dedupeContacts(out);
}

// ─────────────────────── لصق قائمة أسماء/أرقام ───────────────────────

/**
 * يحلّل نصاً ملصوقاً سطراً بسطر ويقبل الصيغ الشائعة:
 *   سعود العتيبي، 0501234567
 *   0501234567 سعود
 *   سعود<tab>+966501234567
 *   0501234567
 */
export function parseContactLines(raw: string): PickedContact[] {
  const out: PickedContact[] = [];
  for (const line of toWesternDigits(raw).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/\+?\d[\d\s().\-]{7,}\d/);
    if (!match) continue;
    const phone = normalizeContactPhone(match[0]);
    if (!isValidContactPhone(phone)) continue;
    const name = trimmed
      .replace(match[0], " ")
      .replace(/[,;|\t]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    out.push({ name: name || phone, phone });
  }
  return dedupeContacts(out);
}

/** يقرأ ملفاً نصياً بترميز UTF-8 ويزيل علامة BOM إن وُجدت */
export async function readTextFile(file: File): Promise<string> {
  const text = await file.text();
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
