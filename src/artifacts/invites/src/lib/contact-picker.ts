/**
 * استيراد جهات الاتصال — طبقة واحدة بعدة طرق حقيقية.
 *
 * الوضع الفعلي للوصول لجهات الاتصال حسب مكان تشغيل دعوات:
 *   • تطبيق دعوات (iOS/Android عبر Capacitor، مجلد mobile/) → ملحق أصلي
 *     «DawaatContactPicker»: على الآيفون منتقي النظام باختيار متعدد، وعلى
 *     أندرويد قراءة جهات الاتصال (بإذن) لعرضها كقائمة تحديد داخل النافذة.
 *   • أندرويد Chrome/Edge (منذ 80) → Contact Picker API متاح فعلاً
 *   • iPhone Safari (ويب) → لا توجد أي Web API للاختيار من جهات الاتصال
 *     (WebKit لم يشغّل الميزة). الطريق الأساسي: اختصار Apple Shortcuts
 *     «Dawaat – Contacts» يثبّته المستخدم مرة واحدة؛ الموقع ينشئ رمزاً
 *     مؤقتاً للمناسبة ويفتح الاختصار برابط shortcuts://، والاختصار يفتح
 *     منتقي جهات الاتصال (اختيار متعدد) ويرسل الأسماء والأرقام إلى
 *     /api/contacts/import مع الرمز، والصفحة تستطلع الرمز حتى تصل الجهات.
 *     ثانوياً: التعبئة التلقائية — حقل اسم وحقل جوال بـ
 *     autocomplete="name"/"tel" داخل form (جهة واحدة في كل مرة).
 *   • الكمبيوتر (Chrome/Edge/Firefox/Safari) → غير متاح
 *   • داخل iframe أو على اتصال غير آمن (http) → غير متاح حتى على أندرويد
 *
 * لذلك لا تُعتبر أي طريقة طريقاً وحيداً. لكل جهاز طريق بديل يعمل:
 *   • iPhone: ملف vCard ‎.vcf‎ احتياطي فقط (إن تعذّر الاختصار)، وليس الطريق الأساسي.
 *   • أي جهاز: استيراد CSV، أو لصق قائمة أسماء/أرقام، أو الإدخال اليدوي.
 */

import Papa from "papaparse";
import {
  isPhoneLikeName,
  isValidPhone,
  normalizePhone,
  phoneMatchKey,
  toWesternDigits,
} from "./phone";

export interface PickedContact {
  name: string;
  phone: string;
}

export type ContactPlatform = "android" | "ios" | "desktop" | "unknown";

/**
 * الطريق الذي تُفتح به جهات الاتصال:
 *   native   → تطبيق دعوات (Capacitor) عبر الملحق الأصلي
 *   web-api  → Contact Picker API في متصفح أندرويد
 *   shortcut → سفاري على الآيفون: اختصار «Dawaat – Contacts» (اختيار متعدد عبر
 *              الـ API بالرمز المؤقت)، والتعبئة التلقائية متاحة كطريق ثانٍ داخل الصفحة
 *   autofill → تعبئة تلقائية من جهات الاتصال فقط (جهة في كل مرة) — يبقى للتوافق
 *   none     → لا طريق مباشر؛ الملفات واللصق والإدخال اليدوي فقط
 */
export type ContactAccessVia = "native" | "web-api" | "shortcut" | "autofill" | "none";

export interface ContactPickerSupport {
  /** هل يمكن فتح جهات اتصال الجهاز (اختيار أو قراءة) من هنا الآن؟ */
  supported: boolean;
  /** سبب عدم الدعم، جاهز للعرض للمستخدم */
  reason: string | null;
  platform: ContactPlatform;
  via: ContactAccessVia;
  /** هل نعمل داخل تطبيق دعوات لا داخل متصفح؟ */
  isNativeApp: boolean;
  /** اسم التطبيق إن كنا داخل متصفح مدمج (واتساب/إنستغرام/…)، وإلا null */
  inApp: string | null;
}

/**
 * نتيجة فتح جهات الاتصال:
 *   picked → المستخدم اختار هؤلاء بنفسه (منتقي النظام) فيُحدَّدون تلقائياً
 *   browse → قائمة جهات الاتصال كاملة للاختيار منها داخل النافذة (أندرويد
 *            في التطبيق)، فلا يُحدَّد أحد حتى يختاره المستخدم
 */
export type ContactPickMode = "picked" | "browse";

export interface ContactPickResult {
  contacts: PickedContact[];
  mode: ContactPickMode;
}

export type ContactImportErrorCode =
  | "unsupported"
  | "insecure"
  | "denied"
  | "failed";

