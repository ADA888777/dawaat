import { useEffect, useMemo, useRef, useState } from "react";
import {
  BookUser,
  CheckCheck,
  ClipboardPaste,
  Contact,
  Download,
  FileSpreadsheet,
  Info,
  Loader2,
  Plus,
  Search,
  Trash2,
  UserPlus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { formatPhoneForDisplay, isSaudiMobile } from "@/lib/phone";

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

type Method = "device" | "vcf" | "csv" | "manual" | "paste";

const VCF_ACCEPT = ".vcf,.vcard,text/vcard,text/x-vcard,text/directory";
const CSV_ACCEPT = ".csv,.txt,text/csv,text/plain,application/vnd.ms-excel";

function downloadCsvTemplate() {
  const content =
    "﻿name,phone\nسعود العتيبي,0501234567\nنورة القحطاني,+966502345678\n";
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "dawaat-guests-template.csv";
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * نافذة «جهات الاتصال»: اختيار/استيراد ← مراجعة وتحديد ← إضافة للمدعوين.
 *
 * - المتصفح الذي يدعم Contact Picker (أندرويد Chrome/Edge غالباً) يفتح
 *   جهات الاتصال مباشرة، مع إبقاء البدائل ظاهرة تحته.
 * - غير الداعم (iPhone Safari وكل متصفحات الكمبيوتر) لا يرى رسالة خطأ،
 *   بل يرى مباشرة: استيراد ملف VCF، استيراد CSV، إضافة يدوية.
 * - كل الطرق تنتهي بنفس قائمة المراجعة: أرقام موحّدة (+9665…) بلا تكرار،
 *   وتحديد الكل أو أشخاص معينين قبل الحفظ.
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
  const fileAccept = (fallback: string) =>
    contactFileAccept(support.platform) === undefined ? undefined : fallback;

  const [method, setMethod] = useState<Method | null>(null);
  const [staged, setStaged] = useState<StagedRow[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [filter, setFilter] = useState("");

  const [pasteText, setPasteText] = useState("");
  const [manualName, setManualName] = useState("");
  const [manualPhone, setManualPhone] = useState("");

  const vcfInputRef = useRef<HTMLInputElement>(null);
  const csvInputRef = useRef<HTMLInputElement>(null);
  const reviewRef = useRef<HTMLDivElement>(null);

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
        // المدعو مسبقاً يُعرض لكن لا يُحدَّد تلقائياً حتى لا يُضاف مرتين
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
    setFilter("");
    setDragging(false);

    if (rows.length > 0) {
      const dup = rows.filter((row) => row.alreadyInvited).length;
      setNotice(
        "قرأنا " +
          rows.length +
          " جهة اتصال من جهازك" +
          (dup > 0 ? " — " + dup + " منهم مدعوون مسبقاً وتُركوا بلا تحديد" : ""),
      );
      setMethod("device");
      return;
    }

    setNotice(initialMessage ?? null);
    // على الآيفون نعرض خطوات ملف VCF مباشرة لأنها الطريقة العملية الوحيدة
    setMethod(support.supported ? null : isIos ? "vcf" : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialContacts, initialMessage]);

  const scrollToReview = () =>
    window.setTimeout(
      () => reviewRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }),
      50,
    );

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
    const duplicatesInSource = list.length - added;
    const invitedBefore = rows.filter((row) => row.alreadyInvited).length;

    setStaged(rows);
    setError(null);

    // علامة RLM بعد الأسماء اللاتينية (VCF/CSV) تمنع انقلاب ترتيب الأرقام في النص العربي
    const label = sourceLabel + "\u200F";
    const messages: string[] = [
      added === 0
        ? "كل الأرقام في " + label + " موجودة في القائمة مسبقاً"
        : "قرأنا " + added + " جهة اتصال من " + label,
    ];
    if (added > 0 && duplicatesInSource > 0) {
      messages.push("حذفنا المكرر: " + duplicatesInSource);
    }
    if (invitedBefore > 0) {
      messages.push("مدعوون مسبقاً (بلا تحديد): " + invitedBefore);
    }
    setNotice(messages.join("\u200F — "));
    scrollToReview();
  };

  const handleDevicePicker = async () => {
    setMethod("device");
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const picked = await pickContacts();
      if (picked.length === 0) {
        setNotice("لم تختر أي جهة اتصال — أعد المحاولة أو استخدم طريقة أخرى");
        return;
      }
      addContacts(picked, "جهات اتصال الجهاز");
    } catch (err) {
      setError(
        err instanceof ContactImportError
          ? err.message
          : "تعذر فتح جهات الاتصال. استخدم استيراد ملف VCF أو CSV.",
      );
      setMethod("vcf");
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
            " بصيغة VCF، أو CSV فيه عمود للاسم وعمود لرقم الجوال.",
        );
        return;
      }
      const label =
        parsed.kind === "vcard"
          ? "ملف VCF"
          : parsed.kind === "csv"
            ? "ملف CSV"
            : "الملف";
      addContacts(parsed.contacts, label);
    } catch {
      setError("تعذر قراءة الملف. تأكد أنه ملف جهات اتصال VCF أو ملف CSV.");
    } finally {
      setBusy(false);
    }
  };

  const onFileInput = (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.target;
    void handleFiles(input.files).finally(() => {
      input.value = "";
    });
  };

  const chooseFileMethod = (next: "vcf" | "csv") => {
    setMethod(next);
    setError(null);
    // على الآيفون نترك المستخدم يقرأ خطوات تصدير VCF أولاً
    if (next === "vcf" && isIos) return;
    (next === "vcf" ? vcfInputRef : csvInputRef).current?.click();
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

  const visibleRows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return staged;
    const digits = q.replace(/\D/g, "");
    return staged.filter(
      (row) =>
        row.name.toLowerCase().includes(q) ||
        (digits.length >= 3 && row.phone.replace(/\D/g, "").includes(digits)),
    );
  }, [staged, filter]);

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

  const optionCard = (
    value: Method,
    icon: React.ReactNode,
    title: string,
    hint: string,
    onClick: () => void,
    recommended = false,
  ) => (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      data-method={value}
      aria-pressed={method === value}
      className={
        "relative flex flex-col items-center gap-1 rounded-xl border-2 px-2 py-3 text-center transition-colors disabled:opacity-60 " +
        (method === value
          ? "border-gold bg-gold/10"
          : "border-line bg-white hover:border-gold/60")
      }
    >
      {recommended && (
        <span className="absolute -top-2 rounded-full bg-gold px-2 text-[10px] font-bold text-black">
          الأنسب لجهازك
        </span>
      )}
      <span className="text-gold-deep">{icon}</span>
      <span className="text-sm font-bold text-gray-900">{title}</span>
      <span className="text-[11px] leading-snug text-gray-600">{hint}</span>
    </button>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        dir="rtl"
        className="max-h-[92vh] max-w-2xl overflow-y-auto"
      >
        <DialogHeader className="text-right sm:text-right">
          <DialogTitle>إضافة مدعوين من جهات الاتصال</DialogTitle>
          <DialogDescription className="text-right">
            ١ اختر أو استورد جهات الاتصال ← ٢ حدّد من تريد ← ٣ أضفهم إلى قائمة
            المدعوين
          </DialogDescription>
        </DialogHeader>

        {/* مدخلات الملفات مخفية — تُفتح من البطاقات والأزرار */}
        <input
          ref={vcfInputRef}
          type="file"
          multiple
          accept={fileAccept(VCF_ACCEPT)}
          className="hidden"
          data-testid="vcf-input"
          onChange={onFileInput}
        />
        <input
          ref={csvInputRef}
          type="file"
          multiple
          accept={fileAccept(CSV_ACCEPT)}
          className="hidden"
          data-testid="csv-input"
          onChange={onFileInput}
        />

        {/* ① الاختيار أو الاستيراد */}
        <section className="space-y-3">
          {support.supported ? (
            <>
              <Button
                type="button"
                onClick={() => void handleDevicePicker()}
                disabled={busy}
                className="h-auto w-full flex-col gap-0.5 bg-ink py-3 text-gold-light hover:bg-ink-soft"
              >
                <span className="flex items-center gap-2 text-base font-bold">
                  {busy && method === "device" ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <BookUser className="h-5 w-5" />
                  )}
                  فتح جهات الاتصال
                </span>
                <span className="text-xs font-normal opacity-80">
                  اختر شخصاً أو عدة أشخاص من جهازك
                </span>
              </Button>
              <p className="text-center text-xs text-gray-500">
                أو استورد بطريقة أخرى
              </p>
            </>
          ) : (
            <div className="flex items-start gap-2 rounded-lg border border-line bg-cream-2 px-3 py-2">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-gold-deep" />
              <p className="text-xs leading-relaxed text-gray-700">
                {isIos
                  ? "على الآيفون لا يسمح المتصفح بفتح جهات الاتصال من المواقع، لذلك استورد ملف VCF من تطبيق جهات الاتصال — يأخذ دقيقة واحدة."
                  : "هذا المتصفح لا يتيح فتح جهات الاتصال مباشرة. اختر إحدى الطرق التالية — كلها تعمل على جهازك."}
              </p>
            </div>
          )}

          <div className="grid grid-cols-3 gap-2 pt-1">
            {optionCard(
              "vcf",
              <Contact className="h-6 w-6" />,
              "استيراد ملف VCF",
              "ملف جهات الاتصال من الجوال",
              () => chooseFileMethod("vcf"),
              !support.supported && support.platform !== "desktop",
            )}
            {optionCard(
              "csv",
              <FileSpreadsheet className="h-6 w-6" />,
              "استيراد CSV",
              "من Excel أو Google",
              () => chooseFileMethod("csv"),
            )}
            {optionCard(
              "manual",
              <UserPlus className="h-6 w-6" />,
              "إضافة يدوية",
              "اكتب الاسم والرقم",
              () => {
                setMethod("manual");
                setError(null);
              },
            )}
          </div>

          <button
            type="button"
            onClick={() => {
              setMethod("paste");
              setError(null);
            }}
            className="mx-auto flex items-center gap-1 text-xs text-gold-deep underline"
          >
            <ClipboardPaste className="h-3.5 w-3.5" /> أو الصق قائمة أسماء وأرقام
          </button>

          {/* تفاصيل الطريقة المختارة */}
          {method === "vcf" && (
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
                "space-y-3 rounded-lg border-2 border-dashed p-4 " +
                (dragging ? "border-gold bg-gold/5" : "border-line bg-cream-2")
              }
            >
              <h3 className="text-sm font-semibold text-gray-900">
                {isIos ? "تصدير جهات الاتصال من الآيفون" : "ملف VCF"}
              </h3>
              {isIos ? (
                <ol className="list-decimal space-y-1 pr-4 text-xs leading-relaxed text-gray-700">
                  <li>افتح تطبيق «جهات الاتصال».</li>
                  <li>
                    لعدة أشخاص: اضغط «قوائم» ← اضغط مطولاً على «كل جهات الاتصال»
                    أو قائمة ← «تصدير» — يخرج ملف واحد فيه الجميع.
                  </li>
                  <li>لشخص واحد: افتحه ← «مشاركة جهة الاتصال».</li>
                  <li>اختر «حفظ في الملفات».</li>
                  <li>ارجع هنا واضغط الزر بالأسفل واختر الملف.</li>
                </ol>
              ) : (
                <ul className="list-disc space-y-1 pr-4 text-xs leading-relaxed text-gray-700">
                  <li>أندرويد: «جهات الاتصال» ← «إعدادات» ← «تصدير» ← ملف ‎.vcf‎.</li>
                  <li>الآيفون: «جهات الاتصال» ← «قوائم» ← «تصدير» ← «حفظ في الملفات».</li>
                  <li>Google Contacts: «تصدير» ← vCard.</li>
                  <li>على الكمبيوتر يمكنك سحب الملف وإفلاته هنا.</li>
                </ul>
              )}
              <Button
                type="button"
                className="w-full bg-ink text-gold-light hover:bg-ink-soft"
                onClick={() => vcfInputRef.current?.click()}
                disabled={busy}
              >
                {busy ? (
                  <Loader2 className="ml-2 h-4 w-4 animate-spin" />
                ) : (
                  <Contact className="ml-2 h-4 w-4" />
                )}
                اختيار ملف VCF
              </Button>
            </div>
          )}

          {method === "csv" && (
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
                "space-y-3 rounded-lg border-2 border-dashed p-4 " +
                (dragging ? "border-gold bg-gold/5" : "border-line bg-cream-2")
              }
            >
              <p className="text-xs leading-relaxed text-gray-700">
                ملف فيه عمود للاسم وعمود لرقم الجوال (بالعربي أو الإنجليزي). نقبل
                تصدير Google Contacts و Outlook و Excel، والأرقام بأي صيغة.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  className="flex-1 bg-ink text-gold-light hover:bg-ink-soft"
                  onClick={() => csvInputRef.current?.click()}
                  disabled={busy}
                >
                  {busy ? (
                    <Loader2 className="ml-2 h-4 w-4 animate-spin" />
                  ) : (
                    <FileSpreadsheet className="ml-2 h-4 w-4" />
                  )}
                  اختيار ملف CSV
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="border-line text-xs"
                  onClick={downloadCsvTemplate}
                >
                  <Download className="ml-1 h-4 w-4" /> نموذج جاهز
                </Button>
              </div>
            </div>
          )}

          {method === "manual" && (
            <form
              className="grid gap-2 rounded-lg border border-line p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
              onSubmit={(event) => {
                event.preventDefault();
                handleManualAdd();
              }}
            >
              <div>
                <Label className="mb-1 block text-xs">الاسم</Label>
                <Input
                  value={manualName}
                  onChange={(event) => setManualName(event.target.value)}
                  placeholder="سعود العتيبي"
                />
              </div>
              <div>
                <Label className="mb-1 block text-xs">رقم الجوال</Label>
                <Input
                  value={manualPhone}
                  onChange={(event) => setManualPhone(event.target.value)}
                  dir="ltr"
                  inputMode="tel"
                  className="text-right"
                  placeholder="05XXXXXXXX"
                />
              </div>
              <Button
                type="submit"
                variant="outline"
                className="border-line"
                disabled={busy || manualPhone.trim() === ""}
              >
                <Plus className="ml-1 h-4 w-4" /> إضافة
              </Button>
            </form>
          )}

          {method === "paste" && (
            <div className="space-y-2 rounded-lg border border-line p-4">
              <Label className="text-xs">كل مدعو في سطر (الاسم ثم الرقم)</Label>
              <Textarea
                dir="rtl"
                value={pasteText}
                onChange={(event) => setPasteText(event.target.value)}
                className="h-32 resize-none font-sans"
                placeholder={
                  "سعود العتيبي 0501234567\nنورة القحطاني، +966502345678\n0503456789"
                }
              />
              <Button
                type="button"
                variant="outline"
                className="w-full border-line"
                onClick={handlePasteList}
                disabled={busy || pasteText.trim() === ""}
              >
                <ClipboardPaste className="ml-2 h-4 w-4" /> قراءة القائمة
              </Button>
            </div>
          )}
        </section>

        {error && (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm leading-relaxed text-red-700"
          >
            {error}
          </div>
        )}
        {notice && !error && (
          <div
            role="status"
            className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm leading-relaxed text-emerald-700"
          >
            {notice}
          </div>
        )}

        {/* ② المراجعة والتحديد */}
        <div ref={reviewRef} className="rounded-lg border border-line">
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
              <span className="text-xs text-gray-600" data-testid="selected-count">
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

          {staged.length > 8 && (
            <div className="relative border-b border-line px-4 py-2">
              <Search className="absolute right-6 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder="بحث في القائمة..."
                className="h-8 pr-8 text-sm"
              />
            </div>
          )}

          {staged.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-gray-600">
              لم تُضف أي جهة اتصال بعد — اختر طريقة من الأعلى.
            </p>
          ) : (
            <ul
              className="max-h-64 divide-y divide-line overflow-y-auto"
              data-testid="staged-list"
            >
              {visibleRows.map((row) => (
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
                    {row.alreadyInvited ? (
                      <span className="text-[11px] text-amber-700">
                        مدعو مسبقاً في هذه المناسبة
                      </span>
                    ) : !isSaudiMobile(row.phone) ? (
                      <span className="text-[11px] text-gray-500">رقم دولي</span>
                    ) : null}
                  </div>
                  <span className="shrink-0 text-gray-600" dir="ltr">
                    {formatPhoneForDisplay(row.phone)}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeRow(row.key)}
                    className="shrink-0 text-red-500"
                    title="إزالة من القائمة"
                    aria-label={"إزالة " + row.name}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
              {visibleRows.length === 0 && (
                <li className="px-4 py-4 text-center text-xs text-gray-500">
                  لا نتائج للبحث
                </li>
              )}
            </ul>
          )}
        </div>

        {tooMany && (
          <p role="alert" className="text-sm text-red-700">
            الحد الأقصى {maxRows} مدعو في الدفعة الواحدة. ألغِ تحديد بعض الأسماء
            ثم أعد المحاولة.
          </p>
        )}

        {/* ③ الإضافة */}
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
