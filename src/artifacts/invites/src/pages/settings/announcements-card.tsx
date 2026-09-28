import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, Loader2, Megaphone, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useToast } from "@/hooks/use-toast";
import {
  ANNOUNCEMENT_ICONS,
  ANNOUNCEMENT_ICON_LABELS,
  AUDIENCE_LABELS,
  announcementState,
  useCreateAnnouncement,
  useDeleteAnnouncement,
  useListAnnouncements,
  useReorderAnnouncements,
  useUpdateAnnouncement,
  useUpdateAppSettings,
  type Announcement,
  type AnnouncementAudience,
  type AnnouncementIcon,
  type AppSettings,
} from "@/lib/api";
import { FieldRow, SaveBar, SelectInput, SettingsCard, ToggleRow } from "./parts";

const AUDIENCE_OPTIONS = (Object.keys(AUDIENCE_LABELS) as AnnouncementAudience[]).map((value) => ({
  value,
  label: AUDIENCE_LABELS[value],
}));

const ICON_OPTIONS = ANNOUNCEMENT_ICONS.map((value) => ({
  value,
  label: ANNOUNCEMENT_ICON_LABELS[value],
}));

const INTERVAL_OPTIONS = [3, 5, 7, 10, 15].map((n) => ({
  value: String(n),
  label: n + " ثوانٍ",
}));

const STATE_LABELS = {
  live: { label: "ظاهر الآن", cls: "bg-emerald-100 text-emerald-800" },
  scheduled: { label: "مجدول", cls: "bg-blue-100 text-blue-800" },
  expired: { label: "منتهٍ", cls: "bg-gray-200 text-gray-700" },
  disabled: { label: "معطّل", cls: "bg-gray-100 text-gray-500" },
} as const;

/** ISO ↔ قيمة حقل datetime-local بالتوقيت المحلي */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

interface Draft {
  title: string;
  description: string;
  imageUrl: string;
  buttonText: string;
  buttonUrl: string;
  startsAt: string;
  endsAt: string;
  priority: string;
}

const draftOfItem = (a: Announcement): Draft => ({
  title: a.title,
  description: a.description,
  imageUrl: a.imageUrl,
  buttonText: a.buttonText,
  buttonUrl: a.buttonUrl,
  startsAt: toLocalInput(a.startsAt),
  endsAt: toLocalInput(a.endsAt),
  priority: String(a.sortOrder),
});

/**
 * بطاقة «الإعلانات» في لوحة الأدمن.
 * الحقول النصية تُحفظ عند مغادرة الحقل، والمفاتيح والقوائم تُحفظ فور تغييرها.
 */
