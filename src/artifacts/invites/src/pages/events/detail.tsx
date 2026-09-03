import { appUrl } from "@/lib/supabase";
import { useState, useRef } from "react";
import { AppLayout } from "@/components/layout/app-layout";
import {
  useGetEvent, useListGuests, useCreateGuest, useUpdateGuest,
  useDeleteGuest, useBulkCreateGuests, MAX_IMPORT_ROWS, type Guest,
} from "@/lib/api";
import { useParams, Link } from "wouter";
import { Loader2, Plus, Upload, Trash2, Edit, Check, X, Search, ChevronRight, Download, Eye, BookUser, MessageCircle, Send } from "lucide-react";
import { isContactPickerSupported, pickContacts } from "@/lib/contact-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useQueryClient } from "@tanstack/react-query";
import { getListGuestsQueryKey, getGetEventQueryKey } from "@/lib/api";
import Papa from "papaparse";
import { useToast } from "@/hooks/use-toast";
import { ConfirmDialog } from "@/components/confirm-dialog";

/**
 * [م-7] الأصل الصحيح لروابط الدعوات.
 * window.location.origin وحده كان يتجاهل base الخاص بـ Vite،
 * فتُرسل روابط مكسورة إذا نُشر التطبيق تحت مسار فرعي.
 */
/**
 * [ن-8] تحويل الرقم المحلي إلى صيغة واتساب الدولية.
 * الافتراض الافتراضي هو السعودية (966) لأنه سوق التطبيق الأساسي؛
 * الأرقام المكتوبة بصيغة دولية (+xx) تُترك كما هي.
 */
const DEFAULT_COUNTRY_CODE = "966";

function toWhatsAppNumber(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (raw.trim().startsWith("+")) return digits;      // دولي صريح
  if (digits.startsWith("00")) return digits.slice(2); // بادئة 00 الدولية
  if (digits.startsWith(DEFAULT_COUNTRY_CODE)) return digits;
  if (digits.startsWith("0")) return DEFAULT_COUNTRY_CODE + digits.slice(1);
  return DEFAULT_COUNTRY_CODE + digits;
}

const APP_ORIGIN =
  appUrl.replace(/\/$/, "");