export class ContactImportError extends Error {
  code: ContactImportErrorCode;
  /** اسم الخطأ الأصلي من المتصفح (SecurityError، NotAllowedError…) — للتشخيص */
  errorName?: string;
  constructor(code: ContactImportErrorCode, message: string, errorName?: string) {
    super(message);
    this.name = "ContactImportError";
    this.code = code;
    this.errorName = errorName;
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

// ─────────── كشف المتصفح المدمج ووضع سطح المكتب + رابط فتح Chrome ───────────

/**
 * متصفح مدمج داخل تطبيق (واتساب/إنستغرام/فيسبوك/WebView…) — هذه لا تملك
 * Contact Picker على أندرويد، والحل الصحيح فتح الموقع في Chrome لا رسالة تقنية.
 */
export function detectInAppBrowser(): string | null {
  if (typeof navigator === "undefined") return null;
  const ua = navigator.userAgent || "";
  const tokens: Array<[RegExp, string]> = [
    [/FBAN|FBAV|FB_IAB/, "فيسبوك"],
    [/Instagram/, "إنستغرام"],
    [/WhatsApp/, "واتساب"],
    [/Telegram/, "تيليجرام"],
    [/Snapchat/, "سناب شات"],
    [/TikTok|musical_ly|Bytedance/i, "تيك توك"],
    [/Twitter/, "X"],
    [/Line\//, "لاين"],
    [/MicroMessenger/, "وي شات"],
    [/GSA\//, "تطبيق Google"],
  ];
  for (const [pattern, name] of tokens) if (pattern.test(ua)) return name;
  // علامة WebView في أندرويد: «; wv)» داخل الـ UA
  if (/Android/.test(ua) && /; ?wv\)/.test(ua)) return "متصفح مدمج";
  return null;
}

/**
 * «موقع سطح المكتب» مفعّل على جهاز أندرويد: الـ UA يدّعي لينكس/ويندوز بلا كلمة
 * Android، لكن navigator.contacts لا توجد على أي كمبيوتر فعلي — وجودها يفضح المحرك.
 */
export function isDesktopModeAndroid(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return !/Android|iPhone|iPad|iPod/.test(ua) && getContactsManager() !== null;
}

/** متصفح أندرويد غير Chrome (سامسونج/هواوي/شاومي/أوبرا/فايرفوكس…) */
export function isNonChromeAndroidBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return /SamsungBrowser|HuaweiBrowser|HBPC|MiuiBrowser|HeyTapBrowser|VivoBrowser|UCBrowser|Silk\/|OPR\/|YaBrowser|Firefox|DuckDuckGo|Brave/i.test(ua);
}

/**
 * رابط يفتح الصفحة الحالية في تطبيق Chrome على أندرويد (صيغة intent://)،
 * مع العودة للرابط العادي إن لم يوجد Chrome.
 */
export function openInChromeUrl(href?: string): string {
  const target =
    href ?? (typeof location !== "undefined" ? location.href : "https://dawaatly.top");
  try {
    const u = new URL(target);
    return (
      "intent://" + u.host + u.pathname + u.search +
      "#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=" +
      encodeURIComponent(target) + ";end"
    );
  } catch {
    return target;
  }
}

// ─────────────── تشخيص فتح جهات الاتصال (يظهر عبر ‎?debug=contacts‎) ───────────────

/** صورة كاملة عن البيئة وآخر محاولة فتح — تجيب «لماذا لا تفتح؟» من الجهاز الحقيقي */
export interface ContactPickerDiagnostics {
  at: string;
  ua: string;
  uaDataBrands: string | null;
  uaDataMobile: boolean | null;
  uaDataPlatform: string | null;
  secureContext: boolean;
  topLevel: boolean;
  hasContactsApi: boolean;
  hasSelect: boolean;
  getProperties: string | null;
  userActivationActive: boolean | null;
  userActivationHasBeen: boolean | null;
  inAppBrowser: string | null;
  desktopModeSuspected: boolean;
  platformDetected: ContactPlatform;
  lastAttempt: {
    properties: string;
    errorName: string | null;
    errorMessage: string | null;
    picked: number | null;
  } | null;
}

let lastDiagnostics: ContactPickerDiagnostics | null = null;

/** آخر تشخيص (أو تشخيص البيئة الحالية إن لم تحدث محاولة بعد) */
export function getContactPickerDiagnostics(): ContactPickerDiagnostics {
  return lastDiagnostics ?? buildEnvDiagnostics();
}

interface NavigatorUAData {
  brands?: Array<{ brand: string; version: string }>;
  mobile?: boolean;
  platform?: string;
}

function buildEnvDiagnostics(): ContactPickerDiagnostics {
  const nav = typeof navigator === "undefined" ? undefined : navigator;
  const uaData = (nav as (Navigator & { userAgentData?: NavigatorUAData }) | undefined)
    ?.userAgentData;
  const activation = (
    nav as (Navigator & { userActivation?: { isActive?: boolean; hasBeenActive?: boolean } }) | undefined
  )?.userActivation;
  let topLevel = true;
  try {
    topLevel = typeof window === "undefined" || window.top === window.self;
  } catch {
    topLevel = false;
  }
  return {
    at: new Date().toISOString(),
    ua: nav?.userAgent ?? "",
    uaDataBrands: uaData?.brands?.map((b) => b.brand + " " + b.version).join(", ") ?? null,
    uaDataMobile: typeof uaData?.mobile === "boolean" ? uaData.mobile : null,
    uaDataPlatform: uaData?.platform ?? null,
    secureContext:
      typeof window !== "undefined" && (window.isSecureContext ?? location.protocol === "https:"),
    topLevel,
    hasContactsApi: !!(nav as (Navigator & { contacts?: unknown }) | undefined)?.contacts,
    hasSelect: getContactsManager() !== null,
    getProperties: null,
    userActivationActive: typeof activation?.isActive === "boolean" ? activation.isActive : null,
    userActivationHasBeen:
      typeof activation?.hasBeenActive === "boolean" ? activation.hasBeenActive : null,
    inAppBrowser: detectInAppBrowser(),
    desktopModeSuspected: isDesktopModeAndroid(),
    platformDetected: detectPlatform(),
    lastAttempt: null,
  };
}

// ─────────────── جسر تطبيق دعوات (Capacitor — مجلد mobile/) ───────────────

/** ما يعيده الملحق الأصلي DawaatContactPicker على المنصتين */
interface NativeContact {
  name?: string;
  phones?: string[];
}

interface NativePickResult {
  contacts?: NativeContact[];
  /** true عندما يغلق المستخدم المنتقي بلا اختيار */
  cancelled?: boolean;
  /** picked = اختارهم المستخدم في منتقي النظام، browse = قائمة كاملة للاختيار هنا */
  mode?: ContactPickMode;
}

interface NativeContactPickerPlugin {
  pickContacts(): Promise<NativePickResult>;
}

interface CapacitorLike {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  isPluginAvailable?: (name: string) => boolean;
  registerPlugin?: (name: string) => unknown;
  Plugins?: Record<string, unknown>;
}

export const NATIVE_CONTACT_PLUGIN = "DawaatContactPicker";

function getCapacitor(): CapacitorLike | null {
  if (typeof window === "undefined") return null;
  const cap = (window as Window & { Capacitor?: CapacitorLike }).Capacitor;
  return cap && typeof cap === "object" ? cap : null;
}

/** هل الصفحة تعمل داخل تطبيق دعوات (WebView الخاص بـ Capacitor)؟ */
export function isNativeApp(): boolean {
  const cap = getCapacitor();
  return !!cap && typeof cap.isNativePlatform === "function" && cap.isNativePlatform();
}

/**
 * الملحق الأصلي إن كان مسجلاً في التطبيق. Capacitor يحقن جسره في الصفحة
 * حتى لو حُمِّلت من dawaatly.top مباشرة (server.url)، ويكشف الملحقات
 * الأصلية عبر registerPlugin بالاسم دون الحاجة لحزمة @capacitor/core هنا.
 */
function getNativeContactPicker(): NativeContactPickerPlugin | null {
  const cap = getCapacitor();
  if (!cap || !isNativeApp()) return null;
  if (
    typeof cap.isPluginAvailable === "function" &&
    !cap.isPluginAvailable(NATIVE_CONTACT_PLUGIN)
  ) {
    return null;
  }

  const fromRegistry = cap.Plugins?.[NATIVE_CONTACT_PLUGIN] as
    | NativeContactPickerPlugin
    | undefined;
  if (fromRegistry && typeof fromRegistry.pickContacts === "function") {
    return fromRegistry;
  }

  if (typeof cap.registerPlugin === "function") {
    try {
      const plugin = cap.registerPlugin(NATIVE_CONTACT_PLUGIN) as
        | NativeContactPickerPlugin
        | undefined;
      if (plugin && typeof plugin.pickContacts === "function") return plugin;
    } catch {
      // الملحق غير مسجّل في هذا البناء من التطبيق
    }
  }
  return null;
}

export function detectPlatform(): ContactPlatform {
  if (typeof navigator === "undefined") return "unknown";
  // داخل التطبيق يخبرنا Capacitor بالمنصة مباشرة بلا تخمين من user agent
  const cap = getCapacitor();
  if (cap && typeof cap.getPlatform === "function") {
    const native = cap.getPlatform();
    if (native === "ios" || native === "android") return native;
  }
  const ua = navigator.userAgent || "";
  // iPadOS 13+ يتنكر كـ Macintosh، فيُكشف بوجود لمس متعدد
  const isIpadOS =
    /Macintosh/.test(ua) && (navigator.maxTouchPoints ?? 0) > 1;
  if (/iPhone|iPad|iPod/.test(ua) || isIpadOS) return "ios";
  if (/Android/.test(ua)) return "android";
  // «موقع سطح المكتب» مفعّل على تابلت أندرويد: الـ UA بلا Android لكن
  // navigator.contacts (غير موجودة على أي كمبيوتر) تكشف المحرك الحقيقي
  if (getContactsManager() !== null) return "android";
  if (/Windows|Macintosh|Linux|CrOS/.test(ua)) return "desktop";
  return "unknown";
}

/**
 * فحص القدرات كما هي على الجهاز، لا كما نتمناها.
 * الـ API تتطلب: سياق آمن + إطار أعلى (غير iframe) + وجود navigator.contacts.
 */
export function getContactPickerSupport(): ContactPickerSupport {
  const platform = detectPlatform();
  const nativeApp = isNativeApp();
  const inApp = typeof navigator === "undefined" ? null : detectInAppBrowser();

  if (typeof window === "undefined") {
    return { supported: false, reason: null, platform, via: "none", isNativeApp: false, inApp: null };
  }

  // ① تطبيق دعوات: الملحق الأصلي أولاً — لا يعتمد على قدرات WebView
  if (nativeApp) {
    if (getNativeContactPicker()) {
      return { supported: true, reason: null, platform, via: "native", isNativeApp: true, inApp };
    }
    // نسخة قديمة من التطبيق بلا الملحق: نكمل بفحص قدرات الـ WebView كالمتصفح
  }

  const isSecure = window.isSecureContext ?? location.protocol === "https:";
  if (!isSecure) {
    return {
      supported: false,
      platform,
      via: "none",
      isNativeApp: nativeApp,
      inApp,
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
      via: "none",
      isNativeApp: nativeApp,
      inApp,
      reason:
        "لا يمكن فتح جهات الاتصال داخل نافذة مدمجة. افتح الموقع في المتصفح مباشرة، أو استخدم أحد البدائل بالأسفل.",
    };
  }

  // ② أندرويد Chrome/Edge/Samsung: Contact Picker API
  if (getContactsManager()) {
    return { supported: true, reason: null, platform, via: "web-api", isNativeApp: nativeApp, inApp };
  }

  // ③ سفاري على الآيفون: اختصار «Dawaat – Contacts» هو الطريق الأساسي (اختيار
  //    متعدد عبر الـ API)، والتعبئة التلقائية طريق ثانٍ داخل الصفحة. لا شيء منهما
  //    «يفتح» جهات الاتصال من هذه النافذة مباشرة، لذلك supported=false مع
  //    via=shortcut حتى تعرض الواجهة زر الاختصار بلا رسالة «غير مدعوم».
  if (platform === "ios") {
    return {
      supported: false,
      platform,
      via: "shortcut",
      isNativeApp: nativeApp,
      inApp,
      reason: null,
    };
  }

  // ④ أندرويد داخل متصفح مدمج (واتساب/إنستغرام/WebView): الميزة موجودة في
  //    Chrome — الحل زر «فتح في Chrome»، والواجهة تتكفل بعرضه من inApp
  if (platform === "android" && inApp) {
    return {
      supported: false,
      platform,
      via: "none",
      isNativeApp: nativeApp,
      inApp,
      reason:
        "أنت تتصفح دعوات داخل " + inApp + " ولا يمكنه فتح جهات الاتصال — افتح الموقع في Chrome وستعمل مباشرة.",
    };
  }

  const reason =
    platform === "desktop"
      ? "على الكمبيوتر: استورد ملف CSV أو ‎.vcf‎، أو الصق القائمة، أو أضف الاسم والرقم يدوياً."
      : platform === "android"
        ? "هذا المتصفح لا يتيح اختيار جهات الاتصال — افتح الموقع في Chrome وستعمل مباشرة، أو استخدم أحد البدائل بالأسفل."
        : "متصفحك لا يتيح فتح جهات الاتصال. استخدم أحد البدائل بالأسفل.";
  return { supported: false, platform, via: "none", isNativeApp: nativeApp, inApp, reason };
}

/** يبقى للتوافق مع الاستدعاءات القديمة */
export function isContactPickerSupported(): boolean {
  return getContactPickerSupport().supported;
}

// ───────────────────────── توحيد الأرقام ─────────────────────────

// كل التوحيد يمر عبر lib/phone.ts: الجوال السعودي يُخزَّن دائماً +9665XXXXXXXX
export { toWesternDigits } from "./phone";

/** الصيغة الموحّدة للتخزين — نفس normalizePhone في كل المنصة */
export function normalizeContactPhone(raw: string): string {
  return normalizePhone(raw);
}

/** نفس تحقق قاعدة البيانات — رفض مبكر برسالة أوضح */
export function isValidContactPhone(phone: string): boolean {
  return isValidPhone(phone);
}

/**
 * Contact Picker API لا تُرفق نوع الرقم، فقد تعيد جهة اتصال أرقاماً عدة
 * بينها هاتف ثابت. نُفضّل ما يشبه الجوال في السعودية والخليج (الجزء الوطني
 * تسع خانات تبدأ بـ 5)، وإن لم يوجد نُبقي ترتيب المتصفح كما هو.
 */
export function looksLikeMobileNumber(phone: string): boolean {
  const digits = normalizeContactPhone(phone).replace(/^\+/, "");
  const national =
    digits.length > 9 ? digits.slice(-9) : digits.replace(/^0+/, "");
  return /^5\d{8}$/.test(national);
}

/** يختار أفضل رقم من عدة أرقام لجهة اتصال واحدة */
export function preferMobileNumber(numbers: string[]): string {
  const valid = numbers.filter(isValidContactPhone);
  const pool = valid.length > 0 ? valid : numbers;
  return pool.find(looksLikeMobileNumber) ?? pool[0] ?? "";
}

/**
 * مفتاح مقارنة موحّد يمنع تكرار المدعو نفسه بصيغتين مختلفتين.
 * 0501234567 و +966501234567 و 00966501234567 كلها رقم واحد،
 * لذلك تُقارن آخر تسع خانات — وهي القاعدة التي تستخدمها تطبيقات
 * المراسلة نفسها لمطابقة جهات الاتصال.
 */
export function contactPhoneKey(raw: string): string {
  return phoneMatchKey(raw);
}

export function dedupeContacts(list: PickedContact[]): PickedContact[] {
  return mergeContacts([], list);
}

/**
 * يدمج دفعة جديدة في قائمة قائمة بلا تكرار.
 * أول سجل للرقم هو الأصل: تُحفظ صيغته واسمه كما هما، ولا يُستبدل اسمه
 * إلا إذا كان فارغاً أو مجرد رقم (استُخدم الرقم اسماً مؤقتاً).
 * لا يُستبدل الاسم الأصلي باسم أطول ولا يُضاف له أي وسم.
 */
export function mergeContacts(
  base: PickedContact[],
  incoming: PickedContact[],
): PickedContact[] {
  const index = new Map<string, number>();
  const out: PickedContact[] = [];

  for (const entry of [...base, ...incoming]) {
    const phone = normalizeContactPhone(entry ? entry.phone : "");
    if (!phone) continue;
    const key = contactPhoneKey(phone);
    if (!key) continue;

    const name = String((entry && entry.name) || "").trim().slice(0, 100);
    const at = index.get(key);

    if (at === undefined) {
      index.set(key, out.length);
      out.push({ name: name || phone, phone });
      continue;
    }

    const current = out[at];
    const currentIsPlaceholder =
      !current.name.trim() ||
      current.name === current.phone ||
      isPhoneLikeName(current.name);
    if (currentIsPlaceholder && name && !isPhoneLikeName(name)) {
      out[at] = { name, phone: current.phone };
    }
  }

  return out;
}

/** يفصل الأرقام الموجودة مسبقاً في قائمة المدعوين عن الجديدة */
export function splitKnownContacts(
  list: PickedContact[],
  knownPhones: string[],
): { fresh: PickedContact[]; known: PickedContact[] } {
  const known = new Set(knownPhones.map(contactPhoneKey).filter(Boolean));
  const fresh: PickedContact[] = [];
  const dup: PickedContact[] = [];
  for (const contact of list) {
    (known.has(contactPhoneKey(contact.phone)) ? dup : fresh).push(contact);
  }
  return { fresh, known: dup };
}

// ──────────── جهات اتصال الجهاز (التطبيق أو أندرويد Chrome) ────────────

function mapNativeContacts(list: NativeContact[] | undefined): PickedContact[] {
  const mapped: PickedContact[] = [];
  for (const entry of list ?? []) {
    const numbers = (entry?.phones ?? [])
      .map((t) => normalizeContactPhone(String(t ?? "")))
      .filter((t) => t !== "");
    const phone = preferMobileNumber(numbers);
    if (!phone) continue;
    const name = String(entry?.name ?? "").trim();
    mapped.push({ name: name || phone, phone });
  }
  return dedupeContacts(mapped);
}

/** يفتح جهات الاتصال عبر الملحق الأصلي داخل تطبيق دعوات */
async function pickContactsNative(
  plugin: NativeContactPickerPlugin,
): Promise<ContactPickResult> {
  let result: NativePickResult;
  try {
    result = await plugin.pickContacts();
  } catch (err) {
    const message = String((err as Error)?.message ?? err ?? "").toLowerCase();
    if (/cancel/.test(message)) return { contacts: [], mode: "picked" };
    if (/denied|permission|not allowed|restricted/.test(message)) {
      throw new ContactImportError(
        "denied",
        "لم يُسمح للتطبيق بالوصول لجهات الاتصال. فعّل الإذن من إعدادات الجهاز ← دعوات ← جهات الاتصال، أو استخدم أحد البدائل بالأسفل.",
      );
    }
    throw new ContactImportError(
      "failed",
      "تعذر فتح جهات الاتصال في التطبيق. استخدم أحد البدائل بالأسفل.",
    );
  }

  if (!result || result.cancelled) return { contacts: [], mode: "picked" };
  return {
    contacts: mapNativeContacts(result.contacts),
    mode: result.mode === "browse" ? "browse" : "picked",
  };
}

/**
 * يفتح جهات اتصال الجهاز بأفضل طريق متاح ويرجع أزواج اسم/رقم موحّدة
 * مع نمط النتيجة (picked: اختارهم المستخدم، browse: قائمة للاختيار منها).
 * يرجع قائمة فارغة إذا ألغى المستخدم — وهذا ليس خطأً.
 * يرمي ContactImportError مع code يشرح السبب في الحالات الأخرى.
 */
export async function openDeviceContacts(): Promise<ContactPickResult> {
  const support = getContactPickerSupport();
  if (!support.supported) {
    throw new ContactImportError(
      "unsupported",
      support.reason ?? "الوصول لجهات الاتصال غير متاح في هذا المتصفح",
    );
  }

  if (support.via === "native") {
    const plugin = getNativeContactPicker();
    if (plugin) return pickContactsNative(plugin);
  }

  return { contacts: await pickContactsWebApi(), mode: "picked" };
}

/** يبقى للاستدعاءات القديمة: جهات الاتصال فقط بلا نمط النتيجة */
export async function pickContacts(): Promise<PickedContact[]> {
  return (await openDeviceContacts()).contacts;
}

/**
 * Contact Picker API — أندرويد Chrome/Edge/Samsung.
 *
 * القاعدة الحاسمة: select() تُستدعى فوراً داخل إيماءة الضغط نفسها. أي await
 * قبلها (كان هنا getProperties) قد يستهلك تفعيل المستخدم فيرفض المتصفح
 * بـ SecurityError رغم أن كل شيء آخر سليم. getProperties تعمل الآن بالتوازي
 * للتشخيص فقط ولا تؤخر الفتح، وكل محاولة تسجّل تشخيصاً كاملاً
 * (getContactPickerDiagnostics + console) يظهر في النافذة مع ‎?debug=contacts‎.
 */
async function pickContactsWebApi(): Promise<PickedContact[]> {
  const manager = getContactsManager();
  const diag = buildEnvDiagnostics();
  lastDiagnostics = diag;

  if (!manager) {
    throw new ContactImportError(
      "unsupported",
      "الوصول لجهات الاتصال غير متاح في هذا المتصفح",
    );
  }

  // للتشخيص فقط — لا ننتظرها قبل select حتى لا نخسر إيماءة المستخدم
  if (typeof manager.getProperties === "function") {
    manager.getProperties().then(
      (props) => {
        diag.getProperties = Array.isArray(props) ? props.join(",") : String(props);
      },
      (err) => {
        diag.getProperties = "خطأ: " + String((err as Error)?.message ?? err);
      },
    );
  }

  const trySelect = (properties: string[]) => {
    diag.lastAttempt = {
      properties: properties.join(","),
      errorName: null,
      errorMessage: null,
      picked: null,
    };
    return manager.select(properties, { multiple: true });
  };

  let selected: Array<{ name?: string[]; tel?: string[] }>;
  try {
    try {
      selected = await trySelect(["name", "tel"]);
    } catch (first) {
      // بعض الإصدارات ترفض الطلب كله لخاصية لا تدعمها: أعد المحاولة بالأرقام فقط
      if (first instanceof TypeError || (first as DOMException)?.name === "TypeError") {
        selected = await trySelect(["tel"]);
      } else {
        throw first;
      }
    }
  } catch (err) {
    const name =
      (err as DOMException)?.name ?? (err as Error)?.constructor?.name ?? "Error";
    const message = String((err as Error)?.message ?? err ?? "");
    if (diag.lastAttempt) {
      diag.lastAttempt.errorName = name;
      diag.lastAttempt.errorMessage = message;
    }
    console.info("[دعوات] تشخيص جهات الاتصال:", JSON.stringify(diag, null, 2));

    // الإلغاء نتيجة طبيعية لا خطأ
    if (name === "AbortError") return [];
    if (name === "NotAllowedError") {
      throw new ContactImportError(
        "denied",
        "تم رفض إذن الوصول لجهات الاتصال. اسمح به من إعدادات المتصفح ثم أعد المحاولة.",
        name,
      );
    }
    if (name === "InvalidStateError") {
      throw new ContactImportError(
        "failed",
        "نافذة جهات الاتصال مفتوحة بالفعل — أغلقها ثم اضغط الزر مرة أخرى.",
        name,
      );
    }
    if (name === "SecurityError") {
      throw new ContactImportError(
        "insecure",
        diag.inAppBrowser
          ? "هذا المتصفح المدمج لا يسمح بفتح جهات الاتصال — افتح دعوات في Chrome وستعمل مباشرة."
          : diag.desktopModeSuspected
            ? "المتصفح في «وضع سطح المكتب». عطّله من قائمة المتصفح (⋮ ← موقع سطح المكتب) ثم اضغط الزر مرة أخرى."
            : "لم يسمح المتصفح بفتح جهات الاتصال هذه المرة — اضغط الزر مرة أخرى، وإن تكرر افتح الموقع في Chrome.",
        name,
      );
    }
    throw new ContactImportError(
      "failed",
      "تعذر فتح جهات الاتصال في هذا المتصفح — جرّب فتحه في Chrome أو استخدم أحد البدائل.",
      name,
    );
  }

  if (diag.lastAttempt) {
    diag.lastAttempt.picked = Array.isArray(selected) ? selected.length : 0;
  }
  console.info("[دعوات] تشخيص جهات الاتصال:", JSON.stringify(diag, null, 2));

  if (!Array.isArray(selected) || selected.length === 0) return [];

  const mapped: PickedContact[] = [];
  for (const entry of selected) {
    const rawName = (entry.name ?? []).find((n) => (n ?? "").trim() !== "") ?? "";
    const numbers = (entry.tel ?? [])
      .map((t) => normalizeContactPhone(t))
      .filter((t) => t !== "");
    const phone = preferMobileNumber(numbers);
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
        // ترجيح إضافي عند غياب وسم النوع تماماً
        if (looksLikeMobileNumber(phone)) score += 2;
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
      // يُزال أيضاً الفاصل العربي ، والفاصلة المنقوطة ؛ لأنهما الأكثر استعمالاً في اللوائح العربية
      .replace(/[,;|\t\u060C\u061B]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    out.push({ name: name || phone, phone });
  }
  return dedupeContacts(out);
}

/**
 * يقرأ ملفاً نصياً ويكتشف ترميزه.
 * مهم للأسماء العربية: Excel على ويندوز يصدّر CSV بترميز windows-1256،
 * وقراءته كـ UTF-8 تحوّل الأسماء إلى رموز غير مفهومة.
 */
export async function readTextFile(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());

  if (bytes.length > 1) {
    const isUtf16le = bytes[0] === 0xff && bytes[1] === 0xfe;
    const isUtf16be = bytes[0] === 0xfe && bytes[1] === 0xff;
    if (isUtf16le || isUtf16be) {
      return new TextDecoder(isUtf16le ? "utf-16le" : "utf-16be")
        .decode(bytes)
        .replace(/^\uFEFF/, "");
    }
  }

  const utf8 = new TextDecoder("utf-8").decode(bytes).replace(/^\uFEFF/, "");
  if (!utf8.includes("\uFFFD")) return utf8;

  try {
    const arabic = new TextDecoder("windows-1256")
      .decode(bytes)
      .replace(/^\uFEFF/, "");
    if (!arabic.includes("\uFFFD")) return arabic;
  } catch {
    // لا ترميز بديل متاح — نُكمل بـ UTF-8
  }

  return utf8;
}

// ───────────────── CSV وأي ملف جهات اتصال آخر ─────────────────

export type ContactFileKind = "vcard" | "csv" | "text";

const CSV_NAME_KEYS = [
  "name", "full name", "fullname", "display name", "displayname",
  "contact name", "guest", "guest name",
  "الاسم", "اسم", "الاسم الكامل", "اسم المدعو", "المدعو", "اسم كامل",
];

const CSV_PHONE_KEYS = [
  "phone", "phone number", "phonenumber", "mobile", "mobile number",
  "mobile phone", "primary phone", "tel", "telephone", "cell", "cell phone",
  "whatsapp", "phone 1 value", "phone1 value",
  "رقم الجوال", "الجوال", "جوال", "رقم الهاتف", "الهاتف", "هاتف",
  "الموبايل", "موبايل", "واتساب", "رقم الواتساب", "الرقم", "رقم",
];

/** "Phone 1 - Value" و "Mobile_Phone" و "  الجوال " تصبح مفاتيح موحّدة */
function normalizeHeader(key: string): string {
  return toWesternDigits(String(key || ""))
    .replace(/^\uFEFF/, "")
    .replace(/[_\-.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function pickCell(
  row: Map<string, string>,
  exactKeys: string[],
  fuzzy: (key: string) => boolean,
): string {
  for (const key of exactKeys) {
    const value = row.get(key);
    if (value && value.trim() !== "") return value;
  }
  for (const [key, value] of row) {
    if (value && value.trim() !== "" && fuzzy(key)) return value;
  }
  return "";
}

/**
 * Google Contacts وOutlook يضعان عدة أرقام في خلية واحدة مفصولة بـ ::: .
 * تُطبَّق هنا نفس قاعدة تفضيل الجوال على الهاتف الثابت.
 */
function firstUsablePhone(raw: string): string {
  const parts = String(raw || "").split(/:::|\s*[/|]\s*|\s*,\s*/);
  return preferMobileNumber(
    parts.map((part) => normalizeContactPhone(part)).filter(Boolean),
  );
}

function rowToContact(raw: Record<string, string>): PickedContact | null {
  const row = new Map<string, string>();
  for (const [key, value] of Object.entries(raw || {})) {
    if (typeof value !== "string") continue;
    const normalized = normalizeHeader(key);
    if (normalized && !row.has(normalized)) row.set(normalized, value);
  }

  const phone = firstUsablePhone(
    pickCell(
      row,
      CSV_PHONE_KEYS,
      (key) =>
        /(phone|mobile|tel|cell|whats|جوال|هاتف|موبايل|واتس|رقم)/.test(key) &&
        !/(type|label|country|code|نوع)/.test(key),
    ),
  );
  if (!isValidContactPhone(phone)) return null;

  // ① عمود اسم كامل صريح
  let name = pickCell(row, CSV_NAME_KEYS, () => false).trim();

  // ② Google و Outlook و iCloud تفصل الاسم الأول عن العائلة،
  //    والدمج هنا مقدَّم على أي عمود فيه كلمة name حتى لا يُكتفى بالاسم الأول
  if (!name) {
    const first = row.get("first name") || row.get("given name") || "";
    const middle = row.get("middle name") || "";
    const last =
      row.get("last name") || row.get("family name") || row.get("surname") || "";
    name = [first, middle, last]
      .map((part) => part.trim())
      .filter(Boolean)
      .join(" ");
  }

  // ③ أي عمود آخر يشبه الاسم
  if (!name) {
    name = pickCell(
      row,
      [],
      (key) =>
        /(name|اسم)/.test(key) &&
        !/(file|type|label|user|account|نوع)/.test(key),
    ).trim();
  }

  return { name: name || phone, phone };
}

/**
 * يقرأ CSV برؤوس أعمدة — يشمل تصديرات Google Contacts و Outlook و iCloud
 * و Excel العربي. وإن لم يكن للملف رؤوس أعمدة يُقرأ سطراً بسطر بدل رفضه.
 */
export function parseCsvContacts(raw: string): PickedContact[] {
  const text = String(raw || "").replace(/^\uFEFF/, "");
  if (text.trim() === "") return [];

  let rows: Array<Record<string, string>> = [];
  try {
    const result = Papa.parse<Record<string, string>>(text, {
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: (header: string) => String(header || "").trim(),
    });
    rows = Array.isArray(result.data) ? result.data : [];
  } catch {
    rows = [];
  }

  const out: PickedContact[] = [];
  for (const row of rows) {
    const contact = rowToContact(row);
    if (contact) out.push(contact);
  }

  // ملف بلا رؤوس أعمدة مثل: سعود العتيبي,0501234567
  if (out.length === 0) return parseContactLines(text);
  return dedupeContacts(out);
}

/** النوع يُحدَّد من المحتوى أولاً، فالامتداد قد يكون مضللاً أو مفقوداً */
export function detectContactFileKind(
  raw: string,
  fileName = "",
): ContactFileKind {
  const text = String(raw || "");
  const name = String(fileName || "").toLowerCase();
  if (/BEGIN:VCARD/i.test(text) || /\.(vcf|vcard)$/.test(name)) return "vcard";
  const firstLine = text.split(/\r?\n/).find((line) => line.trim() !== "") || "";
  if (/\.csv$/.test(name) || /[,;\t]/.test(firstLine)) return "csv";
  return "text";
}

export interface ParsedContactFile {
  contacts: PickedContact[];
  kind: ContactFileKind;
}

/**
 * مدخل واحد لكل الملفات. يتعرّف على النوع من المحتوى حتى لا يفشل
 * الاستيراد لأن iPhone صدّر الملف بامتداد غير متوقع.
 */
export function parseContactsFromText(
  raw: string,
  fileName = "",
): ParsedContactFile {
  const text = String(raw || "").replace(/^\uFEFF/, "");
  const kind = detectContactFileKind(text, fileName);
  if (kind === "vcard") return { kind, contacts: parseVCards(text) };
  if (kind === "csv") return { kind, contacts: parseCsvContacts(text) };
  return { kind, contacts: parseContactLines(text) };
}

/** يقرأ عدة ملفات دفعة واحدة ويدمجها بلا تكرار */
export async function parseContactFiles(
  files: File[],
): Promise<ParsedContactFile> {
  let merged: PickedContact[] = [];
  let kind: ContactFileKind = "text";
  for (const file of files) {
    const parsed = parseContactsFromText(await readTextFile(file), file.name);
    if (parsed.contacts.length > 0) kind = parsed.kind;
    merged = mergeContacts(merged, parsed.contacts);
  }
  return { contacts: merged, kind };
}

const FILE_ACCEPT_DEFAULT =
  ".vcf,.vcard,.csv,.txt,text/vcard,text/x-vcard,text/directory,text/csv,text/plain";

/**
 * قيمة accept الآمنة لكل منصّة.
 * على iOS تقييد accept يجعل ملفات .vcf تظهر رمادية غير قابلة للاختيار
 * داخل تطبيق «الملفات»، فيُترك الحقل مفتوحاً ويُتحقق من المحتوى بعد القراءة.
 */
export function contactFileAccept(
  platform: ContactPlatform,
): string | undefined {
  return platform === "ios" ? undefined : FILE_ACCEPT_DEFAULT;
}
