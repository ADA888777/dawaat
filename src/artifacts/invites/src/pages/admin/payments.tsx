import { useMemo, useState } from "react";
import { format } from "date-fns";
import { Check, ExternalLink, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  getPaymentProofUrl,
  paymentErrorMessage,
  PAYMENT_STATUS_LABELS,
  SENDING_STATUS_LABELS,
  useListAdminPayments,
  useReviewEventPayment,
  type AdminEventPayment,
  type PaymentStatus,
} from "@/lib/api";
import { formatFee } from "@/components/send-payment-dialog";

const STATUS_CLASSES: Record<PaymentStatus, string> = {
  pending: "bg-gray-100 text-gray-700",
  submitted: "bg-amber-100 text-amber-800",
  paid: "bg-emerald-100 text-emerald-800",
  rejected: "bg-red-100 text-red-800",
  cancelled: "bg-gray-100 text-gray-500",
};

type Filter = "review" | "all" | PaymentStatus;

function fmt(iso: string | null): string {
  if (!iso) return "—";
  try {
    return format(new Date(iso), "yyyy/MM/dd HH:mm");
  } catch {
    return iso;
  }
}

/**
 * تبويب «المدفوعات» في لوحة الأدمن: مراجعة إثباتات التحويل.
 * الموافقة تجعل العملية «مدفوعة» وتفتح الإرسال للمناسبة؛ الرفض يعيدها
 * للمستخدم مع السبب ليرفع إثباتاً جديداً. كلاهما عبر دالة تتحقق من
 * صلاحية الأدمن داخل قاعدة البيانات.
 */
