import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Loader2, Megaphone, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useToast } from "@/hooks/use-toast";
import {
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
  type AppSettings,
} from "@/lib/api";
import { FieldRow, SaveBar, SelectInput, SettingsCard, ToggleRow } from "./parts";

const AUDIENCE_OPTIONS = (Object.keys(AUDIENCE_LABELS) as AnnouncementAudience[]).map((value) => ({
  value,
  label: AUDIENCE_LABELS[value],
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

const SPEED_OPTIONS = [
  { value: "30", label: "بطيء" },
  { value: "60", label: "متوسط" },
  { value: "100", label: "سريع" },
  { value: "150", label: "سريع جداً" },
];

/**
 * بطاقة «شريط الإعلانات» في إعدادات الأدمن.
 * الشريط نفسه يظهر أعلى هذه الصفحة، فأي تغيير هنا يُرى فوراً.
 * الإعلان النشط فقط يصل للمستخدمين (سياسة RLS)، والترتيب بالأسهم.
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
  const [speed, setSpeed] = useState(String(settings.tickerSpeed));
  const [newText, setNewText] = useState("");
  const [newLink, setNewLink] = useState("");
  type Draft = { text: string; link: string; startsAt: string; endsAt: string; priority: string };
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const [newAudience, setNewAudience] = useState<AnnouncementAudience>("all");
  const [newStarts, setNewStarts] = useState("");
  const [newEnds, setNewEnds] = useState("");
  const [toDelete, setToDelete] = useState<Announcement | null>(null);

  useEffect(() => {
    setEnabled(settings.tickerEnabled);
    setSpeed(String(settings.tickerSpeed));
  }, [settings.tickerEnabled, settings.tickerSpeed]);

  const list = announcements ?? [];
  const speedValue = SPEED_OPTIONS.some((o) => o.value === speed) ? speed : "60";
  const settingsDirty =
    enabled !== settings.tickerEnabled || Number(speedValue) !== settings.tickerSpeed;

  const fail = (title: string) => (error: Error) =>
    toast({ title, description: error.message, variant: "destructive" });

  const saveBarSettings = () =>
    updateSettings.mutate(
      { tickerEnabled: enabled, tickerSpeed: Number(speedValue) },
      { onSuccess: () => toast({ title: "تم حفظ إعدادات الشريط" }), onError: fail("تعذّر الحفظ") },
    );

  const add = () => {
    const text = newText.trim();
    if (!text) return;
    const maxOrder = list.reduce((m, a) => Math.max(m, a.sortOrder), 0);
    const startsAt = fromLocalInput(newStarts);
    const endsAt = fromLocalInput(newEnds);
    if (startsAt && endsAt && endsAt < startsAt) {
      toast({ title: "تاريخ النهاية قبل البداية", variant: "destructive" });
      return;
    }
    createAnnouncement.mutate(
      { text, link: newLink.trim(), active: true, sortOrder: maxOrder + 1, startsAt, endsAt, audience: newAudience },
      {
        onSuccess: () => {
          setNewText("");
          setNewLink("");
          setNewStarts("");
          setNewEnds("");
          setNewAudience("all");
          toast({ title: startsAt && startsAt > new Date().toISOString() ? "أُضيف الإعلان وسيظهر في موعده" : "أُضيف الإعلان" });
        },
        onError: fail("تعذّر إضافة الإعلان"),
      },
    );
  };

  const baseDraft = (a: Announcement): Draft => ({
    text: a.text,
    link: a.link,
    startsAt: toLocalInput(a.startsAt),
    endsAt: toLocalInput(a.endsAt),
    priority: String(a.sortOrder),
  });
  const draftOf = (a: Announcement) => drafts[a.id] ?? baseDraft(a);
  const setDraft = (a: Announcement, patch: Partial<Draft>) =>
    setDrafts((prev) => ({ ...prev, [a.id]: { ...draftOf(a), ...patch } }));
  const isDirty = (a: Announcement) => {
    const d = draftOf(a);
    const b = baseDraft(a);
    return (
      d.text.trim() !== b.text || d.link.trim() !== b.link ||
      d.startsAt !== b.startsAt || d.endsAt !== b.endsAt || d.priority !== b.priority
    );
  };

  const saveText = (a: Announcement) => {
    const d = draftOf(a);
    if (!isDirty(a)) return;
    if (!d.text.trim()) {
      toast({ title: "نص الإعلان لا يمكن أن يكون فارغاً", variant: "destructive" });
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
          text: d.text,
          link: d.link,
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
          toast({ title: "تم تحديث الإعلان" });
        },
        onError: fail("تعذّر التحديث"),
      },
    );
  };

  const toggleActive = (a: Announcement, active: boolean) =>
    updateAnnouncement.mutate({ id: a.id, data: { active } }, { onError: fail("تعذّر التحديث") });
  const setAudience = (a: Announcement, audience: AnnouncementAudience) =>
    updateAnnouncement.mutate({ id: a.id, data: { audience } }, { onError: fail("تعذّر التحديث") });

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
  const activeCount = list.filter((a) => a.active).length;

  return (
    <SettingsCard
      id="announcements"
      icon={Megaphone}
      title="شريط الإعلانات المتحرك"
      description="يظهر أعلى واجهة المستخدم وأسفل واجهة الموقع. يصل للمستخدمين فقط ما هو نشط وضمن مدته ومطابق لفئتهم — وهذا يُفرض في قاعدة البيانات لا في الواجهة."
    >
      <ToggleRow
        label="إظهار الشريط"
        description={
          enabled
            ? activeCount > 0
              ? "الشريط ظاهر الآن بـ " + activeCount + " إعلان نشط."
              : "الشريط مفعّل لكنه لا يظهر لعدم وجود إعلان نشط."
            : "الشريط مخفي عن الجميع."
        }
        checked={enabled}
        onCheckedChange={setEnabled}
      />
      <FieldRow label="سرعة الحركة" htmlFor="ticker-speed">
        <SelectInput id="ticker-speed" value={speedValue} onChange={setSpeed} options={SPEED_OPTIONS} />
      </FieldRow>
      <SaveBar
        pending={updateSettings.isPending}
        disabled={!settingsDirty}
        onSave={saveBarSettings}
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
              const dirty = isDirty(a);
              const state = STATE_LABELS[announcementState(a)];
              return (
                <li
                  key={a.id}
                  className={
                    "rounded-xl border p-3 " +
                    (a.active ? "border-gray-100 bg-white" : "border-dashed border-gray-200 bg-gray-50")
                  }
                >
                  <div className="flex flex-col gap-2 md:flex-row md:items-start">
                    <div className="flex shrink-0 items-center gap-1 md:flex-col">
                      <button
                        type="button"
                        onClick={() => move(index, -1)}
                        disabled={busy || index === 0}
                        className="rounded p-1 text-gray-500 hover:bg-gray-100 disabled:opacity-30"
                        title="تحريك للأعلى"
                        aria-label="تحريك للأعلى"
                      >
                        <ArrowUp className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => move(index, 1)}
                        disabled={busy || index === list.length - 1}
                        className="rounded p-1 text-gray-500 hover:bg-gray-100 disabled:opacity-30"
                        title="تحريك للأسفل"
                        aria-label="تحريك للأسفل"
                      >
                        <ArrowDown className="h-4 w-4" />
                      </button>
                      <input
                        type="number"
                        min={0}
                        value={d.priority}
                        onChange={(event) => setDraft(a, { priority: event.target.value })}
                        onBlur={() => saveText(a)}
                        title="الأولوية — الأصغر يظهر أولاً"
                        aria-label="الأولوية"
                        className="h-7 w-12 rounded border border-gray-200 text-center text-xs"
                        dir="ltr"
                      />
                    </div>
                    <div className="flex-1 space-y-2">
                      <Input
                        value={d.text}
                        onChange={(event) => setDraft(a, { text: event.target.value })}
                        onBlur={() => saveText(a)}
                        maxLength={200}
                        placeholder="نص الإعلان"
                        aria-label="نص الإعلان"
                      />
                      <Input
                        value={d.link}
                        onChange={(event) => setDraft(a, { link: event.target.value })}
                        onBlur={() => saveText(a)}
                        maxLength={500}
                        dir="ltr"
                        className="text-xs"
                        placeholder="رابط اختياري: /subscription أو https://…"
                        aria-label="رابط الإعلان"
                      />
                      <div className="grid gap-2 sm:grid-cols-3">
                        <label className="text-[11px] text-gray-600">
                          يبدأ من
                          <Input
                            type="datetime-local"
                            value={d.startsAt}
                            onChange={(event) => setDraft(a, { startsAt: event.target.value })}
                            onBlur={() => saveText(a)}
                            dir="ltr"
                            className="mt-1 h-8 text-xs"
                          />
                        </label>
                        <label className="text-[11px] text-gray-600">
                          ينتهي في
                          <Input
                            type="datetime-local"
                            value={d.endsAt}
                            onChange={(event) => setDraft(a, { endsAt: event.target.value })}
                            onBlur={() => saveText(a)}
                            dir="ltr"
                            className="mt-1 h-8 text-xs"
                          />
                        </label>
                        <label className="text-[11px] text-gray-600">
                          يظهر لـ
                          <div className="mt-1">
                            <SelectInput
                              value={a.audience}
                              onChange={(value) => setAudience(a, value as AnnouncementAudience)}
                              options={AUDIENCE_OPTIONS}
                              disabled={busy}
                            />
                          </div>
                        </label>
                      </div>
                      {dirty && (
                        <p className="text-[11px] text-amber-700">تغييرات غير محفوظة — تُحفظ عند مغادرة الحقل</p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-3 md:flex-col md:items-end">
                      <span className={"rounded-full px-2 py-0.5 text-[11px] font-bold " + state.cls}>
                        {state.label}
                      </span>
                      <label className="flex items-center gap-2 text-xs text-gray-700">
                        <Switch
                          checked={a.active}
                          onCheckedChange={(value) => toggleActive(a, value)}
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
                </li>
              );
            })}
          </ul>
        )}

        <form
          className="grid gap-2 rounded-xl border border-line bg-cream-2 p-3 md:grid-cols-[2fr_1fr_1fr_1fr_1fr_auto] md:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            add();
          }}
        >
          <FieldRow label="إعلان جديد" htmlFor="new-announcement">
            <Input
              id="new-announcement"
              value={newText}
              onChange={(event) => setNewText(event.target.value)}
              maxLength={200}
              placeholder="🎉 عرض خاص — الباقة الماسية متاحة الآن"
            />
          </FieldRow>
          <FieldRow label="رابط (اختياري)" htmlFor="new-announcement-link">
            <Input
              id="new-announcement-link"
              value={newLink}
              onChange={(event) => setNewLink(event.target.value)}
              maxLength={500}
              dir="ltr"
              placeholder="/subscription"
            />
          </FieldRow>
          <FieldRow label="يظهر لـ" htmlFor="new-announcement-audience">
            <SelectInput
              id="new-announcement-audience"
              value={newAudience}
              onChange={(value) => setNewAudience(value as AnnouncementAudience)}
              options={AUDIENCE_OPTIONS}
            />
          </FieldRow>
          <FieldRow label="يبدأ من (اختياري)" htmlFor="new-announcement-starts">
            <Input
              id="new-announcement-starts"
              type="datetime-local"
              value={newStarts}
              onChange={(event) => setNewStarts(event.target.value)}
              dir="ltr"
            />
          </FieldRow>
          <FieldRow label="ينتهي في (اختياري)" htmlFor="new-announcement-ends">
            <Input
              id="new-announcement-ends"
              type="datetime-local"
              value={newEnds}
              onChange={(event) => setNewEnds(event.target.value)}
              dir="ltr"
            />
          </FieldRow>
          <Button
            type="submit"
            className="bg-gold font-medium text-black hover:bg-gold/90"
            disabled={createAnnouncement.isPending || newText.trim() === ""}
          >
            {createAnnouncement.isPending ? (
              <Loader2 className="ml-1 h-4 w-4 animate-spin" />
            ) : (
              <Plus className="ml-1 h-4 w-4" />
            )}
            إضافة
          </Button>
        </form>
      </div>

      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(open) => !open && setToDelete(null)}
        title="حذف الإعلان"
        description={toDelete ? "«" + toDelete.text + "» — سيختفي من الشريط فوراً." : undefined}
        confirmLabel="حذف"
        destructive
        isPending={deleteAnnouncement.isPending}
        onConfirm={confirmDelete}
      />
    </SettingsCard>
  );
}
