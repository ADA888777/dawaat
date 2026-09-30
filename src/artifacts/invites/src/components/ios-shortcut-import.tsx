import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Download, Loader2, RotateCcw, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  IOS_SHORTCUT_NAME,
  iosShortcutRunUrl,
  useContactImportStatus,
  useCreateContactImportToken,
  useGetAppSettings,
  type ContactImportStatus,
} from "@/lib/api";

/**
 * استيراد جهات اتصال الآيفون عبر اختصار Apple Shortcuts «Dawaat – Contacts».
 *
 * سفاري لا يسمح لأي موقع بالوصول لجهات الاتصال (لا توجد نافذة صلاحية أصلاً)،
 * فالاختصار هو الطريق الوحيد لاختيار عدة أشخاص دفعة واحدة من الويب. الهدف هنا
 * أقل احتكاك ممكن للعميل — لا شرح ولا إعدادات:
 *
 *   • أول مرة على هذا الجهاز: الضغطة تفتح مباشرة صفحة «إضافة اختصار» في iCloud
 *     (ضغطة واحدة هناك)، وعند العودة للموقع تُفتح نافذة جهات الاتصال تلقائياً.
 *   • بعدها كل مرة: الضغطة تفتح الاختصار برمز مؤقت ← منتقي جهات الاتصال (اختيار
 *     متعدد) ← أول تشغيل يطلب iOS صلاحية جهات الاتصال ← ترجع الأسماء إلى القائمة
 *     مباشرة بلا إعادة تحميل.
 *
 * الرمز: create_contact_import_token (جلسة مسجّلة، مناسبة يملكها) صالح 15 دقيقة
 * ولاستخدام واحد. يُنشأ مسبقاً عند ظهور الزر لأن سفاري لا يفتح مخططاً مخصصاً
 * (shortcuts://) إلا داخل إيماءة الضغط نفسها، لا بعد انتظار طلب شبكة.
 *
 * الكشف: إن لم تختفِ الصفحة بعد فتح shortcuts:// فالتطبيق لم يُفتح (أو رُفض)،
 * وإن عاد المستخدم بلا استيراد فالاختصار غالباً غير مضاف — في الحالتين يظهر زر
 * «إضافة اختصار دعوات» بضغطة واحدة، والشرح المفصل خلف رابط «كيف؟».
 */

type Phase = "idle" | "creating" | "waiting" | "not-installed" | "done" | "expired" | "error";

interface IosShortcutImportProps {
  eventId: number;
  /** عند وصول الجهات: يحدّث الأب القائمة ويغلق النافذة */
  onImported: (status: ContactImportStatus) => void;
  disabled?: boolean;
}

/** هذا الجهاز أضاف الاختصار (أو عاد من صفحة إضافته) — الضغطة التالية تفتحه مباشرة */
const READY_KEY = "dawaat.iosShortcutReady";
/** ذهبنا إلى صفحة إضافة الاختصار وننتظر العودة — يفتح الأب نافذة جهات الاتصال تلقائياً */
export const PENDING_INSTALL_KEY = "dawaat.iosShortcutPendingInstall";

/** مهلة نافذة «فتح في الاختصارات؟» التي يعرضها سفاري قبل مغادرة الصفحة */
const NOT_OPENED_TIMEOUT_MS = 6000;
/** بعد العودة من الاختصار: إن لم تصل الجهات خلال هذه المدة فالاختصار لم يعمل */
const RETURNED_WITHOUT_IMPORT_MS = 4000;

function readFlag(storage: Storage | undefined, key: string): boolean {
  try {
    return storage?.getItem(key) === "1";
  } catch {
    return false;
  }
}
function writeFlag(storage: Storage | undefined, key: string, on: boolean) {
  try {
    if (on) storage?.setItem(key, "1");
    else storage?.removeItem(key);
  } catch {
    /* التخزين غير متاح (وضع خاص) — نكمل بلا تذكّر */
  }
}
const local = () => (typeof window === "undefined" ? undefined : window.localStorage);
const session = () => (typeof window === "undefined" ? undefined : window.sessionStorage);

/** هل عدنا للتو من صفحة إضافة الاختصار؟ يقرؤها الأب ليفتح النافذة، ثم تُمسح */
export function consumePendingShortcutInstall(): boolean {
  const pending = readFlag(session(), PENDING_INSTALL_KEY);
  if (pending) {
    writeFlag(session(), PENDING_INSTALL_KEY, false);
    writeFlag(local(), READY_KEY, true);
  }
  return pending;
}

