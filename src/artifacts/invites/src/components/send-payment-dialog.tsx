import { useEffect, useRef, useState } from "react";
import {
  BadgeCheck,
  Banknote,
  Check,
  Clock,
  Copy,
  ExternalLink,
  FileImage,
  Loader2,
  RefreshCw,
  ShieldCheck,
  XCircle,
  CreditCard,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  getPaymentProofUrl,
  paymentErrorMessage,
  PAYMENT_STATUS_LABELS,
  uploadPaymentProof,
  useRequestEventPayment,
  useSubmitEventPayment,
  type AppSettings,
  type EventPayment,
  useStartGatewayPayment,
  useGetMe,
  useEventFeeBreakdown,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";

interface SendPaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eventId: number;
  eventTitle: string;
  settings: AppSettings;
  /** العملية الحالية للمناسبة (إن وُجدت) */
  payment: EventPayment | null;
  isLoadingPayment: boolean;
  onRefresh: () => void;
  /** يُستدعى عندما تكون العملية مدفوعة والمستخدم يريد المتابعة للإرسال */
  onContinue: () => void;
}

/** الحد الأدنى لفاتورة بوابة بيلينك — أقل منه ترفضه البوابة نفسها */
const GATEWAY_MIN_AMOUNT = 5;

/** 150 → «150 ريال»، 150.5 → «150.50 ريال» */
export function formatFee(amount: number, currency: string): string {
  const value = Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
  const unit = currency === "SAR" || !currency ? "ريال" : currency;
  return value + " " + unit;
}

