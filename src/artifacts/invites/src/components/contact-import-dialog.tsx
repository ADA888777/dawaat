import { useRef, useState } from "react";
import Papa from "papaparse";
import {
  BookUser,
  ClipboardPaste,
  Download,
  FileUp,
  Keyboard,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ContactImportError,
  dedupeContacts,
  getContactPickerSupport,
  isValidContactPhone,
  normalizeContactPhone,
  parseContactLines,
  parseVCards,
  pickContacts,
  readTextFile,
  type PickedContact,
} from "@/lib/contact-picker";

interface ContactImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** الحد الأقصى للدفعة الواحدة */
  maxRows: number;
  isSaving: boolean;
  /** يُسلّم القائمة النهائية للأب ليحفظها */
  onImport: (contacts: PickedContact[]) => void;
}

function pickColumn(row: Record<string, string>, keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim() !== "") return value;
  }
  return "";
}

function downloadCsvTemplate() {
  const content = "\ufeffname,phone\nسعود العتيبي,0501234567\nنورة القحطاني,+966502345678\n";
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "dawaat-guests-template.csv";
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * نافذة إضافة المدعوين بكل الطرق المتاحة فعلاً على أي جهاز.
 *
 * القاعدة المطبّقة هنا: لا تُعطّل الأزرار ولا تُكتب "غير متاح" وحدها.
 * إن لم يدعم الجهاز قراءة جهات الاتصال (iPhone والكمبيوتر) يُفتح
 * مباشرةً تبويب البديل العملي مع شرح خطواته.
 */
export function ContactImportDialog({
  open,
  onOpenChange,
  maxRows,
  isSaving,
  onImport,
}: ContactImportDialogProps) {
  const support = getContactPickerSupport();
  const [tab, setTab] = useState(support.supported ? "device" : "vcard");
  const [staged, setStaged] = useState<PickedContact[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [pasteText, setPasteText] = useState("");
  const [manualName, setManualName] = useState("");
  const [manualPhone, setManualPhone] = useState("");

  const vcfInputRef = useRef<HTMLInputElement>(null);
  const csvInputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setStaged([]);
    setNotice(null);
    setError(null);
    setPasteText("");
    setManualName("");
    setManualPhone("");
    setTab(support.supported ? "device" : "vcard");
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const addContacts = (list: PickedContact[], sourceLabel: string) => {
    const merged = dedupeContacts([...staged, ...list]);
    const added = merged.length - staged.length;
    setStaged(merged);
    setError(null);
    setNotice(
      added === 0
        ? `لم يُضف أي رقم جديد من ${sourceLabel} — الأرقام مكررة أو غير صالحة`
        : `تمت إضافة ${added} من ${sourceLabel} إلى القائمة بالأسفل`,
    );
  };

  const handleDevicePicker = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const picked = await pickContacts();
      if (picked.length === 0) {
        setNotice("لم تختر أي جهة اتصال");
        return;
      }
      addContacts(picked, "جهات اتصال الجهاز");
    } catch (err) {
      setError(
        err instanceof ContactImportError
          ? err.message
          : "تعذر فتح جهات الاتصال. استخدم أحد البدائل بالأسفل.",
      );
      // البديل يُفتح تلقائياً بدل ترك المستخدم أمام رسالة خطأ فقط
      setTab("vcard");
    } finally {
      setBusy(false);
    }
  };

  const handleVcardFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (vcfInputRef.current) vcfInputRef.current.value = "";
    if (!file) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const parsed = parseVCards(await readTextFile(file));
      if (parsed.length === 0) {
        setError("لم نجد أي جهة اتصال لها رقم جوال داخل الملف.");
        return;
      }
      addContacts(parsed, "ملف جهات الاتصال");
    } catch {
      setError("تعذر قراءة الملف. تأكد أنه ملف ‎.vcf‎ صالح.");
    } finally {
      setBusy(false);
    }
  };

  const handleCsvFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (csvInputRef.current) csvInputRef.current.value = "";
    if (!file) return;
    setBusy(true);
    setError(null);
    setNotice(null);

    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      error: () => {
        setBusy(false);
        setError("تعذر قراءة ملف CSV. تأكد أنه ملف صالح.");
      },
      complete: (results) => {
        setBusy(false);
        const parsed = dedupeContacts(
          results.data
            .map((row) => ({
              name: pickColumn(row, ["name", "Name", "الاسم", "اسم"]),
              phone: normalizeContactPhone(
                pickColumn(row, [
                  "phone",
                  "Phone",
                  "mobile",
                  "Mobile",
                  "رقم الجوال",
                  "الجوال",
                  "جوال",
                  "الرقم",
                ]),
              ),
            }))
            .filter((row) => isValidContactPhone(row.phone)),
        );
        if (parsed.length === 0) {
          setError(
            "لم نجد أرقاماً صالحة. تأكد من وجود عمودَي name و phone (أو الاسم ورقم الجوال).",
          );
          return;
        }
        addContacts(parsed, "ملف CSV");
      },
    });
  };

  const handlePasteList = () => {
    const parsed = parseContactLines(pasteText);
    if (parsed.length === 0) {
      setError(
        "لم نجد أرقاماً صالحة. اكتب كل مدعو في سطر مستقل، مثل: سعود العتيبي 0501234567",
      );
      return;
    }
    addContacts(parsed, "القائمة الملصقة");
    setPasteText("");
  };

  const handleManualAdd = () => {
    const phone = normalizeContactPhone(manualPhone);
    if (!isValidContactPhone(phone)) {
      setError("رقم الجوال غير صالح. مثال: 0501234567 أو ‎+966501234567‎");
      return;
    }
    addContacts([{ name: manualName.trim() || phone, phone }], "الإدخال اليدوي");
    setManualName("");
    setManualPhone("");
  };

  const removeStaged = (phone: string) =>
    setStaged((prev) => prev.filter((c) => c.phone !== phone));

  const tooMany = staged.length > maxRows;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent dir="rtl" className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>إضافة مدعوين</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-gray-600">
          اختر الطريقة المناسبة لجهازك. كل الطرق تستورد الاسم ورقم الجوال ثم تضيفهم
          إلى قائمة المدعوين.
        </p>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="device" className="gap-1 px-1 text-[11px] sm:text-xs">
              <BookUser className="hidden h-4 w-4 sm:inline-block" /> جهات الاتصال
            </TabsTrigger>
            <TabsTrigger value="vcard" className="gap-1 px-1 text-[11px] sm:text-xs">
              <FileUp className="hidden h-4 w-4 sm:inline-block" /> ملف
            </TabsTrigger>
            <TabsTrigger value="paste" className="gap-1 px-1 text-[11px] sm:text-xs">
              <ClipboardPaste className="hidden h-4 w-4 sm:inline-block" /> لصق قائمة
            </TabsTrigger>
            <TabsTrigger value="manual" className="gap-1 px-1 text-[11px] sm:text-xs">
              <Keyboard className="hidden h-4 w-4 sm:inline-block" /> يدوي
            </TabsTrigger>
          </TabsList>

          {/* ① جهات اتصال الجهاز — تعمل على أندرويد Chrome/Edge */}
          <TabsContent value="device" className="space-y-3 pt-4">
            <Button
              type="button"
              onClick={handleDevicePicker}
              disabled={busy}
              className="w-full bg-ink text-gold-light hover:bg-ink-soft"
            >
              {busy ? (
                <Loader2 className="ml-2 h-4 w-4 animate-spin" />
              ) : (
                <BookUser className="ml-2 h-4 w-4" />
              )}
              فتح جهات اتصال الجهاز
            </Button>

            {support.supported ? (
              <p className="text-center text-xs text-gray-600">
                يمكنك اختيار شخص واحد أو عدة أشخاص دفعة واحدة، ثم سيظهرون في القائمة بالأسفل
                للمراجعة قبل الحفظ.
              </p>
            ) : (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-800">
                {support.reason}
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setTab("vcard")}
                    className="rounded-md bg-white px-2 py-1 font-medium text-amber-900 underline"
                  >
                    استيراد ملف جهات اتصال أو CSV
                  </button>
                  <button
                    type="button"
                    onClick={() => setTab("manual")}
                    className="rounded-md bg-white px-2 py-1 font-medium text-amber-900 underline"
                  >
                    إضافة الرقم يدوياً
                  </button>
                </div>
              </div>
            )}
          </TabsContent>

          {/* ② ملف vCard أو CSV — الطريق العملي على iPhone وعلى الكمبيوتر */}
          <TabsContent value="vcard" className="space-y-4 pt-4">
            <div className="space-y-3 rounded-lg border border-gray-200 p-4">
              <h3 className="text-sm font-semibold text-gray-900">
                ملف جهات الاتصال ‎(.vcf)‎
              </h3>
              <ol className="list-decimal space-y-1 pr-4 text-xs leading-relaxed text-gray-600">
                <li>
                  على iPhone: «جهات الاتصال» ← اختر الشخص ← «مشاركة جهة الاتصال» ←
                  «حفظ في الملفات».
                </li>
                <li>
                  لعدة أشخاص: من «جهات الاتصال» اضغط «تحديد» ← اختر الأشخاص ← «مشاركة» —
                  يخرج ملف واحد يحتوي الجميع.
                </li>
                <li>على أندرويد: «جهات الاتصال» ← «تصدير» ← ملف ‎.vcf‎.</li>
                <li>ثم اختر الملف من هنا وسيُستورد الجميع دفعة واحدة.</li>
              </ol>
              <input
                ref={vcfInputRef}
                type="file"
                accept=".vcf,.vcard,text/vcard,text/x-vcard"
                className="hidden"
                onChange={handleVcardFile}
              />
              <Button
                type="button"
                variant="outline"
                className="w-full border-gray-200"
                onClick={() => vcfInputRef.current?.click()}
                disabled={busy}
              >
                <FileUp className="ml-2 h-4 w-4" /> اختيار ملف ‎.vcf‎
              </Button>
            </div>

            <div className="space-y-3 rounded-lg border border-gray-200 p-4">
              <h3 className="text-sm font-semibold text-gray-900">ملف CSV</h3>
              <p className="text-xs leading-relaxed text-gray-600">
                عمودان فقط: name و phone (ويُقبل أيضاً «الاسم» و«رقم الجوال»).
              </p>
              <input
                ref={csvInputRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={handleCsvFile}
              />
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1 border-gray-200"
                  onClick={() => csvInputRef.current?.click()}
                  disabled={busy}
                >
                  <FileUp className="ml-2 h-4 w-4" /> اختيار ملف CSV
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="text-xs"
                  onClick={downloadCsvTemplate}
                >
                  <Download className="ml-1 h-4 w-4" /> نموذج جاهز
                </Button>
              </div>
            </div>
          </TabsContent>

          {/* ③ لصق قائمة — يعمل في أي مكان بلا أي إذن */}
          <TabsContent value="paste" className="space-y-3 pt-4">
            <Label className="text-sm">الصق كل مدعو في سطر (الاسم ثم الرقم)</Label>
            <Textarea
              dir="rtl"
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              className="h-40 resize-none font-sans"
              placeholder={"سعود العتيبي 0501234567\nنورة القحطاني، +966502345678\n0503456789"}
            />
            <p className="text-xs text-gray-600">
              نقبل الفاصلة أو المسافة أو Tab، والأرقام العربية ‎٠٥٠…‎ تُحوَّل تلقائياً.
            </p>
            <Button
              type="button"
              variant="outline"
              className="w-full border-gray-200"
              onClick={handlePasteList}
              disabled={busy || pasteText.trim() === ""}
            >
              <ClipboardPaste className="ml-2 h-4 w-4" /> قراءة القائمة
            </Button>
          </TabsContent>

          {/* ④ إدخال يدوي */}
          <TabsContent value="manual" className="space-y-3 pt-4">
            <div>
              <Label className="mb-1 block text-sm">الاسم</Label>
              <Input
                value={manualName}
                onChange={(e) => setManualName(e.target.value)}
                placeholder="سعود العتيبي"
              />
            </div>
            <div>
              <Label className="mb-1 block text-sm">رقم الجوال</Label>
              <Input
                value={manualPhone}
                onChange={(e) => setManualPhone(e.target.value)}
                dir="ltr"
                inputMode="tel"
                className="text-right"
                placeholder="0501234567"
              />
            </div>
            <Button
              type="button"
              variant="outline"
              className="w-full border-gray-200"
              onClick={handleManualAdd}
              disabled={busy}
            >
              <Plus className="ml-2 h-4 w-4" /> إضافة إلى القائمة
            </Button>
          </TabsContent>
        </Tabs>

        {error && (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {error}
          </div>
        )}
        {notice && !error && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            {notice}
          </div>
        )}

        {/* قائمة المراجعة قبل الحفظ — لا يُحفظ أحد بلا موافقة صاحب الدعوة */}
        <div className="rounded-lg border border-gray-200">
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2">
            <span className="text-sm font-semibold text-gray-900">
              جاهزون للإضافة ({staged.length})
            </span>
            {staged.length > 0 && (
              <button
                type="button"
                onClick={() => setStaged([])}
                className="text-xs text-red-600 underline"
              >
                تفريغ القائمة
              </button>
            )}
          </div>

          {staged.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-gray-600">
              لم تُضف أي جهة اتصال بعد.
            </p>
          ) : (
            <ul className="max-h-56 divide-y divide-gray-100 overflow-y-auto">
              {staged.map((contact) => (
                <li
                  key={contact.phone}
                  className="flex items-center justify-between gap-3 px-4 py-2 text-sm"
                >
                  <span className="truncate font-medium text-gray-900">{contact.name}</span>
                  <span className="shrink-0 text-gray-600" dir="ltr">
                    {contact.phone}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeStaged(contact.phone)}
                    className="shrink-0 text-red-500"
                    title="إزالة"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {tooMany && (
          <p role="alert" className="text-sm text-red-700">
            الحد الأقصى {maxRows} مدعو في الدفعة الواحدة. أزل بعض الأسماء ثم أعد المحاولة.
          </p>
        )}

        <Button
          type="button"
          className="h-12 w-full bg-gold font-bold text-black hover:bg-gold/90"
          disabled={staged.length === 0 || tooMany || isSaving}
          onClick={() => onImport(staged)}
        >
          {isSaving && <Loader2 className="ml-2 h-4 w-4 animate-spin" />}
          إضافة {staged.length > 0 ? staged.length : ""} إلى قائمة المدعوين
        </Button>
      </DialogContent>
    </Dialog>
  );
}