export function IosShortcutImport({ eventId, onImported, disabled = false }: IosShortcutImportProps) {
  const { data: settings } = useGetAppSettings();
  const shortcutUrl = (settings?.iosShortcutUrl ?? "").trim();
  const createToken = useCreateContactImportToken();

  const [phase, setPhase] = useState<Phase>("idle");
  const [token, setToken] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showInstall, setShowInstall] = useState(false);
  const [showHow, setShowHow] = useState(false);
  const [ready, setReady] = useState(() => readFlag(local(), READY_KEY));
  const hiddenOnceRef = useRef(false);
  const notifiedRef = useRef<string | null>(null);
  const returnTimerRef = useRef<number | null>(null);
  /** الرمز الجاهز مسبقاً مع وقت انتهائه، حتى تفتح الضغطة الاختصار فوراً */
  const readyTokenRef = useRef<{ token: string; expiresAt: number } | null>(null);
  const mintingRef = useRef<Promise<{ token: string; expiresAt: number } | null> | null>(null);

  const { data: status } = useContactImportStatus(phase === "waiting" ? token : null);

  /** إنشاء رمز (أو إعادة الجاهز إن كان صالحاً لأكثر من دقيقة) */
  const ensureToken = useCallback((): Promise<{ token: string; expiresAt: number } | null> => {
    const current = readyTokenRef.current;
    if (current && current.expiresAt - Date.now() > 60_000) return Promise.resolve(current);
    if (mintingRef.current) return mintingRef.current;
    const promise = createToken
      .mutateAsync({ eventId })
      .then((created) => {
        const next = { token: created.token, expiresAt: new Date(created.expiresAt).getTime() };
        readyTokenRef.current = next;
        return next;
      })
      .catch((err: unknown) => {
        setErrorMessage(err instanceof Error ? err.message : "تعذر إنشاء رمز الاستيراد.");
        return null;
      })
      .finally(() => {
        mintingRef.current = null;
      });
    mintingRef.current = promise;
    return promise;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  // رمز جاهز منذ ظهور الزر (صالح 15 دقيقة؛ إنشاء رمز جديد يُلغي القديم غير المستخدم)
  useEffect(() => {
    readyTokenRef.current = null;
    void ensureToken();
    return () => {
      if (returnTimerRef.current) window.clearTimeout(returnTimerRef.current);
    };
  }, [ensureToken]);

  // وصول النتيجة: الرمز استُهلك → الأب يحدّث القائمة ويغلق
  useEffect(() => {
    if (!status || !token) return;
    if (status.usedAt) {
      if (notifiedRef.current === token) return;
      notifiedRef.current = token;
      readyTokenRef.current = null;
      if (returnTimerRef.current) window.clearTimeout(returnTimerRef.current);
      writeFlag(local(), READY_KEY, true); // الاختصار يعمل على هذا الجهاز قطعاً
      setReady(true);
      setPhase("done");
      onImported(status);
      return;
    }
    if (new Date(status.expiresAt).getTime() <= Date.now()) {
      readyTokenRef.current = null;
      setPhase("expired");
    }
  }, [status, token, onImported]);

  const markNotInstalled = () => {
    writeFlag(local(), READY_KEY, false);
    setReady(false);
    setPhase("not-installed");
    setShowInstall(true);
  };

  /** فتح الاختصار بالرمز — يجب أن يحدث داخل إيماءة الضغط نفسها */
  const launch = (minted: { token: string; expiresAt: number }) => {
    setToken(minted.token);
    setPhase("waiting");
    hiddenOnceRef.current = false;

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenOnceRef.current = true; // تطبيق الاختصارات فُتح فعلاً
        return;
      }
      // عاد إلى الصفحة: إن لم تصل الجهات خلال ثوانٍ فالاختصار لم يعمل (غير مضاف أو أُلغي)
      if (hiddenOnceRef.current) {
        document.removeEventListener("visibilitychange", onVisibility);
        if (returnTimerRef.current) window.clearTimeout(returnTimerRef.current);
        returnTimerRef.current = window.setTimeout(() => {
          // قد يكون ألغى الاختيار فقط، فلا نُلغي «جاهز» — نعرض زر الإضافة كخيار
          if (notifiedRef.current !== minted.token) {
            setPhase("idle");
            setShowInstall(true);
          }
        }, RETURNED_WITHOUT_IMPORT_MS);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.setTimeout(() => {
      if (!hiddenOnceRef.current) {
        document.removeEventListener("visibilitychange", onVisibility);
        markNotInstalled();
      }
    }, NOT_OPENED_TIMEOUT_MS);

    // تغيير الموقع (لا window.open) حتى لا يحجبه مانع النوافذ
    window.location.href = iosShortcutRunUrl(minted.token);
  };

  /** أول مرة على هذا الجهاز: مباشرة إلى صفحة «إضافة اختصار»، وعند العودة تُفتح النافذة تلقائياً */
  const goInstall = () => {
    writeFlag(session(), PENDING_INSTALL_KEY, true);
    window.location.href = shortcutUrl;
  };

  const start = () => {
    setErrorMessage(null);
    setShowInstall(false);
    if (!ready && shortcutUrl) {
      goInstall();
      return;
    }
    const current = readyTokenRef.current;
    if (current && current.expiresAt - Date.now() > 60_000) {
      launch(current); // متزامن داخل الإيماءة
      return;
    }
    // لم يجهز الرمز بعد (أو انتهى): أنشئه ثم افتح
    setPhase("creating");
    void ensureToken().then((minted) => {
      if (!minted) {
        setPhase("error");
        return;
      }
      launch(minted);
    });
  };

  const busy = phase === "creating" || phase === "waiting";
  const firstTime = !ready && !!shortcutUrl;

  return (
    <div className="space-y-2" data-testid="ios-shortcut-import" data-phase={phase} data-ready={ready ? "1" : "0"}>
      <Button
        type="button"
        onClick={start}
        disabled={disabled || busy}
        className="h-auto w-full flex-col gap-0.5 bg-ink py-3 text-gold-light hover:bg-ink-soft"
        data-testid="ios-shortcut-button"
      >
        <span className="flex items-center gap-2 text-base font-bold">
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Smartphone className="h-5 w-5" />}
          استيراد من جهات اتصال iPhone
        </span>
        <span className="text-xs font-normal opacity-80">
          {phase === "waiting"
            ? "بانتظار جهات الاتصال…"
            : firstTime
              ? "أول مرة: اضغط «إضافة اختصار» ثم ارجع هنا"
              : "اختر عدة أشخاص دفعة واحدة"}
        </span>
      </Button>

      {phase === "waiting" && (
        <div className="space-y-2 rounded-lg border border-line bg-cream-2 px-3 py-2 text-right" data-testid="ios-shortcut-waiting">
          <p className="text-xs leading-relaxed text-gray-700">
            اختر الأشخاص ثم اضغط «تم» — تظهر الأسماء هنا فور وصولها.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => setShowInstall((v) => !v)} className="text-xs text-gold-deep underline">
              لم يُفتح شيء؟
            </button>
            <button
              type="button"
              onClick={() => {
                if (returnTimerRef.current) window.clearTimeout(returnTimerRef.current);
                setPhase("idle");
                setToken(null);
              }}
              className="inline-flex items-center gap-1 text-xs text-gray-600 underline"
            >
              <RotateCcw className="h-3 w-3" /> إلغاء
            </button>
          </div>
        </div>
      )}

      {phase === "done" && status && (
        <p className="flex items-center gap-1 text-xs text-emerald-700" data-testid="ios-shortcut-done">
          <CheckCircle2 className="h-4 w-4" /> وصل {status.importedCount} مدعو من الآيفون
          {status.duplicateCount > 0 ? "، ومكرر " + status.duplicateCount : ""}
          {status.skippedCount > 0 ? "، وبلا رقم صالح " + status.skippedCount : ""}.
        </p>
      )}

      {phase === "expired" && (
        <p className="text-xs text-amber-800">انتهت صلاحية الرمز (15 دقيقة) قبل وصول الجهات — اضغط الزر مرة أخرى.</p>
      )}

      {phase === "error" && errorMessage && (
        <p className="text-xs text-red-600" role="alert">
          {errorMessage}
        </p>
      )}

      {(showInstall || phase === "not-installed") && (
        <div className="space-y-2 rounded-lg border border-line bg-white p-3 text-right" data-testid="ios-shortcut-install">
          {shortcutUrl ? (
            <>
              <p className="text-sm text-gray-800" data-testid="ios-shortcut-not-installed">
                اختصار دعوات غير مضاف على هذا الجهاز بعد — أضفه بضغطة واحدة ثم ارجع هنا.
              </p>
              <Button
                type="button"
                onClick={goInstall}
                variant="outline"
                className="w-full border-gold text-gold-deep"
                data-testid="ios-shortcut-install-link"
              >
                <Download className="ml-2 h-4 w-4" /> إضافة اختصار دعوات
              </Button>
              <button type="button" onClick={() => setShowHow((v) => !v)} className="text-xs text-gold-deep underline">
                {showHow ? "إخفاء الخطوات" : "كيف؟"}
              </button>
              {showHow && (
                <ol className="list-decimal space-y-1 pr-4 text-xs leading-relaxed text-gray-700">
                  <li>«إضافة اختصار دعوات» ← تُفتح صفحة الاختصار ← اضغط «إضافة اختصار».</li>
                  <li>ارجع إلى الموقع (زر الرجوع في سفاري) ← اضغط «استيراد من جهات اتصال iPhone» ← «فتح».</li>
                  <li>اختر الأشخاص ← «تم». أول مرة فقط يطلب iOS السماح بجهات الاتصال وبـ dawaatly.top.</li>
                  <li className="text-gray-500">اسم الاختصار يجب أن يبقى «{IOS_SHORTCUT_NAME}».</li>
                </ol>
              )}
            </>
          ) : (
            <p className="text-xs text-amber-800" data-testid="ios-shortcut-missing-url">
              رابط اختصار دعوات لم يُضبط بعد في الإعدادات — استخدم «من جهات الاتصال» بالأسفل مؤقتاً.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
