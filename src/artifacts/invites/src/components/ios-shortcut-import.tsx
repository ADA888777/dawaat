import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, ContactRound, Loader2, RotateCcw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  iosShortcutRunUrl,
  useContactImportStatus,
  useCreateContactImportToken,
  useGetAppSettings,
  type ContactImportStatus,
} from "@/lib/api";

/**
 * جهات اتصال الآيفون من سفاري — عبر اختصار Apple Shortcuts «Dawaat – Contacts»
 * كجسر مخفي عن العميل قدر الإمكان.
 *
 * الحقيقة التقنية: سفاري لا يسمح لأي موقع بالوصول لجهات الاتصال (لا توجد نافذة
 * صلاحية أصلاً)، والاختصار هو الطريق الوحيد لاختيار عدة أشخاص دفعة واحدة من الويب.
 * ما يفرضه ذلك على العميل ولا يمكن تجاوزه:
 *   • مرة واحدة على الجهاز: «تفعيل جهات الاتصال» ← صفحة صغيرة من Apple ← «إضافة
 *     اختصار» ← يرجع إلى دعوات (تُفتح النافذة تلقائياً).
 *   • قد يسأل سفاري «فتح في الاختصارات؟» وقد يطلب iOS صلاحية جهات الاتصال في أول
 *     تشغيل — نوافذ نظام لا نتحكم بها.
 * وبعدها: «من جهات الاتصال» ← تظهر جهات اتصال الجوال ← يحدد ← «تم» ← تُضاف
 * الأسماء والأرقام إلى الدعوة مباشرة بلا إعادة تحميل.
 *
 * الأمان: رمز استخدام واحد (create_contact_import_token — جلسة مسجّلة ومناسبة
 * يملكها المستخدم) صالح 15 دقيقة؛ الاختصار لا يحمل أي مفتاح. التوحيد ومنع التكرار
 * في قاعدة البيانات (import_contacts_with_token). الرمز يُنشأ مسبقاً لأن سفاري لا
 * يفتح مخططاً مخصصاً (shortcuts://) إلا داخل إيماءة الضغط نفسها.
 *
 * الواجهة لا تذكر VCF أو CSV أو Web API أو «المتصفح لا يدعم» — فقط ما يحتاجه العميل.
 */

export type IosShortcutPhase =
  | "idle"
  | "needs-activation"
  | "creating"
  | "waiting"
  | "failed"
  | "done"
  | "expired"
  | "error";

export interface IosShortcutController {
  /** رابط الاختصار مضبوط في الإعدادات (بدونه لا يمكن التفعيل) */
  available: boolean;
  /** فُعّل على هذا الجهاز (أو عاد من صفحة التفعيل) */
  ready: boolean;
  phase: IosShortcutPhase;
  status: ContactImportStatus | undefined;
  errorMessage: string | null;
  /** الضغطة الرئيسية: يفتح جهات الاتصال (أو يعرض بطاقة التفعيل أول مرة) — داخل إيماءة */
  start: () => void;
  /** «تفعيل جهات الاتصال»: إلى صفحة إضافة الاختصار، والعودة تفتح النافذة تلقائياً */
  activate: () => void;
  cancel: () => void;
  /** عدنا للتو من صفحة التفعيل — الأب يفتح النافذة ثم يستدعي acknowledgeResume */
  resumedAfterActivation: boolean;
  acknowledgeResume: () => void;
}

/** هذا الجهاز فعّل جهات الاتصال (أو عاد من صفحة التفعيل) — الضغطة التالية تفتحها مباشرة */
const READY_KEY = "dawaat.iosShortcutReady";
/** ذهبنا إلى صفحة التفعيل وننتظر العودة — يفتح الأب نافذة جهات الاتصال تلقائياً */
const PENDING_INSTALL_KEY = "dawaat.iosShortcutPendingInstall";

/** مهلة نافذة «فتح في الاختصارات؟» التي قد يعرضها سفاري قبل مغادرة الصفحة */
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

/** هل عدنا للتو من صفحة التفعيل؟ تُمسح العلامة ويُعدّ الجهاز مفعّلاً */
function consumePendingShortcutInstall(): boolean {
  const pending = readFlag(session(), PENDING_INSTALL_KEY);
  if (pending) {
    writeFlag(session(), PENDING_INSTALL_KEY, false);
    writeFlag(local(), READY_KEY, true);
  }
  return pending;
}

interface UseIosShortcutImportOptions {
  eventId: number;
  /** false خارج سفاري الآيفون أو عند تعطيل الميزة — لا يُنشأ أي رمز */
  enabled: boolean;
  onImported: (status: ContactImportStatus) => void;
}

