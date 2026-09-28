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
  const requestPayment = useRequestEventPayment();
  const submitPayment = useSubmitEventPayment();

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

  const amount = payment ? payment.amount : settings.sendFeeAmount;
  const currency = payment ? payment.currency : settings.sendFeeCurrency;
  const status = payment?.status ?? null;
  const canSubmit = status === "pending" || status === "rejected";

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
            {eventTitle} — لا تُرسل أي دعوة قبل تأكيد الدفع.
          </DialogDescription>
        </DialogHeader>

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

        {canSubmit && payment && (
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
          الرسوم تُدفع مرة واحدة لكل مناسبة. بعد موافقة الإدارة يمكنك إرسال الدعوات
          لكل المدعوين ولمن تضيفهم لاحقاً.
        </p>
      </DialogContent>
    </Dialog>
  );
}