export function AnnouncementsCard({ settings }: { settings: AppSettings }) {
  const { toast } = useToast();
  const { data: announcements, isLoading } = useListAnnouncements();
  const updateSettings = useUpdateAppSettings();
  const createAnnouncement = useCreateAnnouncement();
  const updateAnnouncement = useUpdateAnnouncement();
  const deleteAnnouncement = useDeleteAnnouncement();
  const reorder = useReorderAnnouncements();

  const [enabled, setEnabled] = useState(settings.tickerEnabled);
  const [interval, setIntervalValue] = useState(String(settings.announcementInterval));
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const [expanded, setExpanded] = useState<number | null>(null);
  const [toDelete, setToDelete] = useState<Announcement | null>(null);

  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newIcon, setNewIcon] = useState<AnnouncementIcon>("megaphone");
  const [newButtonText, setNewButtonText] = useState("");
  const [newButtonUrl, setNewButtonUrl] = useState("");

  useEffect(() => {
    setEnabled(settings.tickerEnabled);
    setIntervalValue(String(settings.announcementInterval));
  }, [settings.tickerEnabled, settings.announcementInterval]);

  const list = announcements ?? [];
  const intervalValue = INTERVAL_OPTIONS.some((o) => o.value === interval) ? interval : "5";
  const settingsDirty =
    enabled !== settings.tickerEnabled || Number(intervalValue) !== settings.announcementInterval;

  const fail = (title: string) => (error: Error) =>
    toast({ title, description: error.message, variant: "destructive" });

  const saveSettings = () =>
    updateSettings.mutate(
      { tickerEnabled: enabled, announcementInterval: Number(intervalValue) },
      { onSuccess: () => toast({ title: "تم حفظ إعدادات الشريط" }), onError: fail("تعذّر الحفظ") },
    );

  const add = () => {
    const title = newTitle.trim();
    if (!title) return;
    const maxOrder = list.reduce((m, a) => Math.max(m, a.sortOrder), 0);
    createAnnouncement.mutate(
      {
        title,
        description: newDescription.trim(),
        icon: newIcon,
        buttonText: newButtonText.trim(),
        buttonUrl: newButtonUrl.trim(),
        active: true,
        sortOrder: maxOrder + 1,
        showOnHome: true,
        showOnDashboard: true,
      },
      {
        onSuccess: () => {
          setNewTitle("");
          setNewDescription("");
          setNewButtonText("");
          setNewButtonUrl("");
          setNewIcon("megaphone");
          toast({ title: "أُضيف الإعلان وهو ظاهر الآن" });
        },
        onError: fail("تعذّر إضافة الإعلان"),
      },
    );
  };

  const draftOf = (a: Announcement) => drafts[a.id] ?? draftOfItem(a);
  const setDraft = (a: Announcement, patch: Partial<Draft>) =>
    setDrafts((prev) => ({ ...prev, [a.id]: { ...draftOf(a), ...patch } }));
  const isDirty = (a: Announcement) => {
    const d = draftOf(a);
    const b = draftOfItem(a);
    return (Object.keys(b) as (keyof Draft)[]).some((k) => d[k].trim() !== b[k].trim());
  };

  /** يحفظ الحقول النصية والتواريخ والأولوية */
  const saveDraft = (a: Announcement) => {
    if (!isDirty(a)) return;
    const d = draftOf(a);
    if (!d.title.trim()) {
      toast({ title: "عنوان الإعلان مطلوب", variant: "destructive" });
      return;
    }
    const startsAt = fromLocalInput(d.startsAt);
    const endsAt = fromLocalInput(d.endsAt);
    if (startsAt && endsAt && endsAt < startsAt) {
      toast({ title: "تاريخ النهاية قبل البداية", variant: "destructive" });
      return;
    }
    const priority = Number(d.priority);
    updateAnnouncement.mutate(
      {
        id: a.id,
        data: {
          title: d.title,
          description: d.description,
          imageUrl: d.imageUrl,
          buttonText: d.buttonText,
          buttonUrl: d.buttonUrl,
          startsAt,
          endsAt,
          sortOrder: Number.isFinite(priority) ? Math.max(0, Math.round(priority)) : a.sortOrder,
        },
      },
      {
        onSuccess: () => {
          setDrafts((prev) => {
            const next = { ...prev };
            delete next[a.id];
            return next;
          });
        },
        onError: fail("تعذّر التحديث"),
      },
    );
  };

  const patch = (a: Announcement, data: Parameters<typeof updateAnnouncement.mutate>[0]["data"]) =>
    updateAnnouncement.mutate({ id: a.id, data }, { onError: fail("تعذّر التحديث") });

  const move = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= list.length) return;
    const ids = list.map((a) => a.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    reorder.mutate({ orderedIds: ids }, { onError: fail("تعذّر تغيير الترتيب") });
  };

  const confirmDelete = () => {
    if (!toDelete) return;
    deleteAnnouncement.mutate(
      { id: toDelete.id },
      {
        onSuccess: () => {
          setToDelete(null);
          toast({ title: "حُذف الإعلان" });
        },
        onError: (e: Error) => {
          setToDelete(null);
          fail("تعذّر الحذف")(e);
        },
      },
    );
  };

  const busy = reorder.isPending || updateAnnouncement.isPending || deleteAnnouncement.isPending;
  const liveCount = list.filter((a) => announcementState(a) === "live").length;

  return (
    <SettingsCard
      id="announcements"
      icon={Megaphone}
      title="شريط الإعلانات"
      description="بطاقة إعلان أنيقة تظهر في الصفحة الرئيسية للموقع وفوق «نظرة عامة» في لوحة العميل. أكثر من إعلان ← تنتقل تلقائياً."
    >
      <ToggleRow
        label="إظهار الشريط"
        description={
          enabled
            ? liveCount > 0
              ? "ظاهر الآن بـ " + liveCount + " إعلان."
              : "مفعّل لكنه لا يظهر لعدم وجود إعلان ظاهر حالياً."
            : "مخفي عن الجميع."
        }
        checked={enabled}
        onCheckedChange={setEnabled}
      />
      <FieldRow
        label="مدة عرض كل إعلان"
        htmlFor="announcement-interval"
        hint="تُطبَّق عند وجود أكثر من إعلان. الإعلان الواحد يبقى ثابتاً."
      >
        <SelectInput
          id="announcement-interval"
          value={intervalValue}
          onChange={setIntervalValue}
          options={INTERVAL_OPTIONS}
        />
      </FieldRow>
      <SaveBar
        pending={updateSettings.isPending}
        disabled={!settingsDirty}
        onSave={saveSettings}
        label="حفظ إعدادات الشريط"
      />

      <div className="space-y-3 border-t border-gray-100 pt-4">
        <h3 className="text-sm font-bold text-gray-900">الإعلانات</h3>

        {isLoading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
          </div>
        ) : list.length === 0 ? (
          <p className="text-sm text-gray-500">لا توجد إعلانات بعد — أضف أول إعلان بالأسفل.</p>
        ) : (
          <ul className="space-y-2" data-testid="announcements-list">
            {list.map((a, index) => {
              const d = draftOf(a);
              const state = STATE_LABELS[announcementState(a)];
              const open = expanded === a.id;
              return (
                <li
                  key={a.id}
                  className={
                    "rounded-xl border p-3 " +
                    (a.active ? "border-gray-100 bg-white" : "border-dashed border-gray-200 bg-gray-50")
                  }
                >
                  {/* السطر المختصر */}
                  <div className="flex flex-col gap-2 md:flex-row md:items-start">
                    <div className="flex shrink-0 items-center gap-1 md:flex-col">
                      <button
                        type="button"
                        onClick={() => move(index, -1)}
                        disabled={busy || index === 0}
                        className="rounded p-1 text-gray-500 hover:bg-gray-100 disabled:opacity-30"
                        title="رفع الأولوية"
                        aria-label="رفع الأولوية"
                      >
                        <ArrowUp className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => move(index, 1)}
                        disabled={busy || index === list.length - 1}
                        className="rounded p-1 text-gray-500 hover:bg-gray-100 disabled:opacity-30"
                        title="خفض الأولوية"
                        aria-label="خفض الأولوية"
                      >
                        <ArrowDown className="h-4 w-4" />
                      </button>
                      <input
                        type="number"
                        min={0}
                        value={d.priority}
                        onChange={(event) => setDraft(a, { priority: event.target.value })}
                        onBlur={() => saveDraft(a)}
                        title="الأولوية — الأصغر يظهر أولاً"
                        aria-label="الأولوية"
                        className="h-7 w-12 rounded border border-gray-200 text-center text-xs"
                        dir="ltr"
                      />
                    </div>

                    <div className="min-w-0 flex-1 space-y-2">
                      <Input
                        value={d.title}
                        onChange={(event) => setDraft(a, { title: event.target.value })}
                        onBlur={() => saveDraft(a)}
                        maxLength={120}
                        placeholder="عنوان الإعلان"
                        aria-label="عنوان الإعلان"
                        className="font-medium"
                      />
                      <button
                        type="button"
                        onClick={() => setExpanded(open ? null : a.id)}
                        aria-expanded={open}
                        data-testid={"announcement-details-" + a.id}
                        className="inline-flex items-center gap-1 text-xs text-gold-deep underline"
                      >
                        <ChevronDown className={"h-3.5 w-3.5 transition-transform " + (open ? "rotate-180" : "")} />
                        {open ? "إخفاء التفاصيل" : "الوصف والصورة والزر والجدولة"}
                      </button>
                    </div>

                    <div className="flex shrink-0 items-center gap-3 md:flex-col md:items-end">
                      <span className={"whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold " + state.cls}>
                        {state.label}
                      </span>
                      <label className="flex items-center gap-2 text-xs text-gray-700">
                        <Switch
                          checked={a.active}
                          onCheckedChange={(value) => patch(a, { active: value })}
                          disabled={busy}
                          aria-label="تفعيل الإعلان"
                        />
                        {a.active ? "نشط" : "معطّل"}
                      </label>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-red-500 hover:bg-red-50 hover:text-red-700"
                        onClick={() => setToDelete(a)}
                        disabled={busy}
                        title="حذف الإعلان"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  {/* التفاصيل */}
                  {open && (
                    <div className="mt-3 space-y-3 border-t border-gray-100 pt-3">
                      <Textarea
                        value={d.description}
                        onChange={(event) => setDraft(a, { description: event.target.value })}
                        onBlur={() => saveDraft(a)}
                        maxLength={300}
                        rows={2}
                        placeholder="نص مختصر يظهر تحت العنوان (اختياري)"
                        aria-label="وصف الإعلان"
                      />
                      <div className="grid gap-2 sm:grid-cols-2">
                        <label className="text-[11px] text-gray-600">
                          الأيقونة
                          <div className="mt-1">
                            <SelectInput
                              value={a.icon}
                              onChange={(value) => patch(a, { icon: value as AnnouncementIcon })}
                              options={ICON_OPTIONS}
                              disabled={busy}
                            />
                          </div>
                        </label>
                        <label className="text-[11px] text-gray-600">
                          رابط صورة بدل الأيقونة (اختياري)
                          <Input
                            value={d.imageUrl}
                            onChange={(event) => setDraft(a, { imageUrl: event.target.value })}
                            onBlur={() => saveDraft(a)}
                            dir="ltr"
                            className="mt-1 h-9 text-xs"
                            placeholder="https://…"
                          />
                        </label>
                        <label className="text-[11px] text-gray-600">
                          نص الزر (اختياري)
                          <Input
                            value={d.buttonText}
                            onChange={(event) => setDraft(a, { buttonText: event.target.value })}
                            onBlur={() => saveDraft(a)}
                            maxLength={40}
                            className="mt-1 h-9 text-xs"
                            placeholder="اعرف أكثر"
                          />
                        </label>
                        <label className="text-[11px] text-gray-600">
                          رابط الزر
                          <Input
                            value={d.buttonUrl}
                            onChange={(event) => setDraft(a, { buttonUrl: event.target.value })}
                            onBlur={() => saveDraft(a)}
                            dir="ltr"
                            className="mt-1 h-9 text-xs"
                            placeholder="/subscription أو https://…"
                          />
                        </label>
                        <label className="text-[11px] text-gray-600">
                          يبدأ من
                          <Input
                            type="datetime-local"
                            value={d.startsAt}
                            onChange={(event) => setDraft(a, { startsAt: event.target.value })}
                            onBlur={() => saveDraft(a)}
                            dir="ltr"
                            className="mt-1 h-9 text-xs"
                          />
                        </label>
                        <label className="text-[11px] text-gray-600">
                          ينتهي في
                          <Input
                            type="datetime-local"
                            value={d.endsAt}
                            onChange={(event) => setDraft(a, { endsAt: event.target.value })}
                            onBlur={() => saveDraft(a)}
                            dir="ltr"
                            className="mt-1 h-9 text-xs"
                          />
                        </label>
                        <label className="text-[11px] text-gray-600 sm:col-span-2">
                          يظهر لـ
                          <div className="mt-1">
                            <SelectInput
                              value={a.audience}
                              onChange={(value) => patch(a, { audience: value as AnnouncementAudience })}
                              options={AUDIENCE_OPTIONS}
                              disabled={busy}
                            />
                          </div>
                        </label>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <label className="flex items-center gap-2 rounded-lg border border-gray-100 px-3 py-2 text-xs text-gray-700">
                          <Switch
                            checked={a.showOnHome}
                            onCheckedChange={(value) => patch(a, { showOnHome: value })}
                            disabled={busy}
                            aria-label="إظهار في الصفحة الرئيسية"
                          />
                          الصفحة الرئيسية للموقع
                        </label>
                        <label className="flex items-center gap-2 rounded-lg border border-gray-100 px-3 py-2 text-xs text-gray-700">
                          <Switch
                            checked={a.showOnDashboard}
                            onCheckedChange={(value) => patch(a, { showOnDashboard: value })}
                            disabled={busy}
                            aria-label="إظهار في لوحة العميل"
                          />
                          لوحة العميل
                        </label>
                      </div>
                      {isDirty(a) && (
                        <p className="text-[11px] text-amber-700">تغييرات غير محفوظة — تُحفظ عند مغادرة الحقل</p>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <form
          className="space-y-2 rounded-xl border border-line bg-cream-2 p-3"
          onSubmit={(event) => {
            event.preventDefault();
            add();
          }}
        >
          <div className="grid gap-2 md:grid-cols-[2fr_1fr]">
            <FieldRow label="إعلان جديد — العنوان" htmlFor="new-announcement">
              <Input
                id="new-announcement"
                value={newTitle}
                onChange={(event) => setNewTitle(event.target.value)}
                maxLength={120}
                placeholder="عرض خاص على الباقة الماسية"
              />
            </FieldRow>
            <FieldRow label="الأيقونة" htmlFor="new-announcement-icon">
              <SelectInput
                id="new-announcement-icon"
                value={newIcon}
                onChange={(value) => setNewIcon(value as AnnouncementIcon)}
                options={ICON_OPTIONS}
              />
            </FieldRow>
          </div>
          <FieldRow label="الوصف (اختياري)" htmlFor="new-announcement-desc">
            <Input
              id="new-announcement-desc"
              value={newDescription}
              onChange={(event) => setNewDescription(event.target.value)}
              maxLength={300}
              placeholder="خصم ٢٠٪ حتى نهاية الشهر"
            />
          </FieldRow>
          <div className="grid gap-2 md:grid-cols-[1fr_2fr_auto] md:items-end">
            <FieldRow label="نص الزر (اختياري)" htmlFor="new-announcement-btn">
              <Input
                id="new-announcement-btn"
                value={newButtonText}
                onChange={(event) => setNewButtonText(event.target.value)}
                maxLength={40}
                placeholder="اعرف أكثر"
              />
            </FieldRow>
            <FieldRow label="رابط الزر" htmlFor="new-announcement-url">
              <Input
                id="new-announcement-url"
                value={newButtonUrl}
                onChange={(event) => setNewButtonUrl(event.target.value)}
                maxLength={500}
                dir="ltr"
                placeholder="/subscription"
              />
            </FieldRow>
            <Button
              type="submit"
              className="bg-gold font-medium text-black hover:bg-gold/90"
              disabled={createAnnouncement.isPending || newTitle.trim() === ""}
            >
              {createAnnouncement.isPending ? (
                <Loader2 className="ml-1 h-4 w-4 animate-spin" />
              ) : (
                <Plus className="ml-1 h-4 w-4" />
              )}
              إضافة
            </Button>
          </div>
        </form>
      </div>

      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(open) => !open && setToDelete(null)}
        title="حذف الإعلان"
        description={toDelete ? "«" + toDelete.title + "» — سيختفي من الموقع فوراً." : undefined}
        confirmLabel="حذف"
        destructive
        isPending={deleteAnnouncement.isPending}
        onConfirm={confirmDelete}
      />
    </SettingsCard>
  );
}
