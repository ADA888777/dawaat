import { appUrl } from "@/lib/supabase";
import { useMemo, useState } from "react";
import { AppLayout } from "@/components/layout/app-layout";
import {
  useGetEvent,
  useListGuests,
  useUpdateGuest,
  useDeleteGuest,
  useBulkCreateGuests,
  useMarkInviteStatus,
  MAX_IMPORT_ROWS,
  phoneMatchKey,
  toWesternDigits,
  type Guest,
} from "@/lib/api";
import { useParams, Link } from "wouter";
import {
  Loader2,
  Plus,
  Trash2,
  Edit,
  Search,
  ChevronRight,
  Eye,
  MessageCircle,
  Send,
  QrCode as QrIcon,
  Copy,
  Check,
  Download,
  Info,
  CheckSquare,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ContactImportDialog } from "@/components/contact-import-dialog";
import { QrCode, useQrDataUrl } from "@/components/qr-code";
import {
  buildGuestInviteUrl,
  buildInviteMessage,
  buildPublicInviteUrl,
  buildWhatsAppUrl,
  getGuestDisplayStatus,
  GUEST_STATUS_CLASSES,
  GUEST_STATUS_LABELS,
  GUEST_STATUS_ORDER,
  statusSelectionToUpdate,
  type GuestDisplayStatus,
} from "@/lib/invite";
import {
  ContactImportError,
  getContactPickerSupport,
  pickContacts,
  type PickedContact,
} from "@/lib/contact-picker";

/**
 * [م-7] الأصل الصحيح لروابط الدعوات.
 * window.location.origin وحده كان يتجاهل base الخاص بـ Vite،
 * فتُرسل روابط مكسورة إذا نُشر التطبيق تحت مسار فرعي.
 */
const APP_ORIGIN = appUrl.replace(/\/$/, "");