export default function EventDetail() {
  const { id } = useParams();
  const eventId = Number(id);
  const { data: event, isLoading: isLoadingEvent } = useGetEvent(eventId);
  const { data: guests, isLoading: isLoadingGuests } = useListGuests(eventId);
  const [searchTerm, setSearchTerm] = useState("");

  const queryClient = useQueryClient();
  
  const createGuest = useCreateGuest();
  const updateGuest = useUpdateGuest();
  const deleteGuest = useDeleteGuest();
  const bulkCreateGuests = useBulkCreateGuests();

  const [isAddGuestOpen, setIsAddGuestOpen] = useState(false);
  const [newGuestName, setNewGuestName] = useState("");
  const [newGuestPhone, setNewGuestPhone] = useState("");
  const [isPickingContacts, setIsPickingContacts] = useState(false);
  const [sendAllIndex, setSendAllIndex] = useState<number | null>(null);
  const contactPickerSupported = isContactPickerSupported();
  const { toast } = useToast();

  const handlePickFromContacts = async () => {
    setIsPickingContacts(true);
    try {
      const picked = await pickContacts();
      if (picked.length === 0) return; // user cancelled or no usable entries

      if (picked.length === 1) {
        // Single contact: prefill the manual fields so the user can review/edit.
        setNewGuestName(picked[0].name);
        setNewGuestPhone(picked[0].phone);
        return;
      }

      // Multiple contacts: add them all to the guest list directly.
      bulkCreateGuests.mutate({ eventId, data: { guests: picked } }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListGuestsQueryKey(eventId) });
          queryClient.invalidateQueries({ queryKey: getGetEventQueryKey(eventId) });
          setIsAddGuestOpen(false);
          setNewGuestName("");
          setNewGuestPhone("");
          toast({ title: `تمت إضافة ${picked.length} مدعوين من جهات الاتصال` });
        },
        onError: () => {
          toast({ title: "تعذر إضافة المدعوين، حاول مرة أخرى", variant: "destructive" });
        },
      });
    } catch {
      toast({
        title: "تعذر فتح جهات الاتصال",
        description: "متصفحك لا يدعم هذه الميزة أو تم رفض الإذن. يمكنك الإدخال اليدوي أو استيراد CSV.",
        variant: "destructive",
      });
    } finally {
      setIsPickingContacts(false);
    }
  };

  const handleAddGuest = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newGuestName || !newGuestPhone) return;
    createGuest.mutate({ eventId, data: { name: newGuestName, phone: newGuestPhone } }, {
      onSuccess: () => {
        setIsAddGuestOpen(false);
        setNewGuestName("");
        setNewGuestPhone("");
        queryClient.invalidateQueries({ queryKey: getListGuestsQueryKey(eventId) });
        queryClient.invalidateQueries({ queryKey: getGetEventQueryKey(eventId) });
      }
    });
  };

  const handleStatusChange = (guestId: number, status: 'pending' | 'attending' | 'maybe' | 'declined') => {
    updateGuest.mutate({ id: guestId, data: { attendanceStatus: status } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListGuestsQueryKey(eventId) });
        queryClient.invalidateQueries({ queryKey: getGetEventQueryKey(eventId) });
      }
    });
  };

  const sendWhatsApp = (guest: Guest) => {
    sendWhatsAppDirect(guest);
  };

  // [ن-1] حوار داخل التطبيق بدل confirm() المتوقف عن العمل بمظهر المتصفح
  const [guestToDelete, setGuestToDelete] = useState<Guest | null>(null);

  const handleDeleteGuest = (guest: Guest) => setGuestToDelete(guest);

  const confirmDeleteGuest = () => {
    if (!guestToDelete) return;
    deleteGuest.mutate({ id: guestToDelete.id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListGuestsQueryKey(eventId) });
        queryClient.invalidateQueries({ queryKey: getGetEventQueryKey(eventId) });
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
    });
  };

  const fileInputRef = useRef<HTMLInputElement>(null);

  /**
   * [م-8] استيراد CSV محكوم:
   * سقف لعدد الصفوف، وتحقق من الأرقام، وإبلاغ صريح بعدد المرفوض،
   * وإشعارات بدل alert(). سابقاً كان الملف يُقرأ كاملاً بلا حد.
   */
  const handleBulkImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      error: () => {
        toast({ title: "تعذر قراءة الملف", description: "تأكد أنه ملف CSV صالح", variant: "destructive" });
      },
      complete: (results) => {
        const parsedGuests = results.data
          .map((row) => ({
            name: row.name || row["الاسم"] || row["Name"] || "",
            phone: row.phone || row["رقم الجوال"] || row["Phone"] || "",
          }))
          .filter((g) => g.name.trim() && g.phone.trim());

        if (parsedGuests.length === 0) {
          toast({
            title: "لم يتم العثور على بيانات صالحة",
            description: "تأكد من وجود عمودي Name و Phone في الملف",
            variant: "destructive",
          });
          return;
        }

        if (parsedGuests.length > MAX_IMPORT_ROWS) {
          toast({
            title: "الملف كبير جداً",
            description: `الحد الأقصى ${MAX_IMPORT_ROWS} مدعو في الاستيراد الواحد (الملف يحوي ${parsedGuests.length})`,
            variant: "destructive",
          });
          return;
        }

        bulkCreateGuests.mutate(
          { eventId, data: { guests: parsedGuests } },
          {
            onSuccess: (res) => {
              queryClient.invalidateQueries({ queryKey: getListGuestsQueryKey(eventId) });
              queryClient.invalidateQueries({ queryKey: getGetEventQueryKey(eventId) });
              toast({
                title: `تم استيراد ${res.created} مدعو`,
                description: res.skipped > 0
                  ? `تم تجاهل ${res.skipped} صفاً (مكرر أو رقم غير صالح)`
                  : undefined,
              });
            },
            onError: (err) => {
              toast({
                title: "فشل الاستيراد",
                description: err instanceof Error ? err.message : undefined,
                variant: "destructive",
              });
            },
          }
        );
      },
    });
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // [ع-4] إرسال متسلسل حقيقي.
  // سابقاً كان sendAllIndex يُكتب ولا يُقرأ في أي مكان، فكان الزر
  // يفتح واتساب للمدعو الأول فقط رغم أن اسمه يعد بإرسال للجميع.
  const pendingGuests = (guests ?? []).filter((g) => g.attendanceStatus === "pending");

  const handleSendAll = () => {
    if (pendingGuests.length === 0) {
      toast({ title: "لا يوجد مدعوون بانتظار الرد" });
      return;
    }
    setSendAllIndex(0);
    sendWhatsAppDirect(pendingGuests[0]);
  };

  const handleSendNext = () => {
    if (sendAllIndex === null) return;
    const next = sendAllIndex + 1;
    if (next >= pendingGuests.length) {
      setSendAllIndex(null);
      toast({ title: `اكتمل إرسال الدعوات إلى ${pendingGuests.length} مدعو` });
      return;
    }
    setSendAllIndex(next);
    sendWhatsAppDirect(pendingGuests[next]);
  };

  /**
   * [ح-2] الرابط يحمل رمز الدعوة الشخصي فقط.
   * سابقاً كان يحمل ?phone= و ?name= بنص صريح — أي أن تمرير الرسالة
   * كان يكشف رقم المدعو ويتيح لأي شخص الرد بالنيابة عنه.
   */
  const sendWhatsAppDirect = (guest: Guest) => {
    const waNumber = toWhatsAppNumber(guest.phone);
    const inviteUrl = `${APP_ORIGIN}/invite/${event?.shareSlug}?t=${guest.inviteToken}`;
    const msg = `السلام عليكم ${guest.name}\nيسعدنا دعوتك لحضور ${event?.title}\nرابط الدعوة: ${inviteUrl}`;
    window.open(`https://wa.me/${waNumber}?text=${encodeURIComponent(msg)}`, "_blank", "noopener");
  };

  if (isLoadingEvent) {
    return (
      <AppLayout>
        <div className="flex justify-center py-32"><Loader2 className="w-8 h-8 animate-spin text-gold" /></div>
      </AppLayout>
    );
  }

  if (!event) return <AppLayout><div className="p-10 text-center">المناسبة غير موجودة</div></AppLayout>;

  const filteredGuests = guests?.filter(g => 
    g.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    g.phone.includes(searchTerm)
  ) || [];

  return (
    <AppLayout>
      <div className="p-6 md:p-10 max-w-7xl mx-auto space-y-6">
        <Link href="/events" className="text-gray-600 hover:text-gray-900 inline-flex items-center gap-1 text-sm font-medium">
          <ChevronRight className="w-4 h-4" /> العودة للدعوات
        </Link>
        
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-6 rounded-xl border border-gray-100 shadow-sm">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">{event.title}</h1>
            <div className="flex gap-4 text-sm text-gray-600">
              <span>المدعوين: {event.guestsCount}</span>
              <span className="text-emerald-600">مؤكد: {event.attendingCount}</span>
              <span className="text-red-500">معتذر: {event.declinedCount}</span>
              <span className="text-orange-500">محتمل: {event.maybeCount}</span>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => window.open(`/invite/${event.shareSlug}`, '_blank')} className="border-gray-200">
              <Eye className="w-4 h-4 mr-2" /> معاينة الدعوة
            </Button>
            <Link href={`/events/${event.id}/edit`}>
              <Button className="bg-ink text-gold-light hover:bg-ink-soft">
                <Edit className="w-4 h-4 mr-2" /> تعديل المناسبة
              </Button>
            </Link>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="p-6 border-b border-gray-100 flex flex-col md:flex-row justify-between gap-4">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
              <Input 
                placeholder="البحث عن مدعو بالاسم أو الجوال..." 
                className="pl-4 pr-10"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              {/* زر إرسال الدعوة للجميع */}
              {(guests ?? []).filter(g => g.attendanceStatus === 'pending').length > 0 && (
                <Button
                  onClick={handleSendAll}
                  className="bg-green-600 hover:bg-green-700 text-white font-medium"
                >
                  <Send className="w-4 h-4 ml-2" />
                  إرسال للجميع ({(guests ?? []).filter(g => g.attendanceStatus === 'pending').length})
                </Button>
              )}
              <input type="file" accept=".csv" className="hidden" ref={fileInputRef} onChange={handleBulkImport} />
              <Button variant="outline" className="border-gray-200" onClick={() => fileInputRef.current?.click()} disabled={bulkCreateGuests.isPending}>
                {bulkCreateGuests.isPending ? <Loader2 className="w-4 h-4 ml-2 animate-spin" /> : <Upload className="w-4 h-4 ml-2" />}
                استيراد CSV
              </Button>
              <Dialog open={isAddGuestOpen} onOpenChange={setIsAddGuestOpen}>
                <DialogTrigger asChild>
                  <Button className="bg-gold text-black hover:bg-gold/90 font-medium">
                    <Plus className="w-4 h-4 ml-2" /> إضافة مدعو
                  </Button>
                </DialogTrigger>
                <DialogContent dir="rtl">
                  <DialogHeader>
                    <DialogTitle>إضافة مدعو جديد</DialogTitle>
                  </DialogHeader>
                  <form onSubmit={handleAddGuest} className="space-y-4 py-4">
                    <div>
                      <label className="text-sm font-medium mb-1 block">الاسم</label>
                      <Input value={newGuestName} onChange={e => setNewGuestName(e.target.value)} required />
                    </div>
                    <div>
                      <label className="text-sm font-medium mb-1 block">رقم الجوال</label>
                      <Input value={newGuestPhone} onChange={e => setNewGuestPhone(e.target.value)} required dir="ltr" className="text-right" />
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="h-px flex-1 bg-gray-200" />
                      <span className="text-xs text-gray-400">أو</span>
                      <div className="h-px flex-1 bg-gray-200" />
                    </div>

                    <div>
                      <Button
                        type="button"
                        variant="outline"
                        className="w-full border-gold/40 text-gold-deep hover:bg-gold/10"
                        onClick={handlePickFromContacts}
                        disabled={!contactPickerSupported || isPickingContacts || bulkCreateGuests.isPending}
                      >
                        {isPickingContacts || bulkCreateGuests.isPending ? (
                          <Loader2 className="w-4 h-4 ml-2 animate-spin" />
                        ) : (
                          <BookUser className="w-4 h-4 ml-2" />
                        )}
                        استيراد من جهات الاتصال
                      </Button>
                      <p className="text-xs text-gray-400 mt-2 text-center">
                        {contactPickerSupported
                          ? "يمكنك اختيار شخص واحد أو عدة أشخاص دفعة واحدة"
                          : "غير متاح في هذا المتصفح — متوفر غالباً في كروم على أندرويد"}
                      </p>
                    </div>

                    <DialogFooter className="mt-6">
                      <Button type="submit" disabled={createGuest.isPending} className="bg-ink text-gold-light hover:bg-ink-soft w-full">
                        {createGuest.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'إضافة'}
                      </Button>
                    </DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead className="bg-gray-50 text-gray-600 font-medium">
                <tr>
                  <th className="px-6 py-4">الاسم</th>
                  <th className="px-6 py-4">رقم الجوال</th>
                  <th className="px-6 py-4">حالة الحضور</th>
                  <th className="px-6 py-4 w-24">إجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {isLoadingGuests ? (
                  <tr><td colSpan={4} className="px-6 py-10 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-gray-400" /></td></tr>
                ) : filteredGuests.length === 0 ? (
                  <tr><td colSpan={4} className="px-6 py-10 text-center text-gray-600">لا يوجد مدعوين</td></tr>
                ) : (
                  filteredGuests.map(guest => (
                    <tr key={guest.id} className="hover:bg-gray-50/50">
                      <td className="px-6 py-4 font-medium text-gray-900">{guest.name}</td>
                      <td className="px-6 py-4 text-gray-600" dir="ltr">{guest.phone}</td>
                      <td className="px-6 py-4">
                        <Select 
                          value={guest.attendanceStatus} 
                          onValueChange={(val: any) => handleStatusChange(guest.id, val)}
                        >
                          <SelectTrigger className={`h-8 text-xs font-medium w-32 ${
                            guest.attendanceStatus === 'attending' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                            guest.attendanceStatus === 'declined' ? 'bg-red-50 text-red-700 border-red-200' :
                            guest.attendanceStatus === 'maybe' ? 'bg-orange-50 text-orange-700 border-orange-200' :
                            'bg-gray-50 text-gray-700 border-gray-200'
                          }`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent dir="rtl">
                            <SelectItem value="pending">بانتظار الرد</SelectItem>
                            <SelectItem value="attending">مؤكد</SelectItem>
                            <SelectItem value="maybe">محتمل</SelectItem>
                            <SelectItem value="declined">معتذر</SelectItem>
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-1">
                          <Button variant="ghost" size="icon" onClick={() => sendWhatsApp(guest)} className="text-green-600 hover:text-green-700 hover:bg-green-50 h-8 w-8" title="إرسال الدعوة عبر واتساب">
                            <MessageCircle className="w-4 h-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => handleDeleteGuest(guest)} className="text-red-500 hover:text-red-700 hover:bg-red-50 h-8 w-8" title="حذف المدعو">
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* [ع-4] شريط التقدّم في الإرسال المتسلسل — يظهر فقط أثناء الإرسال */}
      {sendAllIndex !== null && (
        <div className="fixed bottom-0 inset-x-0 z-50 bg-white border-t border-gray-200 shadow-lg p-4">
          <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
            <p className="text-sm text-gray-700">
              تم فتح واتساب للمدعو {sendAllIndex + 1} من {pendingGuests.length}
              {pendingGuests[sendAllIndex] ? ` — ${pendingGuests[sendAllIndex].name}` : ""}
            </p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setSendAllIndex(null)}>
                إيقاف
              </Button>
              <Button onClick={handleSendNext} className="bg-green-600 hover:bg-green-700 text-white">
                {sendAllIndex + 1 >= pendingGuests.length ? "إنهاء" : "المدعو التالي"}
              </Button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={guestToDelete !== null}
        onOpenChange={(open) => !open && setGuestToDelete(null)}
        title="حذف المدعو"
        description={guestToDelete ? `سيتم حذف "${guestToDelete.name}" وردّه نهائياً.` : undefined}
        confirmLabel="حذف"
        destructive
        isPending={deleteGuest.isPending}
        onConfirm={confirmDeleteGuest}
      />
    </AppLayout>
  );
}