export function useIosShortcutImport({ eventId, enabled, onImported }: UseIosShortcutImportOptions): IosShortcutController {
  const { data: settings } = useGetAppSettings();
  const shortcutUrl = (settings?.iosShortcutUrl ?? "").trim();
  const available = shortcutUrl !== "";
  const createToken = useCreateContactImportToken();

  const [phase, setPhase] = useState<IosShortcutPhase>("idle");
  const [token, setToken] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [ready, setReady] = useState(() => readFlag(local(), READY_KEY));
  const [resumedAfterActivation, setResumed] = useState(false);
  const hiddenOnceRef = useRef(false);
  const notifiedRef = useRef<string | null>(null);
  const returnTimerRef = useRef<number | null>(null);
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
        setErrorMessage(err instanceof Error ? err.message : "تعذر تجهيز الاستيراد. حاول مرة أخرى.");
        return null;
      })
      .finally(() => {
        mintingRef.current = null;
      });
    mintingRef.current = promise;
    return promise;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  // العودة من صفحة التفعيل: الجهاز مفعّل الآن، والأب يفتح النافذة ليكمل بضغطة واحدة
  useEffect(() => {
    if (!enabled) return;
    if (consumePendingShortcutInstall()) {
      setReady(true);
      setResumed(true);
    }
  }, [enabled]);

  // رمز جاهز مسبقاً للأجهزة المفعّلة، حتى تفتح ضغطة «من جهات الاتصال» الاختصار فوراً
  useEffect(() => {
    readyTokenRef.current = null;
    if (enabled && eventId > 0 && ready && available) void ensureToken();
    return () => {
      if (returnTimerRef.current) window.clearTimeout(returnTimerRef.current);
    };
  }, [enabled, eventId, ready, available, ensureToken]);

  // وصول النتيجة: الرمز استُهلك → الأب يحدّث القائمة ويغلق
  useEffect(() => {
    if (!status || !token) return;
    if (status.usedAt) {
      if (notifiedRef.current === token) return;
      notifiedRef.current = token;
      readyTokenRef.current = null;
      if (returnTimerRef.current) window.clearTimeout(returnTimerRef.current);
      writeFlag(local(), READY_KEY, true); // يعمل على هذا الجهاز قطعاً
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

  const launch = (minted: { token: string; expiresAt: number }) => {
    setToken(minted.token);
    setPhase("waiting");
    hiddenOnceRef.current = false;

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenOnceRef.current = true; // غادرنا إلى الاختصار فعلاً
        return;
      }
      // عاد إلى الصفحة: إن لم تصل الجهات خلال ثوانٍ فالاختصار لم يعمل (أو أُلغي)
      if (hiddenOnceRef.current) {
        document.removeEventListener("visibilitychange", onVisibility);
        if (returnTimerRef.current) window.clearTimeout(returnTimerRef.current);
        returnTimerRef.current = window.setTimeout(() => {
          if (notifiedRef.current !== minted.token) setPhase("failed");
        }, RETURNED_WITHOUT_IMPORT_MS);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.setTimeout(() => {
      if (!hiddenOnceRef.current) {
        document.removeEventListener("visibilitychange", onVisibility);
        // لم يُفتح شيء: الاختصار غير مضاف (أو رُفضت نافذة سفاري) — نعيد التفعيل
        writeFlag(local(), READY_KEY, false);
        setReady(false);
        setPhase("failed");
      }
    }, NOT_OPENED_TIMEOUT_MS);

    // تغيير الموقع (لا window.open) حتى لا يحجبه مانع النوافذ
    window.location.href = iosShortcutRunUrl(minted.token);
  };

  const activate = () => {
    if (!available) return;
    writeFlag(session(), PENDING_INSTALL_KEY, true);
    window.location.href = shortcutUrl;
  };

  const start = () => {
    setErrorMessage(null);
    if (!available) return;
    if (!ready) {
      setPhase("needs-activation");
      return;
    }
    const current = readyTokenRef.current;
    if (current && current.expiresAt - Date.now() > 60_000) {
      launch(current); // متزامن داخل الإيماءة
      return;
    }
    setPhase("creating");
    void ensureToken().then((minted) => {
      if (!minted) {
        setPhase("error");
        return;
      }
      launch(minted);
    });
  };

  const cancel = () => {
    if (returnTimerRef.current) window.clearTimeout(returnTimerRef.current);
    setToken(null);
    setPhase("idle");
  };

  return {
    available,
    ready,
    phase,
    status,
    errorMessage,
    start,
    activate,
    cancel,
    resumedAfterActivation,
    acknowledgeResume: () => setResumed(false),
  };
}

/**
 * لوحة العميل داخل نافذة جهات الاتصال على الآيفون: زر واحد، ولا كلمة تقنية.
 */
export function IosShortcutPanel({ controller, disabled = false }: { controller: IosShortcutController; disabled?: boolean }) {
  const { phase, ready, status, errorMessage, start, activate, cancel } = controller;
  const busy = phase === "creating" || phase === "waiting";

  const activationCard = (
    <div className="space-y-3 rounded-xl border border-gold/40 bg-gold/5 p-4 text-right" data-testid="ios-shortcut-activate">
      <div className="flex items-start gap-2">
        <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-gold-deep" />
        <div>
          <p className="text-sm font-bold text-gray-900">لإضافة جهات اتصالك لأول مرة</p>
          <p className="text-xs leading-relaxed text-gray-700">
            خطوة واحدة من Apple: تفتح صفحة صغيرة اضغط فيها «إضافة اختصار»، ثم ارجع إلى دعوات.
          </p>
        </div>
      </div>
      <Button
        type="button"
        onClick={activate}
        disabled={disabled}
        className="h-auto w-full bg-ink py-3 text-base font-bold text-gold-light hover:bg-ink-soft"
        data-testid="ios-shortcut-activate-button"
      >
        <ContactRound className="ml-2 h-5 w-5" /> تفعيل جهات الاتصال
      </Button>
    </div>
  );

  if (!ready && (phase === "idle" || phase === "needs-activation")) {
    return (
      <div data-testid="ios-shortcut-import" data-phase={phase} data-ready="0">
        {activationCard}
      </div>
    );
  }

  return (
    <div className="space-y-2" data-testid="ios-shortcut-import" data-phase={phase} data-ready={ready ? "1" : "0"}>
      {phase !== "failed" && (
        <Button
          type="button"
          onClick={start}
          disabled={disabled || busy}
          className="h-auto w-full flex-col gap-0.5 bg-ink py-3 text-gold-light hover:bg-ink-soft"
          data-testid="ios-shortcut-button"
        >
          <span className="flex items-center gap-2 text-base font-bold">
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <ContactRound className="h-5 w-5" />}
            من جهات الاتصال
          </span>
          <span className="text-xs font-normal opacity-80">
            {phase === "waiting" ? "بانتظار جهات الاتصال…" : "اختر عدة أشخاص دفعة واحدة"}
          </span>
        </Button>
      )}

      {phase === "waiting" && (
        <div className="space-y-2 rounded-lg border border-line bg-cream-2 px-3 py-2 text-right" data-testid="ios-shortcut-waiting">
          <p className="text-xs leading-relaxed text-gray-700">اختر الأشخاص ثم اضغط «تم» — تظهر الأسماء هنا فور وصولها.</p>
          <button type="button" onClick={cancel} className="inline-flex items-center gap-1 text-xs text-gray-600 underline">
            <RotateCcw className="h-3 w-3" /> إلغاء
          </button>
        </div>
      )}

      {phase === "failed" && (
        <div className="space-y-3" data-testid="ios-shortcut-failed">
          <p className="text-sm text-gray-800">لم تُفتح جهات الاتصال.</p>
          <Button
            type="button"
            onClick={start}
            disabled={disabled}
            variant="outline"
            className="w-full border-line"
            data-testid="ios-shortcut-retry"
          >
            <RotateCcw className="ml-2 h-4 w-4" /> حاول مرة أخرى
          </Button>
          {activationCard}
        </div>
      )}

      {phase === "done" && status && (
        <p className="flex items-center gap-1 text-xs text-emerald-700" data-testid="ios-shortcut-done">
          <CheckCircle2 className="h-4 w-4" /> أُضيف {status.importedCount} مدعو
          {status.duplicateCount > 0 ? "، ومكرر " + status.duplicateCount : ""}
          {status.skippedCount > 0 ? "، وبلا رقم صالح " + status.skippedCount : ""}.
        </p>
      )}

      {phase === "expired" && (
        <p className="text-xs text-amber-800">مرّ وقت طويل قبل وصول الأسماء — اضغط «من جهات الاتصال» مرة أخرى.</p>
      )}

      {phase === "error" && errorMessage && (
        <p className="text-xs text-red-600" role="alert">
          {errorMessage}
        </p>
      )}
    </div>
  );
}