export function AdminPayments() {
  const { toast } = useToast();
  const { data: payments, isLoading, error } = useListAdminPayments();
  const review = useReviewEventPayment();

  const [filter, setFilter] = useState<Filter>("review");
  const [search, setSearch] = useState("");
  const [rejecting, setRejecting] = useState<AdminEventPayment | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  const [openingProof, setOpeningProof] = useState<number | null>(null);

  const rows = useMemo(() => {
    const list = payments ?? [];
    const q = search.trim().toLowerCase();
    return list.filter((p) => {
      if (filter === "review" && !(p.status === "submitted" || p.status === "pending")) return false;
      if (filter !== "review" && filter !== "all" && p.status !== filter) return false;
      if (!q) return true;
      return (
        p.eventTitle.toLowerCase().includes(q) ||
        p.userName.toLowerCase().includes(q) ||
        p.userEmail.toLowerCase().includes(q) ||
        p.reference.toLowerCase().includes(q) ||
        String(p.id) === q
      );
    });
  }, [payments, filter, search]);

  const awaiting = (payments ?? []).filter((p) => p.status === "submitted").length;

  const openProof = async (p: AdminEventPayment) => {
    if (!p.proofPath) return;
    setOpeningProof(p.id);
    try {
      const url = await getPaymentProofUrl(p.proofPath);
      window.open(url, "_blank", "noopener");
    } catch (err) {
      toast({ title: "تعذر فتح الإثبات", description: paymentErrorMessage(err), variant: "destructive" });
    } finally {
      setOpeningProof(null);
    }
  };

  const approve = (p: AdminEventPayment) => {
    review.mutate(
      { paymentId: p.id, approve: true },
      {
        onSuccess: () => toast({ title: "تم تأكيد الدفع — الإرسال مفتوح للمناسبة «" + p.eventTitle + "»" }),
        onError: (err) => toast({ title: "تعذر التأكيد", description: paymentErrorMessage(err), variant: "destructive" }),
      },
    );
  };

  const confirmReject = () => {
    if (!rejecting) return;
    review.mutate(
      { paymentId: rejecting.id, approve: false, note: rejectNote.trim() },
      {
        onSuccess: () => {
          toast({ title: "تم رفض العملية وإبلاغ المستخدم بالسبب" });
          setRejecting(null);
          setRejectNote("");
        },
        onError: (err) => toast({ title: "تعذر الرفض", description: paymentErrorMessage(err), variant: "destructive" }),
      },
    );
  };

  const filters: Array<{ value: Filter; label: string }> = [
    { value: "review", label: "بانتظار المراجعة" + (awaiting > 0 ? " (" + awaiting + ")" : "") },
    { value: "paid", label: "مدفوعة" },
    { value: "rejected", label: "مرفوضة" },
    { value: "all", label: "الكل" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">مدفوعات رسوم الإرسال</h2>
          <p className="mt-1 text-sm text-gray-600">
            الموافقة تفتح إرسال الدعوات للمناسبة. تحقق من الإيصال في حسابك البنكي قبل التأكيد.
          </p>
        </div>
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="بحث بالمناسبة أو المستخدم أو رقم العملية..."
          className="max-w-xs"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {filters.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setFilter(f.value)}
            className={
              "rounded-full border px-3 py-1 text-xs font-medium " +
              (filter === f.value
                ? "border-gold bg-gold/10 text-gray-900"
                : "border-gray-200 text-gray-600 hover:border-gold/60")
            }
          >
            {f.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {paymentErrorMessage(error)}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-right text-sm">
          <thead className="bg-gray-50 font-medium text-gray-600">
            <tr>
              <th className="px-4 py-3">#</th>
              <th className="px-4 py-3">المستخدم</th>
              <th className="px-4 py-3">المناسبة</th>
              <th className="px-4 py-3">المبلغ</th>
              <th className="px-4 py-3">رقم العملية</th>
              <th className="px-4 py-3">حالة الدفع</th>
              <th className="px-4 py-3">التواريخ</th>
              <th className="px-4 py-3">حالة الإرسال</th>
              <th className="px-4 py-3">الإثبات</th>
              <th className="px-4 py-3">الإجراء</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading ? (
              <tr>
                <td colSpan={10} className="px-4 py-10 text-center">
                  <Loader2 className="mx-auto h-6 w-6 animate-spin text-gray-400" />
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-4 py-10 text-center text-gray-500">
                  لا توجد عمليات في هذا التصنيف
                </td>
              </tr>
            ) : (
              rows.map((p) => (
                <tr key={p.id} data-testid={"payment-row-" + p.id}>
                  <td className="px-4 py-3 text-gray-500">{p.id}</td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{p.userName || "—"}</p>
                    <p className="text-xs text-gray-600" dir="ltr">{p.userEmail}</p>
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{p.eventTitle}</p>
                    {p.eventDate && (
                      <p className="text-xs text-gray-600">{format(new Date(p.eventDate), "yyyy/MM/dd")}</p>
                    )}
                  </td>
                  <td className="px-4 py-3 font-bold text-gray-900">{formatFee(p.amount, p.currency)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-gray-700" dir="ltr">{p.reference || "—"}</td>
                  <td className="px-4 py-3">
                    <span className={"whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-bold " + STATUS_CLASSES[p.status]}>
                      {PAYMENT_STATUS_LABELS[p.status]}
                    </span>
                    {p.adminNote && p.status === "rejected" && (
                      <p className="mt-1 max-w-[12rem] text-xs text-red-700">{p.adminNote}</p>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs leading-relaxed text-gray-600">
                    <p>طلب: {fmt(p.createdAt)}</p>
                    <p>إثبات: {fmt(p.submittedAt)}</p>
                    <p>دفع: {fmt(p.paidAt)}</p>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-700">
                    {SENDING_STATUS_LABELS[p.sendingStatus]}
                  </td>
                  <td className="px-4 py-3">
                    {p.proofPath ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="border-gray-200 text-xs"
                        disabled={openingProof === p.id}
                        onClick={() => void openProof(p)}
                      >
                        {openingProof === p.id ? (
                          <Loader2 className="ml-1 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <ExternalLink className="ml-1 h-3.5 w-3.5" />
                        )}
                        عرض
                      </Button>
                    ) : (
                      <span className="text-xs text-gray-400">لم يُرفع</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {p.status === "submitted" || p.status === "pending" ? (
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          className="bg-emerald-600 text-xs text-white hover:bg-emerald-700"
                          disabled={review.isPending}
                          onClick={() => approve(p)}
                          title="تأكيد الدفع وفتح الإرسال"
                        >
                          <Check className="ml-1 h-3.5 w-3.5" /> تأكيد
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-red-200 text-xs text-red-600 hover:bg-red-50"
                          disabled={review.isPending}
                          onClick={() => {
                            setRejecting(p);
                            setRejectNote("");
                          }}
                        >
                          <X className="ml-1 h-3.5 w-3.5" /> رفض
                        </Button>
                      </div>
                    ) : (
                      <span className="text-xs text-gray-400">
                        {p.reviewedAt ? "رُوجعت " + fmt(p.reviewedAt) : "—"}
                      </span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={rejecting !== null} onOpenChange={(open) => !open && setRejecting(null)}>
        <DialogContent dir="rtl" className="max-w-md">
          <DialogHeader className="text-right sm:text-right">
            <DialogTitle>رفض عملية الدفع</DialogTitle>
            <DialogDescription className="text-right">
              {rejecting ? rejecting.eventTitle + " — " + formatFee(rejecting.amount, rejecting.currency) : ""}
              . سيرى المستخدم السبب ويمكنه رفع إثبات جديد.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={rejectNote}
            onChange={(event) => setRejectNote(event.target.value)}
            rows={3}
            maxLength={500}
            placeholder="مثال: لم يصل المبلغ إلى الحساب، أو الإيصال غير واضح"
          />
          <DialogFooter className="gap-2 sm:justify-start">
            <Button
              className="bg-red-600 text-white hover:bg-red-700"
              disabled={review.isPending}
              onClick={confirmReject}
            >
              {review.isPending && <Loader2 className="ml-2 h-4 w-4 animate-spin" />}
              تأكيد الرفض
            </Button>
            <Button variant="outline" className="border-gray-200" onClick={() => setRejecting(null)}>
              إلغاء
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
