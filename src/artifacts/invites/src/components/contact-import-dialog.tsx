import { useEffect, useMemo, useRef, useState } from "react";
import {
  BookUser,
  CheckCheck,
  ClipboardPaste,
  Download,
  FileUp,
  Keyboard,
  Loader2,
  Plus,
  Smartphone,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
  contactFileAccept,
  contactPhoneKey,
  getContactPickerSupport,
  isValidContactPhone,
  mergeContacts,
  normalizeContactPhone,
  parseContactFiles,
  parseContactLines,
  pickContacts,
  type PickedContact,
} from "@/lib/contact-picker";

interface ContactImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** الحد الأقصى للدفعة الواحدة */
  maxRows: number;
  isSaving: boolean;
  /** أرقام المدعوين الحاليين — لكشف المكرر قبل الحفظ لا بعده */
  existingPhones?: string[];
  /** جهات اتصال جاءت من منتقي الجهاز قبل فتح النافذة */
  initialContacts?: PickedContact[];
  /** نتيجة محاولة فتح جهات الاتصال قبل فتح النافذة */
  initialMessage?: string | null;
  /** يُسلّم المحددين فقط للأب ليحفظهم */
  onImport: (contacts: PickedContact[]) => void;
}

/** صف في قائمة المراجعة: جهة اتصال + حالة تحديدها */
interface StagedRow extends PickedContact {
  key: string;
  selected: boolean;
  alreadyInvited: boolean;
}