function formatWhen(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("ar-SA", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

/**
 * شاشة الدفع قبل الإرسال النهائي.
 *
 * الحالة تنتقل: (لا عملية) ← بانتظار الدفع ← بانتظار مراجعة الإدارة ← مدفوعة.
 * الضغط على «أرسلت التحويل» لا يجعل العملية مدفوعة؛ بل يرفع الإثبات ويحوّلها
 * إلى «بانتظار المراجعة»، والإرسال يبقى مقفلاً في قاعدة البيانات نفسها حتى
 * يوافق الأدمن. بوابة الدفع الإلكترونية تُربط لاحقاً بنفس الجدول والحالات.
 */
export function SendPaymentDialog({
  open,
  onOpenChange,
  eventId,
  eventTitle,
  settings,
  payment,
  isLoadingPayment,
  onRefresh,
  onContinue,
}: SendPaymentDialogProps) {
  const { user } = useAuth();
  const { data: me } = useGetMe();
  const requestPayment = useRequestEventPayment();
  const submitPayment = useSubmitEventPayment();
  const startGatewayPayment = useStartGatewayPayment();
  const { data: fees } = useEventFeeBreakdown(eventId);

  const [reference, setReference] = useState("");
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [proofPreview, setProofPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [proofUrl, setProofUrl] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // عند الفتح بلا عملية: ننشئ واحدة بالمبلغ الحالي من الإعدادات
  useEffect(() => {
    if (!open) return;
    setError(null);
    if (!payment && !isLoadingPayment && !requestPayment.isPending) {
      requestPayment.mutate(
        { eventId },
        { onError: (err) => setError(paymentErrorMessage(err)) },
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, payment, isLoadingPayment]);

  // معاينة الملف المختار
  useEffect(() => {
    if (!proofFile || !proofFile.type.startsWith("image/")) {
      setProofPreview(null);
      return;
    }
    const url = URL.createObjectURL(proofFile);
    setProofPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [proofFile]);

  // رابط موقّت لعرض الإثبات المرفوع سابقاً
  useEffect(() => {
    setProofUrl(null);
    if (!open || !payment?.proofPath || payment.status === "pending") return;
    let cancelled = false;
    getPaymentProofUrl(payment.proofPath)
      .then((url) => { if (!cancelled) setProofUrl(url); })
      .catch(() => { /* العرض اختياري */ });
    return () => { cancelled = true; };
  }, [open, payment?.proofPath, payment?.status]);

  useEffect(() => {
    if (!open) {
      setReference("");
      setProofFile(null);
      setCopied(false);
    }
  }, [open]);

  const amount = payment ? payment.amount : settings.feeBaseAmount;
  const currency = payment ? payment.currency : settings.sendFeeCurrency;
  const status = payment?.status ?? null;
  const canSubmit = status === "pending" || status === "rejected";

  // البطاقة هي المسار الأساسي متى كانت البوابة مفعّلة والمبلغ يقبله بيلينك.
  // التحويل البنكي يبقى بديلاً مطويّاً لا يراه العميل إلا إن طلبه، أو إن كان
  // المبلغ أقل من حد البوابة، أو إن كانت البوابة معطّلة.
  const cardIsPrimary = settings.paymentGatewayEnabled && amount >= GATEWAY_MIN_AMOUNT;
  const [showBank, setShowBank] = useState(false);
  useEffect(() => {
    if (!open) setShowBank(false);
  }, [open]);
  const bankVisible = !cardIsPrimary || showBank;
  // دفعة بطاقة معلّقة = العميل ربما عاد للتو من بيلينك والتأكيد في الطريق
  const awaitingGateway = status === "pending" && payment?.method === "gateway";

  /**
   * الدفع بالبطاقة: الموقع يطلب رابط الدفع من الـ Worker ثم يحوّل العميل إليه.
   * العودة والتأكيد يتمان على الخادم (/api/pay/return و/api/pay/webhook).
   */
  const payByCard = async () => {
    setError(null);
    setBusy(true);
    try {
      const out = await startGatewayPayment.mutateAsync({
        eventId,
        clientName: me?.name ?? undefined,
        clientMobile: me?.defaultContactPhone || undefined,
        clientEmail: me?.email ?? undefined,
      });
      if (out.alreadyPaid) {
        onRefresh();
        return;
      }
      if (!out.url) throw new Error("لم يصل رابط الدفع. حاول مرة أخرى.");
      window.location.href = out.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر فتح صفحة الدفع.");
      setBusy(false);
    }
  };

  const copyIban = async () => {
    try {
      await navigator.clipboard.writeText(settings.bankIban.replace(/\s+/g, ""));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("تعذر النسخ — انسخ الآيبان يدوياً");
    }
  };

  const handleSubmit = async () => {
    if (!payment || !user) return;
    if (!proofFile) {
      setError("أرفق صورة إيصال التحويل قبل الإرسال للمراجعة.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const path = await uploadPaymentProof(user.id, proofFile);
      await submitPayment.mutateAsync({
        paymentId: payment.id,
        eventId,
        reference: reference.trim(),
        proofPath: path,
      });
      setProofFile(null);
      setReference("");
      onRefresh();
    } catch (err) {
      setError(paymentErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const bankRows = [
    { label: "البنك", value: settings.bankName },
    { label: "اسم المستفيد", value: settings.bankAccountName },
  ].filter((row) => row.value.trim() !== "");
  const hasBankInfo = bankRows.length > 0 || settings.bankIban.trim() !== "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-h-[92vh] max-w-lg overflow-y-auto">
        <DialogHeader className="text-right sm:text-right">
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-gold-deep" />
            رسوم إرسال الدعوات
          </DialogTitle>
          <DialogDescription className="text-right">
            {eventTitle} — رسوم هذه المناسبة وحدها، ولا تُرسل أي دعوة قبل تأكيد الدفع.
          </DialogDescription>
        </DialogHeader>

        {/* تفصيل السعر — العميل يرى مم تكوّن المبلغ */}
        {fees && fees.items.some((item) => item.applied && item.amount > 0) && (
          <div
            className="rounded-xl border border-line bg-white px-4 py-3 text-sm"
            data-testid="fee-breakdown"
          >
            <p className="mb-2 text-xs font-medium text-gray-600">تفصيل الرسوم</p>
            <ul className="space-y-1.5">
              {fees.items
                .filter((item) => item.applied && item.amount > 0)
                .map((item) => (
                  <li key={item.key} className="flex items-center justify-between text-gray-700">
                    <span>{item.label}</span>
                    <span className="font-medium text-gray-900">{formatFee(item.amount, fees.currency)}</span>
                  </li>
                ))}
            </ul>
            {fees.paid > 0 && fees.paid < fees.total && (
              <p className="mt-2 border-t border-gray-100 pt-2 text-xs text-gray-600">
                سبق سداد {formatFee(fees.paid, fees.currency)} لهذه المناسبة، والمطلوب الآن هو الفرق
                بعد إضافة ميزة جديدة.
              </p>
            )}
          </div>
        )}

        {/* المبلغ — واضح دائماً */}
        <div className="flex items-center justify-between rounded-xl border border-line bg-cream-2 px-4 py-3">
          <div>
            <p className="text-xs text-gray-600">المبلغ المطلوب لهذه المناسبة</p>
            <p className="text-2xl font-bold text-gray-900" dir="ltr">
              <span dir="rtl">{formatFee(amount, currency)}</span>
            </p>
          </div>
          {status && (
            <span
              className={
                "rounded-full px-3 py-1 text-xs font-bold " +
                (status === "paid"
                  ? "bg-emerald-100 text-emerald-800"
                  : status === "submitted"
                    ? "bg-amber-100 text-amber-800"
                    : status === "rejected"
                      ? "bg-red-100 text-red-800"
                      : "bg-gray-100 text-gray-700")
              }
              data-testid="payment-status"
            >
              {PAYMENT_STATUS_LABELS[status]}
            </span>
          )}
        </div>

        {(isLoadingPayment || requestPayment.isPending) && !payment && (
          <div className="flex items-center justify-center gap-2 py-6 text-sm text-gray-600">
            <Loader2 className="h-4 w-4 animate-spin" /> جارٍ تجهيز عملية الدفع…
          </div>
        )}

        {/* مدفوعة: متابعة الإرسال */}
        {status === "paid" && (
          <div className="space-y-3">
            <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                تم تأكيد الدفع
                {payment?.paidAt ? " في " + formatWhen(payment.paidAt) : ""}
                {payment?.reference ? " — رقم العملية: " + payment.reference : ""}
                . الإرسال مفتوح لهذه المناسبة.
              </p>
            </div>
            <Button
              type="button"
              className="h-12 w-full bg-green-600 font-bold text-white hover:bg-green-700"
              onClick={onContinue}
            >
              متابعة إرسال الدعوات
            </Button>
          </div>
        )}

        {/* بانتظار المراجعة */}
        {status === "submitted" && payment && (
          <div className="space-y-3">
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm leading-relaxed text-amber-900">
              <Clock className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-bold">استلمنا إثبات التحويل وهو قيد المراجعة.</p>
                <p>
                  أُرسل في {formatWhen(payment.submittedAt)}
                  {payment.reference ? " — رقم العملية: " + payment.reference : ""}.
                  سيُفتح الإرسال فور موافقة الإدارة، ولن تُرسل أي دعوة قبل ذلك.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {proofUrl && (
                <Button
                  type="button"
                  variant="outline"
                  className="border-line"
                  onClick={() => window.open(proofUrl, "_blank", "noopener")}
                >
                  <ExternalLink className="ml-2 h-4 w-4" /> عرض الإثبات المرفوع
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                className="border-line"
                onClick={onRefresh}
              >
                <RefreshCw className="ml-2 h-4 w-4" /> تحديث الحالة
              </Button>
            </div>
          </div>
        )}

        {/* بانتظار الدفع أو مرفوضة: التحويل ورفع الإثبات */}
        {canSubmit && payment && (
          <div className="space-y-4">
            {status === "rejected" && (
              <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm leading-relaxed text-red-800">
                <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <p className="font-bold">لم تُقبل عملية الدفع السابقة.</p>
                  {payment.adminNote && <p>سبب الإدارة: {payment.adminNote}</p>}
                  <p>يمكنك رفع إثبات جديد بالأسفل.</p>
                </div>
              </div>
            )}

            {/* مبلغ أقل من حد البوابة لا يمكن دفعه بالبطاقة — نقولها بدل زر يفشل */}
            {settings.paymentGatewayEnabled && amount > 0 && amount < GATEWAY_MIN_AMOUNT && (
              <p className="rounded-xl border border-line bg-cream-2 px-4 py-3 text-xs leading-relaxed text-gray-700">
                الدفع بالبطاقة متاح من {formatFee(GATEWAY_MIN_AMOUNT, currency)} فأكثر، وهذا المبلغ أقل
                من ذلك — أكمله بالتحويل البنكي أدناه.
              </p>
            )}

            {/* الدفع بالبطاقة: فوري ولا يحتاج مراجعة الأدمن */}
            {settings.paymentGatewayEnabled && amount >= GATEWAY_MIN_AMOUNT && (
              <section className="space-y-2 rounded-xl border-2 border-gold bg-gold/5 p-4" data-testid="pay-by-card">
                <h3 className="flex items-center gap-2 text-sm font-bold text-gray-900">
                  <CreditCard className="h-4 w-4 text-gold-deep" /> ادفع بالبطاقة — فوري
                </h3>
                <p className="text-xs leading-relaxed text-gray-700">
                  مدى أو فيزا أو ماستركارد أو Apple Pay عبر صفحة بيلينك الآمنة. يُفتح الإرسال فور
                  تأكيد الدفع — بلا رفع إثبات ولا انتظار مراجعة.
                </p>
                <Button
                  type="button"
                  onClick={() => void payByCard()}
                  disabled={busy}
                  className="h-auto w-full bg-ink py-3 text-base font-bold text-gold-light hover:bg-ink-soft"
                  data-testid="pay-by-card-button"
                >
                  {busy ? (
                    <Loader2 className="ml-2 h-5 w-5 animate-spin" />
                  ) : (
                    <CreditCard className="ml-2 h-5 w-5" />
                  )}
                  ادفع {formatFee(amount, currency)} بالبطاقة
                </Button>
              </section>
            )}

            {awaitingGateway && (
              <p
                className="flex items-center gap-2 rounded-lg border border-line bg-cream-2 px-3 py-2 text-xs leading-relaxed text-gray-700"
                data-testid="awaiting-gateway"
              >
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                إن كنتَ أكملت الدفع للتو فسنتحقق منه مع بيلينك ونحدّث الحالة تلقائياً خلال لحظات.
              </p>
            )}

            {/* التحويل البنكي: مطويّ خلف رابط صغير عندما تكون البطاقة هي الأساس */}
            {cardIsPrimary && hasBankInfo && !showBank && (
              <button
                type="button"
                onClick={() => setShowBank(true)}
                className="mx-auto block text-xs text-gray-500 underline-offset-4 hover:text-gray-800 hover:underline"
                data-testid="show-bank-option"
              >
                لا تملك بطاقة؟ الدفع بالتحويل البنكي
              </button>
            )}

            {bankVisible && (
            <>
            {cardIsPrimary && (
              <p className="text-center text-xs text-gray-500">التحويل البنكي — يحتاج رفع إثبات ومراجعة الإدارة</p>
            )}

            <section className="space-y-2 rounded-xl border border-line p-4">
              <h3 className="flex items-center gap-2 text-sm font-bold text-gray-900">
                <Banknote className="h-4 w-4 text-gold-deep" /> ١ — حوّل المبلغ إلى الحساب التالي
              </h3>
              {hasBankInfo ? (
                <dl className="space-y-1 text-sm">
                  {bankRows.map((row) => (
                    <div key={row.label} className="flex justify-between gap-3">
                      <dt className="text-gray-600">{row.label}</dt>
                      <dd className="font-medium text-gray-900">{row.value}</dd>
                    </div>
                  ))}
                  {settings.bankIban.trim() !== "" && (
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-gray-600">الآيبان</dt>
                      <dd className="flex items-center gap-1">
                        <span className="font-mono text-xs font-medium text-gray-900" dir="ltr">
                          {settings.bankIban}
                        </span>
                        <button
                          type="button"
                          onClick={() => void copyIban()}
                          className="rounded p-1 text-gray-500 hover:bg-gray-100"
                          title="نسخ الآيبان"
                          aria-label="نسخ الآيبان"
                        >
                          {copied ? (
                            <Check className="h-4 w-4 text-emerald-600" />
                          ) : (
                            <Copy className="h-4 w-4" />
                          )}
                        </button>
                      </dd>
                    </div>
                  )}
                </dl>
              ) : (
                <p className="text-sm text-gray-600">
                  لم تُضبط بيانات التحويل بعد — تواصل مع الدعم لإتمام الدفع.
                </p>
              )}
              {settings.paymentInstructions.trim() !== "" && (
                <p className="whitespace-pre-line border-t border-line pt-2 text-xs leading-relaxed text-gray-600">
                  {settings.paymentInstructions}
                </p>
              )}
            </section>

            <section className="space-y-3 rounded-xl border border-line p-4">
              <h3 className="flex items-center gap-2 text-sm font-bold text-gray-900">
                <FileImage className="h-4 w-4 text-gold-deep" /> ٢ — أرفق إثبات التحويل
              </h3>
              <div>
                <Label htmlFor="payment-reference" className="mb-1 block text-xs">
                  رقم العملية من الإيصال (اختياري)
                </Label>
                <Input
                  id="payment-reference"
                  value={reference}
                  onChange={(event) => setReference(event.target.value)}
                  dir="ltr"
                  className="text-right"
                  placeholder="مثال: 20260928123456"
                  maxLength={120}
                />
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                className="hidden"
                data-testid="proof-input"
                onChange={(event) => {
                  setProofFile(event.target.files?.[0] ?? null);
                  setError(null);
                }}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={busy}
                className="flex w-full flex-col items-center gap-2 rounded-lg border-2 border-dashed border-line bg-cream-2 px-3 py-4 text-sm text-gray-700 hover:border-gold/60"
              >
                {proofPreview ? (
                  <img
                    src={proofPreview}
                    alt="معاينة الإثبات"
                    className="max-h-40 rounded-md object-contain"
                  />
                ) : (
                  <FileImage className="h-8 w-8 text-gold-deep" />
                )}
                <span className="font-medium">
                  {proofFile ? proofFile.name : "اختر صورة الإيصال أو ملف PDF"}
                </span>
                <span className="text-[11px] text-gray-500">JPG أو PNG أو PDF — حتى 5 ميجابايت</span>
              </button>
            </section>
            </>
            )}
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm leading-relaxed text-red-700"
          >
            {error}
          </div>
        )}

        {canSubmit && payment && bankVisible && (
          <Button
            type="button"
            className="h-12 w-full bg-gold font-bold text-black hover:bg-gold/90"
            disabled={busy || !proofFile}
            onClick={() => void handleSubmit()}
          >
            {busy && <Loader2 className="ml-2 h-4 w-4 animate-spin" />}
            أرسلت التحويل — إرسال الإثبات للمراجعة
          </Button>
        )}

        <p className="text-center text-[11px] leading-relaxed text-gray-500">
          {cardIsPrimary
            ? "الرسوم خاصة بهذه المناسبة وتُدفع مرة واحدة. بعد نجاح الدفع يُفتح الإرسال فوراً لكل المدعوين ولمن تضيفهم لاحقاً."
            : "الرسوم تُدفع مرة واحدة لكل مناسبة. بعد موافقة الإدارة يمكنك إرسال الدعوات لكل المدعوين ولمن تضيفهم لاحقاً."}
        </p>
      </DialogContent>
    </Dialog>
  );
}
