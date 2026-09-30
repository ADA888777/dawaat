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
 * التدفق:
 *   ١ الضغط على الزر ← الموقع ينشئ رمز استخدام واحد (15 دقيقة) مربوطاً بالمستخدم
 *     والمناسبة (دالة create_contact_import_token — تتطلب جلسة مسجّلة).
 *   ٢ يُفتح الاختصار: shortcuts://run-shortcut?name=…&input=text&text=TOKEN
 *     والاختصار يعرض منتقي جهات الاتصال (اختيار متعدد) ثم يرسل الأسماء والأرقام
 *     مع الرمز إلى POST /api/contacts/import. لا يحمل الاختصار أي مفتاح سري.
 *   ٣ هذه الصفحة تستطلع حالة الرمز كل ثانيتين؛ عند استهلاكه تُحدَّث قائمة
 *     المدعوين مباشرة (بلا إعادة تحميل) وتُغلق النافذة. الاختصار أيضاً يعيد
 *     المستخدم إلى /events/:id?imported=1 في النهاية.
 *
 * كشف «الاختصار غير مثبّت»: إن لم تختفِ الصفحة (visibilitychange) خلال ثوانٍ
 * من فتح الرابط فتطبيق الاختصارات لم يُفتح، فنعرض زر «إضافة اختصار دعوات».
 * وإن فُتح التطبيق لكن الاختصار غير موجود، يعود المستخدم بلا استيراد فيرى
 * الزر نفسه أسفل حالة الانتظار.
 *
 * مهم: سفاري لا يسمح بفتح رابط بمخطط مخصص (shortcuts://) إلا داخل إيماءة
 * المستخدم نفسها، ولا يبقى ذلك بعد انتظار طلب شبكة. لذلك يُنشأ الرمز مسبقاً عند
 * ظهور الزر، وضغطة الزر تفتح الاختصار فوراً وبشكل متزامن.
 */

type Phase = "idle" | "creating" | "waiting" | "not-installed" | "done" | "expired" | "error";

interface IosShortcutImportProps {
  eventId: number;
  /** عند وصول الجهات: يحدّث الأب القائمة ويغلق النافذة */
  onImported: (status: ContactImportStatus) => void;
  disabled?: boolean;
}

const NOT_OPENED_TIMEOUT_MS = 2500;

export function IosShortcutImport({ eventId, onImported, disabled = false }: IosShortcutImportProps) {
  const { data: settings } = useGetAppSettings();
  const shortcutUrl = (settings?.iosShortcutUrl ?? "").trim();
  const createToken = useCreateContactImportToken();

  const [phase, setPhase] = useState<Phase>("idle");
  const [token, setToken] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showInstall, setShowInstall] = useState(false);
  const hiddenOnceRef = useRef(false);
  const notifiedRef = useRef<string | null>(null);
  /** الرمز الجاهز مسبقاً مع وقت انتهائه، حتى تفتح الضغطة الاختصار فوراً */
  const readyRef = useRef<{ token: string; expiresAt: number } | null>(null);
  const mintingRef = useRef<Promise<{ token: string; expiresAt: number } | null> | null>(null);

  const { data: status } = useContactImportStatus(phase === "waiting" ? token : null);

  /** إنشاء رمز (أو إعادة الجاهز إن كان صالحاً لأكثر من دقيقة) */
  const ensureToken = useCallback((): Promise<{ token: string; expiresAt: number } | null> => {
    const ready = readyRef.current;
    if (ready && ready.expiresAt - Date.now() > 60_000) return Promise.resolve(ready);
    if (mintingRef.current) return mintingRef.current;
    const promise = createToken
      .mutateAsync({ eventId })
      .then((created) => {
        const next = { token: created.token, expiresAt: new Date(created.expiresAt).getTime() };
        readyRef.current = next;
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
    readyRef.current = null;
    void ensureToken();
  }, [ensureToken]);

  // وصول النتيجة: الرمز استُهلك → الأب يحدّث القائمة ويغلق
  useEffect(() => {
    if (!status || !token) return;
    if (status.usedAt) {
      if (notifiedRef.current === token) return;
      notifiedRef.current = token;
      readyRef.current = null;
      setPhase("done");
      onImported(status);
      return;
    }
    if (new Date(status.expiresAt).getTime() <= Date.now()) {
      readyRef.current = null;
      setPhase("expired");
    }
  }, [status, token, onImported]);

  /** فتح الاختصار بالرمز — يجب أن يحدث داخل إيماءة الضغط نفسها */
  const launch = (ready: { token: string; expiresAt: number }) => {
    setToken(ready.token);
    setPhase("waiting");
    hiddenOnceRef.current = false;

    // هل غادرنا الصفحة فعلاً إلى تطبيق الاختصارات؟
    const onVisibility = () => {
      if (document.visibilityState === "hidden") hiddenOnceRef.current = true;
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.setTimeout(() => {
      document.removeEventListener("visibilitychange", onVisibility);
      if (!hiddenOnceRef.current) {
        setPhase("not-installed");
        setShowInstall(true);
      }
    }, NOT_OPENED_TIMEOUT_MS);

    // تغيير الموقع (لا window.open) حتى لا يحجبه مانع النوافذ
    window.location.href = iosShortcutRunUrl(ready.token);
  };

  const start = () => {
    setErrorMessage(null);
    setShowInstall(false);
    const ready = readyRef.current;
    if (ready && ready.expiresAt - Date.now() > 60_000) {
      launch(ready); // متزامن داخل الإيماءة
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

  const installBlock = (
    <div className="space-y-2 rounded-lg border border-line bg-white p-3 text-right" data-testid="ios-shortcut-install">
      <p className="text-sm font-bold text-gray-900">إضافة اختصار دعوات (مرة واحدة)</p>
      <ol className="list-decimal space-y-1 pr-4 text-xs leading-relaxed text-gray-700">
        <li>اضغط «إضافة اختصار دعوات» ← تُفتح صفحة الاختصار ← اضغط «إضافة اختصار».</li>
        <li>ارجع هنا واضغط «استيراد من جهات اتصال iPhone» ← اختر الأشخاص ← اضغط «تم».</li>
        <li>أول مرة فقط: اسمح للاختصار بالوصول إلى جهات الاتصال وإلى dawaatly.top.</li>
      </ol>
      {shortcutUrl ? (
        <Button asChild type="button" variant="outline" className="w-full border-gold text-gold-deep">
          <a href={shortcutUrl} target="_blank" rel="noopener noreferrer" data-testid="ios-shortcut-install-link">
            <Download className="ml-2 h-4 w-4" /> إضافة اختصار دعوات
          </a>
        </Button>
      ) : (
        <p className="text-xs text-amber-800" data-testid="ios-shortcut-missing-url">
          رابط الاختصار لم يُضبط بعد — تواصل مع الدعم، أو استخدم «من جهات الاتصال» بالأسفل مؤقتاً.
        </p>
      )}
      <p className="text-[11px] text-gray-500">
        يجب أن يبقى اسم الاختصار «{IOS_SHORTCUT_NAME}» كما هو حتى يفتحه الموقع.
      </p>
    </div>
  );

  return (
    <div className="space-y-2" data-testid="ios-shortcut-import" data-phase={phase}>
      <Button
        type="button"
        onClick={start}
        disabled={disabled || phase === "creating" || phase === "waiting"}
        className="h-auto w-full flex-col gap-0.5 bg-ink py-3 text-gold-light hover:bg-ink-soft"
        data-testid="ios-shortcut-button"
      >
        <span className="flex items-center gap-2 text-base font-bold">
          {phase === "creating" || phase === "waiting" ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <Smartphone className="h-5 w-5" />
          )}
          استيراد من جهات اتصال iPhone
        </span>
        <span className="text-xs font-normal opacity-80">
          {phase === "waiting"
            ? "بانتظار جهات الاتصال من الاختصار…"
            : "يفتح اختصار «دعوات» لاختيار عدة أشخاص دفعة واحدة"}
        </span>
      </Button>

      {phase === "waiting" && (
        <div className="space-y-2 rounded-lg border border-line bg-cream-2 px-3 py-2 text-right" data-testid="ios-shortcut-waiting">
          <p className="text-xs leading-relaxed text-gray-700">
            اختر الأشخاص في الاختصار ثم اضغط «تم». ستظهر الأسماء هنا فور وصولها.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => setShowInstall((v) => !v)} className="text-xs text-gold-deep underline">
              لم يُفتح الاختصار؟ أضفه أولاً
            </button>
            <button
              type="button"
              onClick={() => {
                setPhase("idle");
                setToken(null);
                // نفس الرمز يبقى صالحاً للمحاولة التالية
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

      {phase === "not-installed" && (
        <p className="text-xs text-amber-800" data-testid="ios-shortcut-not-installed">
          لم يُفتح تطبيق الاختصارات. أضف اختصار دعوات أولاً ثم حاول مرة أخرى.
        </p>
      )}

      {(showInstall || phase === "not-installed") && installBlock}
    </div>
  );
}