function downloadCsvTemplate() {
  const content =
    "\ufeffname,phone\nسعود العتيبي,0501234567\nنورة القحطاني,+966502345678\n";
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "dawaat-guests-template.csv";
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * نافذة إضافة المدعوين بكل الطرق التي تعمل فعلاً على أي جهاز.
 *
 * القاعدة المطبّقة: لكل جهاز طريق يعمل، ولا يُترك المستخدم أمام رسالة
 * «غير مدعوم» وحدها. أندرويد يفتح جهات الاتصال مباشرة، والآيفون يستورد
 * ملف vCard، والكمبيوتر يستورد vCard أو CSV، والجميع يملك اللصق والإدخال
 * اليدوي. وبعد أي طريقة تُعرض القائمة للمراجعة والتحديد قبل الحفظ.
 */
export function ContactImportDialog({
  open,
  onOpenChange,
  maxRows,
  isSaving,
  existingPhones,
  initialContacts,
  initialMessage,
  onImport,
}: ContactImportDialogProps) {
  const support = useMemo(() => getContactPickerSupport(), []);
  const isIos = support.platform === "ios";

  const [tab, setTab] = useState(support.supported ? "device" : "file");
  const [staged, setStaged] = useState<StagedRow[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);

  const [pasteText, setPasteText] = useState("");
  const [manualName, setManualName] = useState("");
  const [manualPhone, setManualPhone] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);

  /** مفاتيح المدعوين الحاليين بصيغة موحّدة */
  const knownKeys = useMemo(() => {
    const set = new Set<string>();
    for (const phone of existingPhones ?? []) {
      const key = contactPhoneKey(phone);
      if (key) set.add(key);
    }
    return set;
  }, [existingPhones]);

  const buildRows = (
    contacts: PickedContact[],
    previous: Map<string, StagedRow>,
  ): StagedRow[] =>
    contacts.map((contact) => {
      const key = contactPhoneKey(contact.phone);
      const before = previous.get(key);
      const alreadyInvited = knownKeys.has(key);
      return {
        ...contact,
        key,
        alreadyInvited,
        // المكرر يُعرض لكن لا يُحدَّد تلقائياً حتى لا يُضاف مرتين
        selected: before ? before.selected : !alreadyInvited,
      };
    });

  // كل فتح للنافذة يبدأ من حالة نظيفة، مع بذرة منتقي الجهاز إن وُجدت
  useEffect(() => {
    if (!open) return;
    const seed = mergeContacts([], initialContacts ?? []);
    const rows = buildRows(seed, new Map());
    setStaged(rows);
    setError(null);
    setPasteText("");
    setManualName("");
    setManualPhone("");
    setDragging(false);

    if (rows.length > 0) {
      const dup = rows.filter((row) => row.alreadyInvited).length;
      setNotice(
        "قرأنا " +
          rows.length +
          " جهة اتصال من جهازك" +
          (dup > 0 ? " — " + dup + " منهم مدعوون مسبقاً وتُركوا بلا تحديد" : ""),
      );
      setTab("device");
      return;
    }

    setNotice(initialMessage ?? null);
    setTab(support.supported ? "device" : "file");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialContacts, initialMessage]);

  const addContacts = (list: PickedContact[], sourceLabel: string) => {
    if (list.length === 0) {
      setError("لم نجد أي رقم جوال صالح في " + sourceLabel + ".");
      return;
    }

    const previous = new Map(staged.map((row) => [row.key, row]));
    const merged = mergeContacts(
      staged.map((row) => ({ name: row.name, phone: row.phone })),
      list,
    );
    const rows = buildRows(merged, previous);
    const added = rows.length - staged.length;
    const invitedBefore = rows.filter((row) => row.alreadyInvited).length;

    setStaged(rows);
    setError(null);

    const messages: string[] = [
      added === 0
        ? "كل الأرقام في " + sourceLabel + " موجودة في القائمة مسبقاً"
        : "أضفنا " + added + " من " + sourceLabel,
    ];
    if (invitedBefore > 0) {
      messages.push(invitedBefore + " منهم مدعوون مسبقاً وتُركوا بلا تحديد");
    }
    setNotice(messages.join(" — "));
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
          : "تعذر فتح جهات الاتصال. استخدم استيراد الملف بالأسفل.",
      );
      // البديل يُفتح تلقائياً بدل ترك المستخدم أمام رسالة خطأ فقط
      setTab("file");
    } finally {
      setBusy(false);
    }
  };

  const handleFiles = async (fileList: FileList | null) => {
    const files = Array.from(fileList ?? []);
    if (files.length === 0) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const parsed = await parseContactFiles(files);
      if (parsed.contacts.length === 0) {
        setError(
          "لم نجد جهة اتصال لها رقم جوال في الملف. المقبول: ملف جهات اتصال" +
            " بصيغة vcf، أو CSV فيه عمود للاسم وعمود لرقم الجوال.",
        );
        return;
      }
      const label =
        parsed.kind === "vcard"
          ? "ملف جهات الاتصال"
          : parsed.kind === "csv"
            ? "ملف CSV"
            : "الملف النصي";
      addContacts(parsed.contacts, label);
    } catch {
      setError("تعذر قراءة الملف. تأكد أنه ملف جهات اتصال vcf أو ملف CSV.");
    } finally {
      setBusy(false);
    }
  };

  const handleFileInput = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    void handleFiles(files);
    if (fileInputRef.current) fileInputRef.current.value = "";
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
      setError("رقم الجوال غير صالح. مثال: 0501234567 أو +966501234567");
      return;
    }
    addContacts([{ name: manualName.trim() || phone, phone }], "الإدخال اليدوي");
    setManualName("");
    setManualPhone("");
  };

  // ─────────────── التحديد: الكل أو أشخاص محددون ───────────────

  const selectedRows = useMemo(
    () => staged.filter((row) => row.selected),
    [staged],
  );
  const allSelected = staged.length > 0 && selectedRows.length === staged.length;
  const freshCount = useMemo(
    () => staged.filter((row) => !row.alreadyInvited).length,
    [staged],
  );

  const toggleAll = () =>
    setStaged((prev) => prev.map((row) => ({ ...row, selected: !allSelected })));

  const toggleRow = (key: string) =>
    setStaged((prev) =>
      prev.map((row) =>
        row.key === key ? { ...row, selected: !row.selected } : row,
      ),
    );

  const selectOnlyNew = () =>
    setStaged((prev) =>
      prev.map((row) => ({ ...row, selected: !row.alreadyInvited })),
    );

  const removeRow = (key: string) =>
    setStaged((prev) => prev.filter((row) => row.key !== key));

  const tooMany = selectedRows.length > maxRows;

  const handleOpenChange = (next: boolean) => onOpenChange(next);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        dir="rtl"
        className="max-h-[92vh] max-w-2xl overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle>إضافة مدعوين</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-gray-600">
          كل الطرق تقرأ الاسم ورقم الجوال تلقائياً، ثم تختار من القائمة من
          تضيفه فعلاً.
        </p>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="device" className="gap-1 px-1 text-[11px] sm:text-xs">
              <BookUser className="hidden h-4 w-4 sm:inline-block" /> جهات الاتصال
            </TabsTrigger>
            <TabsTrigger value="file" className="gap-1 px-1 text-[11px] sm:text-xs">
              <FileUp className="hidden h-4 w-4 sm:inline-block" /> ملف
            </TabsTrigger>
            <TabsTrigger value="paste" className="gap-1 px-1 text-[11px] sm:text-xs">
              <ClipboardPaste className="hidden h-4 w-4 sm:inline-block" /> لصق قائمة
            </TabsTrigger>
            <TabsTrigger value="manual" className="gap-1 px-1 text-[11px] sm:text-xs">
              <Keyboard className="hidden h-4 w-4 sm:inline-block" /> يدوي
            </TabsTrigger>
          </TabsList>

          {/* ① جهات اتصال الجهاز — تُفتح تلقائياً على أندرويد Chrome/Edge */}
          <TabsContent value="device" className="space-y-3 pt-4">
            {support.supported ? (
              <>
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
                <p className="text-center text-xs text-gray-600">
                  تُفتح جهات الاتصال تلقائياً عند الضغط على «استيراد من جهات
                  الاتصال». اختر شخصاً أو عدة أشخاص، ثم راجعهم في القائمة
                  بالأسفل قبل الحفظ.
                </p>
              </>
            ) : (
              <div className="space-y-3 rounded-lg border border-line bg-cream-2 p-4">
                <div className="flex items-start gap-2">
                  <Smartphone className="mt-0.5 h-4 w-4 shrink-0 text-gold-deep" />
                  <p className="text-xs leading-relaxed text-gray-700">
                    {support.reason}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    className="bg-ink text-gold-light hover:bg-ink-soft"
                    onClick={() => setTab("file")}
                  >
                    <FileUp className="ml-2 h-4 w-4" />
                    {isIos ? "استيراد ملف جهات الاتصال" : "استيراد ملف vcf أو CSV"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="border-line"
                    onClick={() => setTab("paste")}
                  >
                    <ClipboardPaste className="ml-2 h-4 w-4" /> لصق قائمة
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="border-line"
                    onClick={() => setTab("manual")}
                  >
                    <Plus className="ml-2 h-4 w-4" /> إضافة يدوية
                  </Button>
                </div>
              </div>
            )}
          </TabsContent>

          {/* ② ملف واحد يقبل vCard و CSV — الطريق العملي على الآيفون والكمبيوتر */}
          <TabsContent value="file" className="space-y-4 pt-4">
            <div
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                void handleFiles(event.dataTransfer.files);
              }}
              className={
                "rounded-lg border-2 border-dashed p-5 text-center transition-colors " +
                (dragging
                  ? "border-gold bg-gold/5"
                  : "border-line bg-cream-2")
              }
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={contactFileAccept(support.platform)}
                className="hidden"
                onChange={handleFileInput}
              />
              <FileUp className="mx-auto mb-2 h-6 w-6 text-gold-deep" />
              <Button
                type="button"
                className="w-full bg-ink text-gold-light hover:bg-ink-soft sm:w-auto"
                onClick={() => fileInputRef.current?.click()}
                disabled={busy}
              >
                {busy ? (
                  <Loader2 className="ml-2 h-4 w-4 animate-spin" />
                ) : (
                  <FileUp className="ml-2 h-4 w-4" />
                )}
                اختيار ملف جهات اتصال
              </Button>
              <p className="mt-2 text-xs leading-relaxed text-gray-600">
                نقبل vcf و CSV ونتعرّف على النوع من محتوى الملف. يمكنك اختيار
                عدة ملفات معاً، وعلى الكمبيوتر يمكنك سحب الملف وإفلاته هنا.
              </p>
            </div>

            <div className="space-y-2 rounded-lg border border-line p-4">
              <h3 className="text-sm font-semibold text-gray-900">
                {isIos ? "خطوات الآيفون" : "من أين أحصل على الملف؟"}
              </h3>
              {isIos ? (
                <ol className="list-decimal space-y-1 pr-4 text-xs leading-relaxed text-gray-700">
                  <li>افتح تطبيق «جهات الاتصال».</li>
                  <li>
                    لعدة أشخاص: اضغط «قوائم» أو «تحديد» ← علّم من تريد ← «مشاركة»
                    — يخرج ملف واحد يحتوي الجميع.
                  </li>
                  <li>لشخص واحد: افتحه ← «مشاركة جهة الاتصال».</li>
                  <li>اختر «حفظ في الملفات» واحفظه في «على الآيفون».</li>
                  <li>ارجع هنا واضغط «اختيار ملف جهات اتصال» ثم اختر الملف.</li>
                </ol>
              ) : (
                <ul className="list-disc space-y-1 pr-4 text-xs leading-relaxed text-gray-700">
                  <li>أندرويد: «جهات الاتصال» ← «إعدادات» ← «تصدير» ← ملف vcf.</li>
                  <li>الآيفون: «جهات الاتصال» ← «تحديد» ← «مشاركة» ← «حفظ في الملفات».</li>
                  <li>Google Contacts: «تصدير» ← Google CSV أو vCard.</li>
                  <li>Outlook و iCloud و Excel: ملف CSV فيه الاسم ورقم الجوال.</li>
                </ul>
              )}
              <Button
                type="button"
                variant="ghost"
                className="text-xs"
                onClick={downloadCsvTemplate}
              >
                <Download className="ml-1 h-4 w-4" /> تنزيل نموذج CSV جاهز
              </Button>
            </div>
          </TabsContent>

          {/* ③ لصق قائمة — يعمل في أي مكان بلا أي إذن */}
          <TabsContent value="paste" className="space-y-3 pt-4">
            <Label className="text-sm">الصق كل مدعو في سطر (الاسم ثم الرقم)</Label>
            <Textarea
              dir="rtl"
              value={pasteText}
              onChange={(event) => setPasteText(event.target.value)}
              className="h-40 resize-none font-sans"
              placeholder={
                "سعود العتيبي 0501234567\nنورة القحطاني، +966502345678\n0503456789"
              }
            />
            <p className="text-xs text-gray-600">
              نقبل الفاصلة أو المسافة أو Tab، والأرقام العربية تُحوَّل تلقائياً.
            </p>
            <Button
              type="button"
              variant="outline"
              className="w-full border-line"
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
                onChange={(event) => setManualName(event.target.value)}
                placeholder="سعود العتيبي"
              />
            </div>
            <div>
              <Label className="mb-1 block text-sm">رقم الجوال</Label>
              <Input
                value={manualPhone}
                onChange={(event) => setManualPhone(event.target.value)}
                dir="ltr"
                inputMode="tel"
                className="text-right"
                placeholder="0501234567"
              />
            </div>
            <Button
              type="button"
              variant="outline"
              className="w-full border-line"
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
            className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm leading-relaxed text-red-700"
          >
            {error}
          </div>
        )}
        {notice && !error && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm leading-relaxed text-emerald-700">
            {notice}
          </div>
        )}

        {/* قائمة المراجعة: تحديد الكل أو أشخاص محددين قبل الحفظ */}
        <div className="rounded-lg border border-line">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2">
            <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-gray-900">
              <Checkbox
                checked={allSelected}
                onCheckedChange={toggleAll}
                disabled={staged.length === 0}
                aria-label="تحديد الكل"
              />
              تحديد الكل
            </label>

            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-600">
                محدد {selectedRows.length} من {staged.length}
              </span>
              {freshCount > 0 && freshCount < staged.length && (
                <button
                  type="button"
                  onClick={selectOnlyNew}
                  className="inline-flex items-center gap-1 text-xs text-gold-deep underline"
                >
                  <CheckCheck className="h-3.5 w-3.5" /> الجدد فقط
                </button>
              )}
              {staged.length > 0 && (
                <button
                  type="button"
                  onClick={() => setStaged([])}
                  className="text-xs text-red-600 underline"
                >
                  تفريغ
                </button>
              )}
            </div>
          </div>

          {staged.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-gray-600">
              لم تُضف أي جهة اتصال بعد — اختر طريقة من الأعلى.
            </p>
          ) : (
            <ul className="max-h-60 divide-y divide-line overflow-y-auto">
              {staged.map((row) => (
                <li
                  key={row.key}
                  className={
                    "flex items-center gap-3 px-4 py-2 text-sm " +
                    (row.selected ? "bg-gold/5" : "")
                  }
                >
                  <Checkbox
                    checked={row.selected}
                    onCheckedChange={() => toggleRow(row.key)}
                    aria-label={"تحديد " + row.name}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-gray-900">{row.name}</p>
                    {row.alreadyInvited && (
                      <span className="text-[11px] text-amber-700">
                        مدعو مسبقاً في هذه المناسبة
                      </span>
                    )}
                  </div>
                  <span className="shrink-0 text-gray-600" dir="ltr">
                    {row.phone}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeRow(row.key)}
                    className="shrink-0 text-red-500"
                    title="إزالة من القائمة"
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
            الحد الأقصى {maxRows} مدعو في الدفعة الواحدة. ألغِ تحديد بعض الأسماء
            ثم أعد المحاولة.
          </p>
        )}

        <Button
          type="button"
          className="h-12 w-full bg-gold font-bold text-black hover:bg-gold/90"
          disabled={selectedRows.length === 0 || tooMany || isSaving}
          onClick={() =>
            onImport(
              selectedRows.map((row) => ({ name: row.name, phone: row.phone })),
            )
          }
        >
          {isSaving && <Loader2 className="ml-2 h-4 w-4 animate-spin" />}
          إضافة {selectedRows.length > 0 ? selectedRows.length : ""} إلى قائمة
          المدعوين
        </Button>
      </DialogContent>
    </Dialog>
  );
}