export default function EventDetail() {
  const { id } = useParams();
  // رابط مثل /events/abc كان يُنتج NaN فيُرسل استعلاماً فاسداً
  // إلى قاعدة البيانات بدل إظهار «المناسبة غير موجودة» فوراً.
  const parsedId = Number(id);
  const eventId = Number.isInteger(parsedId) && parsedId > 0 ? parsedId : 0;
  const hasValidId = eventId > 0;
  const { data: event, isLoading: isLoadingEvent } = useGetEvent(eventId, {
    query: { enabled: hasValidId },
  });
  const { data: guests, isLoading: isLoadingGuests } = useListGuests(eventId, {
    query: { enabled: hasValidId },
  });
  const { toast } = useToast();

  const updateGuest = useUpdateGuest();
  const deleteGuest = useDeleteGuest();
  const bulkCreateGuests = useBulkCreateGuests();
  const markInviteStatus = useMarkInviteStatus();

  const [searchTerm, setSearchTerm] = useState("");
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [isImportOpen, setIsImportOpen] = useState(false);
  /** ما يعيده منتقي جهات الاتصال قبل فتح نافذة المراجعة */
  const [importSeed, setImportSeed] = useState<PickedContact[]>([]);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [isPickingContacts, setIsPickingContacts] = useState(false);
  const contactSupport = useMemo(() => getContactPickerSupport(), []);
  const [isQrOpen, setIsQrOpen] = useState(false);
  const [guestToDelete, setGuestToDelete] = useState<Guest | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // قائمة الإرسال: لقطة من المدعوين المحددين لحظة الضغط على الزر
  const [sendQueue, setSendQueue] = useState<Guest[] | null>(null);
  const [sendIndex, setSendIndex] = useState(0);
  const [openedCurrent, setOpenedCurrent] = useState(false);

  /**
   * البحث برقم الجوال يطابق كل الصيغ.
   * سابقاً كان includes نصياً بحتاً، فالبحث عن 0501234567 لا يجد
   * المدعو المخزَّن بصيغة +966501234567 وهو نفس الشخص.
   */
  const filteredGuests = useMemo(() => {
    const raw = searchTerm.trim();
    if (!raw) return guests ?? [];
    const q = toWesternDigits(raw).toLowerCase();
    const digits = q.replace(/\D/g, "");
    const key = digits.length >= 6 ? phoneMatchKey(q) : "";
    return (guests ?? []).filter((g) => {
      if (g.name.toLowerCase().includes(q)) return true;
      if (!digits) return false;
      if (g.phone.includes(digits)) return true;
      return !!key && phoneMatchKey(g.phone).includes(key);
    });
  }, [guests, searchTerm]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const visibleIds = useMemo(() => filteredGuests.map((g) => g.id), [filteredGuests]);
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((gid) => selectedSet.has(gid));
  const selectedGuests = useMemo(
    () => (guests ?? []).filter((g) => selectedSet.has(g.id)),
    [guests, selectedSet],
  );

  const toggleSelectAll = () => {
    if (allVisibleSelected) {
      setSelectedIds((prev) => prev.filter((gid) => !visibleIds.includes(gid)));
    } else {
      setSelectedIds((prev) => Array.from(new Set([...prev, ...visibleIds])));
    }
  };

  const toggleOne = (gid: number) =>
    setSelectedIds((prev) =>
      prev.includes(gid) ? prev.filter((x) => x !== gid) : [...prev, gid],
    );

  // ────────────────────────── الروابط والرسائل ──────────────────────────

  const publicInviteUrl = event ? buildPublicInviteUrl(APP_ORIGIN, event.shareSlug) : "";

  const guestInviteUrl = (guest: Guest) =>
    event ? buildGuestInviteUrl(APP_ORIGIN, event.shareSlug, guest.inviteToken) : "";

  const messageFor = (guest: Guest) =>
    buildInviteMessage({
      guestName: guest.name,
      eventTitle: event?.title ?? "",
      inviteUrl: guestInviteUrl(guest),
      eventDate: event?.eventDate,
      location: event?.location,
    });

  const copyText = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // متصفحات قديمة أو سياق غير آمن: بديل صامت حتى لا يفقد المستخدم النص
      const area = document.createElement("textarea");
      area.value = text;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    setCopiedKey(key);
    window.setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1800);
  };

  // ────────────────────────── الاستيراد ──────────────────────────

  /**
   * زر «استيراد من جهات الاتصال».
   *
   * على الأجهزة التي تدعم Contact Picker (أندرويد Chrome/Edge) يُفتح منتقي
   * جهات الاتصال فوراً من داخل معالج الضغط نفسه، لأن المتصفح يشترط تفاعلاً
   * مباشراً من المستخدم؛ ولو أُجّل النداء إلى ما بعد ظهور النافذة لرفضه.
   * وبقية الأجهزة تُفتح لها نافذة الطرق البديلة مباشرة بلا رسالة خطأ.
   */
  const openImportDialog = async () => {
    if (!contactSupport.supported) {
      setImportSeed([]);
      setImportMessage(null);
      setIsImportOpen(true);
      return;
    }

    setIsPickingContacts(true);
    try {
      const picked = await pickContacts();
      setImportSeed(picked);
      setImportMessage(
        picked.length === 0
          ? "لم تختر أي جهة اتصال — أعد المحاولة أو استخدم طريقة أخرى"
          : null,
      );
    } catch (err) {
      setImportSeed([]);
      setImportMessage(
        err instanceof ContactImportError
          ? err.message
          : "تعذر فتح جهات الاتصال. استخدم إحدى الطرق البديلة.",
      );
    } finally {
      setIsPickingContacts(false);
      setIsImportOpen(true);
    }
  };

  /** أرقام المدعوين الحاليين — تُمرَّر للنافذة لكشف المكرر قبل الحفظ */
  const guestPhones = useMemo(
    () => (guests ?? []).map((guest) => guest.phone),
    [guests],
  );

  const handleImport = (contacts: PickedContact[]) => {
    bulkCreateGuests.mutate(
      { eventId, data: { guests: contacts } },
      {
        onSuccess: (res) => {
          setIsImportOpen(false);
          setImportSeed([]);
          setImportMessage(null);
          toast({
            title: "تمت إضافة " + res.created + " مدعو",
            description:
              res.skipped > 0
                ? "تم تجاهل " + res.skipped + " (مكرر أو رقم غير صالح)"
                : undefined,
          });
        },
        onError: (err) =>
          toast({
            title: "تعذر إضافة المدعوين",
            description: err instanceof Error ? err.message : undefined,
            variant: "destructive",
          }),
      },
    );
  };

  // ────────────────────────── الحالة ──────────────────────────

  const handleStatusChange = (guest: Guest, next: GuestDisplayStatus) => {
    updateGuest.mutate(
      { id: guest.id, data: statusSelectionToUpdate(next) },
      {
        onError: (err) =>
          toast({
            title: "تعذر تحديث الحالة",
            description: err instanceof Error ? err.message : undefined,
            variant: "destructive",
          }),
      },
    );
  };

  const confirmDeleteGuest = () => {
    if (!guestToDelete) return;
    const removedId = guestToDelete.id;
    deleteGuest.mutate(
      { id: removedId },
      {
        onSuccess: () => {
          setSelectedIds((prev) => prev.filter((gid) => gid !== removedId));
          setGuestToDelete(null);
          toast({ title: "تم حذف المدعو" });
        },
        onError: (err) => {
          setGuestToDelete(null);
          toast({
            title: "تعذر حذف المدعو",
            description: err instanceof Error ? err.message : undefined,
            variant: "destructive",
          });
        },
      },
    );
  };

  // ────────────────── إرسال الدعوات: التدفق الحقيقي ──────────────────
  /**
   * ما يحدث فعلياً عند الضغط على "إرسال الدعوات":
   *   1) تُسجَّل حالة "تم تجهيز الدعوة" لكل المحددين في قاعدة البيانات.
   *   2) تُفتح محادثة واتساب لكل مدعو برسالته الجاهزة، واحداً بعد الآخر.
   *   3) الضغط على زر الإرسال داخل واتساب يبقى على المستخدم — لا يستطيع أي
   *      موقع إرسال رسالة واتساب نيابةً عن صاحبه، وهذا قيد من واتساب نفسه.
   *   4) بعد تأكيد المستخدم أنه أرسل، تُسجَّل حالة "تم الإرسال".
   *
   * الإرسال التلقائي الجماعي بلا فتح أي محادثة يحتاج
   * WhatsApp Business Platform (Cloud API) وهو تكامل من الخادم بقوالب
   * معتمدة، ولم يُزيَّف هنا كزر وهمي داخل الواجهة.
   */
  const startSending = () => {
    if (selectedGuests.length === 0) {
      toast({ title: "اختر مدعوّاً واحداً على الأقل" });
      return;
    }
    markInviteStatus.mutate(
      {
        eventId,
        guestIds: selectedGuests.map((g) => g.id),
        status: "prepared",
      },
      { onError: () => toast({ title: "تعذر تسجيل حالة التجهيز", variant: "destructive" }) },
    );
    setSendQueue(selectedGuests);
    setSendIndex(0);
    setOpenedCurrent(false);
  };

  const currentSendGuest =
    sendQueue && sendIndex < sendQueue.length ? sendQueue[sendIndex] : null;

  const closeSendQueue = () => {
    setSendQueue(null);
    setSendIndex(0);
    setOpenedCurrent(false);
  };

  const advanceQueue = () => {
    if (!sendQueue) return;
    const next = sendIndex + 1;
    if (next >= sendQueue.length) {
      toast({ title: "انتهت قائمة الإرسال (" + sendQueue.length + " مدعو)" });
      closeSendQueue();
      return;
    }
    setSendIndex(next);
    setOpenedCurrent(false);
  };

  const openWhatsAppFor = (guest: Guest) => {
    window.open(buildWhatsAppUrl(guest.phone, messageFor(guest)), "_blank", "noopener");
    setOpenedCurrent(true);
  };

  const markSentAndNext = () => {
    if (!currentSendGuest) return;
    markInviteStatus.mutate({
      eventId,
      guestIds: [currentSendGuest.id],
      status: "sent",
    });
    advanceQueue();
  };

  /** إرسال لمدعو واحد من صف الجدول: يفتح واتساب ويسجّل "تم تجهيز الدعوة" */
  const sendSingle = (guest: Guest) => {
    markInviteStatus.mutate({ eventId, guestIds: [guest.id], status: "prepared" });
    window.open(buildWhatsAppUrl(guest.phone, messageFor(guest)), "_blank", "noopener");
  };

  const qr = useQrDataUrl(publicInviteUrl, 640);

  if (isLoadingEvent) {
    return (
      <AppLayout>
        <div className="flex justify-center py-32">
          <Loader2 className="h-8 w-8 animate-spin text-gold" />
        </div>
      </AppLayout>
    );
  }

  if (!event) {
    return (
      <AppLayout>
        <div className="p-10 text-center">المناسبة غير موجودة</div>
      </AppLayout>
    );
  }

  const awaitingSend = (guests ?? []).filter(
    (g) => getGuestDisplayStatus(g, event.eventDate) === "pending",
  ).length;

  return (
    <AppLayout>
      <div className="mx-auto max-w-7xl space-y-6 p-6 md:p-10">
        <Link
          href="/events"
          className="inline-flex items-center gap-1 text-sm font-medium text-gray-600 hover:text-gray-900"
        >
          <ChevronRight className="h-4 w-4" /> العودة للدعوات
        </Link>

        <div className="flex flex-col items-start gap-4 rounded-xl border border-gray-100 bg-white p-6 shadow-sm md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="mb-2 text-3xl font-bold text-gray-900">{event.title}</h1>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-600">
              <span>المدعوين: {event.guestsCount}</span>
              <span className="text-gray-500">بانتظار الإرسال: {awaitingSend}</span>
              <span className="text-indigo-600">تم الإرسال: {event.sentCount}</span>
              <span className="text-emerald-600">مؤكد: {event.attendingCount}</span>
              <span className="text-red-500">معتذر: {event.declinedCount}</span>
              <span className="text-orange-500">محتمل: {event.maybeCount}</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              className="border-gray-200"
              onClick={() => setIsQrOpen(true)}
            >
              <QrIcon className="ml-2 h-4 w-4" /> رمز QR والرابط
            </Button>
            <Button
              variant="outline"
              className="border-gray-200"
              onClick={() => window.open(publicInviteUrl, "_blank", "noopener")}
            >
              <Eye className="ml-2 h-4 w-4" /> معاينة الدعوة
            </Button>
            <Link href={"/events/" + event.id + "/edit"}>
              <Button className="bg-ink text-gold-light hover:bg-ink-soft">
                <Edit className="ml-2 h-4 w-4" /> تعديل المناسبة
              </Button>
            </Link>
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
          <div className="flex flex-col gap-4 border-b border-gray-100 p-6 md:flex-row md:items-center md:justify-between">
            <div className="relative max-w-md flex-1">
              <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                placeholder="البحث عن مدعو بالاسم أو الجوال..."
                className="pl-4 pr-10"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                className="border-gray-200"
                onClick={toggleSelectAll}
                disabled={visibleIds.length === 0}
              >
                <CheckSquare className="ml-2 h-4 w-4" />
                {allVisibleSelected ? "إلغاء تحديد الكل" : "تحديد الكل"}
              </Button>
              <Button
                onClick={startSending}
                disabled={selectedIds.length === 0}
                className="bg-green-600 font-medium text-white hover:bg-green-700"
              >
                <Send className="ml-2 h-4 w-4" />
                إرسال الدعوات
                {selectedIds.length > 0 ? " (" + selectedIds.length + ")" : ""}
              </Button>
              <Button
                onClick={() => void openImportDialog()}
                disabled={isPickingContacts}
                className="bg-gold font-medium text-black hover:bg-gold/90"
                title={
                  contactSupport.supported
                    ? "يفتح جهات اتصال جهازك لاختيار المدعوين"
                    : "استيراد من ملف جهات الاتصال أو CSV أو لصق قائمة"
                }
              >
                {isPickingContacts ? (
                  <Loader2 className="ml-2 h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="ml-2 h-4 w-4" />
                )}
                استيراد من جهات الاتصال
              </Button>
            </div>
          </div>

          {selectedIds.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 bg-gold/5 px-6 py-3 text-sm">
              <span className="font-medium text-gray-800">
                محدد: {selectedIds.length} مدعو
              </span>
              <button
                type="button"
                onClick={() => setSelectedIds([])}
                className="text-xs text-gray-600 underline"
              >
                إلغاء التحديد
              </button>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead className="bg-gray-50 font-medium text-gray-600">
                <tr>
                  <th className="w-12 px-4 py-4">
                    <Checkbox
                      checked={allVisibleSelected}
                      onCheckedChange={toggleSelectAll}
                      aria-label="تحديد الكل"
                    />
                  </th>
                  <th className="px-6 py-4">الاسم</th>
                  <th className="px-6 py-4">رقم الجوال</th>
                  <th className="px-6 py-4">الحالة</th>
                  <th className="w-32 px-6 py-4">إجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {isLoadingGuests ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-10 text-center">
                      <Loader2 className="mx-auto h-6 w-6 animate-spin text-gray-400" />
                    </td>
                  </tr>
                ) : filteredGuests.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-10 text-center text-gray-600">
                      لا يوجد مدعوين — ابدأ بزر «استيراد من جهات الاتصال»
                    </td>
                  </tr>
                ) : (
                  filteredGuests.map((guest) => {
                    const status = getGuestDisplayStatus(guest, event.eventDate);
                    const isSelected = selectedSet.has(guest.id);
                    return (
                      <tr
                        key={guest.id}
                        className={isSelected ? "bg-gold/5" : "hover:bg-gray-50/50"}
                      >
                        <td className="px-4 py-4">
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => toggleOne(guest.id)}
                            aria-label={"تحديد " + guest.name}
                          />
                        </td>
                        <td className="px-6 py-4 font-medium text-gray-900">
                          {guest.name}
                        </td>
                        <td className="px-6 py-4 text-gray-600" dir="ltr">
                          {guest.phone}
                        </td>
                        <td className="px-6 py-4">
                          <Select
                            value={status}
                            onValueChange={(val) =>
                              handleStatusChange(guest, val as GuestDisplayStatus)
                            }
                          >
                            <SelectTrigger
                              className={
                                "h-8 w-40 text-xs font-medium " +
                                GUEST_STATUS_CLASSES[status]
                              }
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent dir="rtl">
                              {GUEST_STATUS_ORDER.map((option) => (
                                <SelectItem key={option} value={option}>
                                  {GUEST_STATUS_LABELS[option]}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => sendSingle(guest)}
                              className="h-8 w-8 text-green-600 hover:bg-green-50 hover:text-green-700"
                              title="فتح واتساب برسالة الدعوة جاهزة"
                            >
                              <MessageCircle className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() =>
                                copyText(guestInviteUrl(guest), "link-" + guest.id)
                              }
                              className="h-8 w-8 text-gray-500 hover:bg-gray-100"
                              title="نسخ رابط الدعوة الخاص بهذا المدعو"
                            >
                              {copiedKey === "link-" + guest.id ? (
                                <Check className="h-4 w-4 text-emerald-600" />
                              ) : (
                                <Copy className="h-4 w-4" />
                              )}
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setGuestToDelete(guest)}
                              className="h-8 w-8 text-red-500 hover:bg-red-50 hover:text-red-700"
                              title="حذف المدعو"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* رمز QR ورابط الدعوة العام */}
      <Dialog open={isQrOpen} onOpenChange={setIsQrOpen}>
        <DialogContent dir="rtl" className="max-w-md">
          <DialogHeader>
            <DialogTitle>رمز QR ورابط الدعوة</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col items-center gap-4">
            <QrCode value={publicInviteUrl} size={200} />
            <p className="break-all text-center text-xs text-gray-600" dir="ltr">
              {publicInviteUrl}
            </p>
            <div className="flex w-full flex-wrap gap-2">
              <Button
                variant="outline"
                className="flex-1 border-gray-200"
                onClick={() => copyText(publicInviteUrl, "public-link")}
              >
                {copiedKey === "public-link" ? (
                  <Check className="ml-2 h-4 w-4 text-emerald-600" />
                ) : (
                  <Copy className="ml-2 h-4 w-4" />
                )}
                نسخ الرابط
              </Button>
              {qr.dataUrl && (
                <a
                  href={qr.dataUrl}
                  download={"dawaat-qr-" + event.shareSlug + ".png"}
                  className="flex-1"
                >
                  <Button variant="outline" className="w-full border-gray-200">
                    <Download className="ml-2 h-4 w-4" /> تنزيل الصورة
                  </Button>
                </a>
              )}
            </div>
            <p className="text-center text-xs text-gray-500">
              نفس الرمز يظهر داخل صفحة الدعوة، يمسحه المدعو فتُفتح الدعوة مباشرة.
            </p>
          </div>
        </DialogContent>
      </Dialog>

      {/* قائمة الإرسال المتسلسل */}
      <Dialog
        open={currentSendGuest !== null}
        onOpenChange={(open) => !open && closeSendQueue()}
      >
        <DialogContent dir="rtl" className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              إرسال الدعوات — {sendIndex + 1} من {sendQueue ? sendQueue.length : 0}
            </DialogTitle>
          </DialogHeader>

          {currentSendGuest && (
            <div className="space-y-4">
              <div className="rounded-lg border border-gray-200 p-4">
                <p className="text-sm font-semibold text-gray-900">
                  {currentSendGuest.name}
                </p>
                <p className="text-sm text-gray-600" dir="ltr">
                  {currentSendGuest.phone}
                </p>
              </div>

              <div>
                <p className="mb-1 text-xs font-medium text-gray-600">الرسالة الجاهزة</p>
                <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs leading-relaxed text-gray-800">{messageFor(currentSendGuest)}</pre>
              </div>

              <div className="flex items-start gap-2 rounded-lg border border-sky-200 bg-sky-50 p-3 text-xs leading-relaxed text-sky-900">
                <Info className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  الموقع يفتح محادثة واتساب والرسالة مكتوبة مسبقاً، والضغط على زر
                  الإرسال داخل واتساب يبقى عليك — لا يستطيع أي موقع إرسال رسالة واتساب
                  نيابةً عنك. الإرسال التلقائي الجماعي بلا فتح المحادثات يحتاج
                  WhatsApp Business Platform (Cloud API) من الخادم بقوالب معتمدة.
                </span>
              </div>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Button
                  onClick={() => openWhatsAppFor(currentSendGuest)}
                  className="bg-green-600 text-white hover:bg-green-700"
                >
                  <MessageCircle className="ml-2 h-4 w-4" /> فتح واتساب
                </Button>
                <Button
                  variant="outline"
                  className="border-gray-200"
                  onClick={() =>
                    copyText(messageFor(currentSendGuest), "msg-" + currentSendGuest.id)
                  }
                >
                  {copiedKey === "msg-" + currentSendGuest.id ? (
                    <Check className="ml-2 h-4 w-4 text-emerald-600" />
                  ) : (
                    <Copy className="ml-2 h-4 w-4" />
                  )}
                  نسخ الرسالة
                </Button>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 pt-3">
                <button
                  type="button"
                  onClick={advanceQueue}
                  className="text-sm text-gray-600 underline"
                >
                  تخطي هذا المدعو
                </button>
                <Button
                  onClick={markSentAndNext}
                  disabled={!openedCurrent}
                  title={openedCurrent ? undefined : "افتح واتساب أولاً"}
                  className="bg-ink text-gold-light hover:bg-ink-soft"
                >
                  <Check className="ml-2 h-4 w-4" /> أرسلتها — التالي
                </Button>
              </div>

              <p className="text-center text-xs text-gray-500">
                حالة «تم تجهيز الدعوة» سُجّلت لكل المحددين، وحالة «تم الإرسال» تُسجَّل
                لهذا المدعو بعد تأكيدك فقط.
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ContactImportDialog
        open={isImportOpen}
        onOpenChange={setIsImportOpen}
        maxRows={MAX_IMPORT_ROWS}
        isSaving={bulkCreateGuests.isPending}
        existingPhones={guestPhones}
        initialContacts={importSeed}
        initialMessage={importMessage}
        onImport={handleImport}
      />

      <ConfirmDialog
        open={guestToDelete !== null}
        onOpenChange={(open) => !open && setGuestToDelete(null)}
        title="حذف المدعو"
        description={
          guestToDelete
            ? "سيتم حذف " + guestToDelete.name + " وردّه نهائياً."
            : undefined
        }
        confirmLabel="حذف"
        destructive
        isPending={deleteGuest.isPending}
        onConfirm={confirmDeleteGuest}
      />
    </AppLayout>
  );
}
