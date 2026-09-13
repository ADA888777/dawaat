import { useEffect, useMemo, useState } from "react";
import {
  ShieldCheck,
  Users,
  CreditCard,
  Palette,
  Mail,
  Bell,
  Globe,
  ScrollText,
  BarChart3,
  LogOut,
  Loader2,
  Plus,
  Trash2,
  Search,
  FileText,
} from "lucide-react";
import { format } from "date-fns";
import { ar } from "date-fns/locale";
import { AppLayout } from "@/components/layout/app-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import {
  useAdminSetFreeLimit,
  useAdminSetPlan,
  useCreateTemplate,
  useDeleteTemplate,
  useGetAdminStats,
  useGetAppSettings,
  useListAdminEvents,
  useListAdminUsers,
  useListTemplates,
  useUpdateAdminUser,
  useUpdateAppSettings,
  useUpdateMyProfile,
  useUpdateTemplate,
  type AdminUser,
  type AppSettings,
  type ContactMethod,
  type EventCategory,
  type Me,
} from "@/lib/api";
import {
  AccountSecurityCard,
  FieldRow,
  SaveBar,
  SelectInput,
  SettingsCard,
  ToggleRow,
} from "./parts";

const ROLE_OPTIONS = [
  { value: "user", label: "مستخدم" },
  { value: "admin", label: "أدمن" },
];

const PLAN_OPTIONS = [
  { value: "free", label: "المجانية" },
  { value: "paid", label: "الماسية" },
];

const CONTACT_METHOD_OPTIONS = [
  { value: "both", label: "اتصال وواتساب" },
  { value: "whatsapp", label: "واتساب فقط" },
  { value: "call", label: "اتصال فقط" },
];

const CATEGORY_OPTIONS = [
  { value: "wedding", label: "زفاف" },
  { value: "engagement", label: "خطوبة" },
  { value: "birthday", label: "عيد ميلاد" },
  { value: "graduation", label: "تخرج" },
  { value: "meeting", label: "اجتماع" },
  { value: "general", label: "عام" },
];

const WEEK = 7 * 24 * 3600 * 1000;

function formatDay(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : format(parsed, "dd MMMM yyyy", { locale: ar });
}

interface UserDraft {
  role: "user" | "admin";
  plan: "free" | "paid";
  months: number;
  renew: boolean;
}

/**
 * إعدادات الأدمن.
 * يُحمَّل هذا الملف فقط عندما يكون role = admin (التوجيه في index)،
 * ومع ذلك فكل عملية حسّاسة هنا تمر بدالة أو سياسة تتحقق من الصلاحية
 * داخل قاعدة البيانات، فالواجهة ليست خط الحماية.
 */
export default function AdminSettings({ me }: { me: Me }) {
  const { toast } = useToast();
  const { signOut } = useAuth();

  const { data: settings } = useGetAppSettings();
  const { data: stats } = useGetAdminStats();
  const { data: users } = useListAdminUsers();
  const { data: adminEvents } = useListAdminEvents();
  const { data: templates } = useListTemplates({ includeInactive: true });

  const updateProfile = useUpdateMyProfile();
  const updateSettings = useUpdateAppSettings();
  const updateAdminUser = useUpdateAdminUser();
  const setPlan = useAdminSetPlan();
  const setFreeLimit = useAdminSetFreeLimit();
  const createTemplate = useCreateTemplate();
  const updateTemplate = useUpdateTemplate();
  const deleteTemplate = useDeleteTemplate();

  const [name, setName] = useState(me.name);
  const [form, setForm] = useState<AppSettings | null>(null);
  const [search, setSearch] = useState("");
  const [visibleUsers, setVisibleUsers] = useState(10);
  const [drafts, setDrafts] = useState<Record<string, UserDraft>>({});
  const [savingUserId, setSavingUserId] = useState<string | null>(null);
  const [freeLimitInput, setFreeLimitInput] = useState("1");
  const [applyToExisting, setApplyToExisting] = useState(false);
  const [confirmTemplateId, setConfirmTemplateId] = useState<number | null>(null);
  const [newTemplate, setNewTemplate] = useState({ name: "", category: "general", previewImage: "" });
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => { setName(me.name); }, [me.name]);
  useEffect(() => { if (settings) setForm(settings); }, [settings]);
  useEffect(() => {
    if (settings) setFreeLimitInput(String(settings.freeEventsLimit));
  }, [settings]);

  const setField = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const saveSettings = (keys: (keyof AppSettings)[], title: string) => {
    if (!form) return;
    const patch: Record<string, unknown> = {};
    for (const key of keys) patch[key] = form[key];
    updateSettings.mutate(patch as Partial<AppSettings>, {
      onSuccess: () => toast({ title }),
      onError: (error: Error) =>
        toast({ title: "تعذّر الحفظ", description: error.message, variant: "destructive" }),
    });
  };

  const draftFor = (user: AdminUser): UserDraft =>
    drafts[user.id] ?? { role: user.role, plan: user.plan, months: 12, renew: false };

  const patchDraft = (user: AdminUser, patch: Partial<UserDraft>) => {
    setDrafts((prev) => ({
      ...prev,
      [user.id]: {
        ...(prev[user.id] ?? { role: user.role, plan: user.plan, months: 12, renew: false }),
        ...patch,
      },
    }));
  };
  const adminsCount = stats?.adminsCount ?? 0;

  const applyUser = async (user: AdminUser) => {
    const draft = draftFor(user);
    // حراسة عملية: لا نسمح بإزالة آخر أدمن ولا بأن يسحب الأدمن صلاحيته
    // من نفسه، وإلا يبقى الموقع بلا أي حساب قادر على الإدارة.
    if (user.role === "admin" && draft.role === "user") {
      if (user.id === me.id) {
        toast({ title: "لا يمكنك إزالة صلاحيتك بنفسك", variant: "destructive" });
        return;
      }
      if (adminsCount <= 1) {
        toast({ title: "لا يمكن إزالة آخر حساب أدمن", variant: "destructive" });
        return;
      }
    }
    setSavingUserId(user.id);
    try {
      if (draft.plan !== user.plan || (draft.plan === "paid" && draft.renew)) {
        await setPlan.mutateAsync({ userId: user.id, plan: draft.plan, months: draft.months });
      }
      if (draft.role !== user.role) {
        await updateAdminUser.mutateAsync({ id: user.id, data: { role: draft.role } });
      }
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[user.id];
        return next;
      });
      toast({ title: "تم تحديث الحساب" });
    } catch (error) {
      toast({
        title: "تعذّر تحديث الحساب",
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      });
    } finally {
      setSavingUserId(null);
    }
  };

  const applyFreeLimit = () => {
    const limit = Number(freeLimitInput);
    if (!Number.isFinite(limit) || limit < 0 || limit > 1000) {
      toast({ title: "أدخل رقماً بين 0 و1000", variant: "destructive" });
      return;
    }
    setFreeLimit.mutate(
      { limit, applyExisting: applyToExisting },
      {
        onSuccess: (affected) =>
          toast({
            title: "تم تحديث حد الباقة المجانية",
            description: applyToExisting
              ? "طُبّق على " + affected + " حساباً مجانياً قائماً."
              : "سيُطبَّق على الحسابات الجديدة فقط.",
          }),
        onError: (error: Error) =>
          toast({ title: "تعذّر التحديث", description: error.message, variant: "destructive" }),
      },
    );
  };

  const toggleTemplateActive = (id: number, active: boolean) => {
    const template = (templates ?? []).find((item) => item.id === id);
    if (!template) return;
    updateTemplate.mutate(
      {
        id,
        data: {
          name: template.name,
          category: template.category,
          previewImage: template.previewImage,
          active,
        },
      },
      {
        onSuccess: () => toast({ title: active ? "تم تفعيل القالب" : "تم إخفاء القالب" }),
        onError: (error: Error) =>
          toast({ title: "تعذّر التحديث", description: error.message, variant: "destructive" }),
      },
    );
  };

  const addTemplate = () => {
    const templateName = newTemplate.name.trim();
    if (templateName.length < 2) {
      toast({ title: "اكتب اسماً للقالب", variant: "destructive" });
      return;
    }
    createTemplate.mutate(
      {
        data: {
          name: templateName.slice(0, 80),
          category: newTemplate.category as EventCategory,
          previewImage: newTemplate.previewImage.trim(),
          active: true,
        },
      },
      {
        onSuccess: () => {
          setNewTemplate({ name: "", category: "general", previewImage: "" });
          toast({ title: "تم إضافة القالب" });
        },
        onError: (error: Error) =>
          toast({ title: "تعذّر الإضافة", description: error.message, variant: "destructive" }),
      },
    );
  };

  const removeTemplate = (id: number) => {
    deleteTemplate.mutate(
      { id },
      {
        onSuccess: () => {
          setConfirmTemplateId(null);
          toast({ title: "تم حذف القالب" });
        },
        onError: (error: Error) =>
          toast({ title: "تعذّر الحذف", description: error.message, variant: "destructive" }),
      },
    );
  };

  const handleSignOut = async () => {
    setSigningOut(true);
    await signOut();
    window.location.href = import.meta.env.BASE_URL;
  };
  const filteredUsers = useMemo(() => {
    const term = search.trim().toLowerCase();
    const list = users ?? [];
    if (!term) return list;
    return list.filter(
      (user) =>
        user.name.toLowerCase().includes(term) || user.email.toLowerCase().includes(term),
    );
  }, [users, search]);

  const newUsersCount = useMemo(() => {
    const since = Date.now() - WEEK;
    return (users ?? []).filter((user) => {
      const created = new Date(user.createdAt).getTime();
      return Number.isFinite(created) && created >= since;
    }).length;
  }, [users]);

  const soonEventsCount = useMemo(() => {
    const now = Date.now();
    return (adminEvents ?? []).filter((event) => {
      const when = new Date(event.eventDate).getTime();
      return Number.isFinite(when) && when >= now && when <= now + WEEK;
    }).length;
  }, [adminEvents]);

  if (!form) {
    return (
      <AppLayout>
        <div className="flex justify-center py-32">
          <Loader2 className="w-8 h-8 animate-spin text-gold" />
        </div>
      </AppLayout>
    );
  }

  const statCards = [
    { label: "المستخدمون", value: stats?.usersCount ?? 0 },
    { label: "الاشتراكات المدفوعة", value: stats?.paidPlanCount ?? 0 },
    { label: "حسابات الأدمن", value: adminsCount },
    { label: "المناسبات", value: stats?.eventsCount ?? 0 },
    { label: "المدعوون", value: stats?.guestsCount ?? 0 },
    { label: "المؤكد حضورهم", value: stats?.attendingCount ?? 0 },
    { label: "القوالب", value: stats?.templatesCount ?? 0 },
    { label: "مناسبات هذا الأسبوع", value: soonEventsCount },
  ];

  return (
    <AppLayout>
      <div className="p-5 md:p-10 max-w-4xl mx-auto space-y-6">
        <header>
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900">إعدادات الإدارة</h1>
          <p className="text-gray-600 mt-1">
            إدارة الحسابات والباقات والقوالب وإعدادات الموقع العامة.
          </p>
        </header>

        <SettingsCard
          id="stats"
          icon={BarChart3}
          title="الإحصائيات العامة"
          description="أرقام محسوبة على الخادم مباشرة."
        >
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {statCards.map((card) => (
              <div key={card.label} className="bg-gray-50 rounded-xl p-3 border border-gray-100">
                <p className="text-xs text-gray-500 leading-snug">{card.label}</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">{card.value}</p>
              </div>
            ))}
          </div>
          {form.notifyAdminOnNewUser && newUsersCount > 0 ? (
            <div className="text-sm bg-gold/10 text-gold-deep rounded-xl px-4 py-3">
              انضم {newUsersCount} حساب جديد خلال الأسبوع الماضي.
            </div>
          ) : null}
          {form.notifyAdminOnNewEvent && soonEventsCount > 0 ? (
            <div className="text-sm bg-blue-50 text-blue-700 rounded-xl px-4 py-3">
              لدى المستخدمين {soonEventsCount} مناسبة خلال الأيام السبعة القادمة.
            </div>
          ) : null}
        </SettingsCard>

        <SettingsCard
          id="profile"
          icon={ShieldCheck}
          title="بيانات حساب الأدمن"
          description="اسمك كما يظهر داخل لوحة التحكم."
        >
          <FieldRow label="الاسم" htmlFor="admin-name">
            <Input
              id="admin-name"
              autoComplete="name"
              maxLength={80}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </FieldRow>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-gray-500">نوع الحساب</p>
              <p className="font-medium text-gray-800 mt-0.5">أدمن</p>
            </div>
            <div>
              <p className="text-gray-500">تاريخ الانضمام</p>
              <p className="font-medium text-gray-800 mt-0.5">{formatDay(me.createdAt)}</p>
            </div>
          </div>
          <SaveBar
            pending={updateProfile.isPending}
            disabled={name.trim() === me.name || name.trim().length < 2}
            onSave={() =>
              updateProfile.mutate(
                { name },
                {
                  onSuccess: () => toast({ title: "تم تحديث الاسم" }),
                  onError: (error: Error) =>
                    toast({ title: "تعذّر الحفظ", description: error.message, variant: "destructive" }),
                },
              )
            }
          />
        </SettingsCard>

        <AccountSecurityCard currentEmail={me.email} />
        <SettingsCard
          id="users"
          icon={Users}
          title="إدارة المستخدمين والصلاحيات"
          description="تغيير الصلاحية أو الباقة لكل حساب. لا يمكن إزالة آخر حساب أدمن."
        >
          <div className="relative">
            <Search className="w-4 h-4 text-gray-400 absolute right-3 top-1/2 -translate-y-1/2" />
            <Input
              type="search"
              placeholder="ابحث بالاسم أو البريد"
              className="pr-9"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>

          {filteredUsers.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-6">لا توجد نتائج.</p>
          ) : (
            <div className="space-y-3">
              {filteredUsers.slice(0, visibleUsers).map((user) => {
                const draft = draftFor(user);
                const changed =
                  draft.role !== user.role ||
                  draft.plan !== user.plan ||
                  (draft.plan === "paid" && draft.renew);
                return (
                  <div key={user.id} className="border border-gray-100 rounded-xl p-4 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold text-gray-900 truncate">{user.name}</p>
                        <p className="text-xs text-gray-500 truncate" dir="ltr">{user.email}</p>
                      </div>
                      <div className="text-left shrink-0">
                        {user.id === me.id ? (
                          <span className="text-xs bg-gold/15 text-gold-deep px-2 py-1 rounded-full">حسابك</span>
                        ) : null}
                        <p className="text-xs text-gray-400 mt-1">{formatDay(user.createdAt)}</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <FieldRow label="الصلاحية">
                        <SelectInput
                          value={draft.role}
                          onChange={(value) => patchDraft(user, { role: value as "user" | "admin" })}
                          options={ROLE_OPTIONS}
                        />
                      </FieldRow>
                      <FieldRow label="الباقة">
                        <SelectInput
                          value={draft.plan}
                          onChange={(value) => patchDraft(user, { plan: value as "free" | "paid" })}
                          options={PLAN_OPTIONS}
                        />
                      </FieldRow>
                    </div>
                    {draft.plan === "paid" ? (
                      <FieldRow label="مدة الاشتراك بالأشهر" hint="تبدأ من اليوم عند الحفظ.">
                        <Input
                          type="number"
                          inputMode="numeric"
                          min={1}
                          max={120}
                          dir="ltr"
                          value={String(draft.months)}
                          onChange={(event) =>
                            patchDraft(user, { months: Number(event.target.value), renew: true })
                          }
                        />
                      </FieldRow>
                    ) : null}
                    <Button
                      type="button"
                      size="sm"
                      className="bg-ink text-gold-light hover:bg-ink-soft gap-2"
                      disabled={!changed || savingUserId === user.id}
                      onClick={() => applyUser(user)}
                    >
                      {savingUserId === user.id ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                      حفظ
                    </Button>
                  </div>
                );
              })}
            </div>
          )}

          {filteredUsers.length > visibleUsers ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => setVisibleUsers((count) => count + 20)}
            >
              عرض المزيد ({filteredUsers.length - visibleUsers})
            </Button>
          ) : null}
        </SettingsCard>
        <SettingsCard
          id="plans"
          icon={CreditCard}
          title="إدارة الباقات والاشتراكات"
          description="حد المناسبات للباقة المجانية وبيانات الباقة المدفوعة."
        >
          <FieldRow
            label="حد المناسبات في الباقة المجانية"
            htmlFor="free-limit"
            hint="يُطبَّق على الحسابات الجديدة، ويمكنك تطبيقه على الحسابات المجانية القائمة أيضاً."
          >
            <Input
              id="free-limit"
              type="number"
              inputMode="numeric"
              min={0}
              max={1000}
              dir="ltr"
              value={freeLimitInput}
              onChange={(event) => setFreeLimitInput(event.target.value)}
            />
          </FieldRow>
          <ToggleRow
            label="تطبيق الحد على الحسابات المجانية القائمة"
            description="يعدّل حد المناسبات لكل حساب مجاني موجود الآن."
            checked={applyToExisting}
            onCheckedChange={setApplyToExisting}
          />
          <SaveBar
            pending={setFreeLimit.isPending}
            disabled={freeLimitInput === String(form.freeEventsLimit) && !applyToExisting}
            onSave={applyFreeLimit}
            label="تحديث الحد"
          />

          <div className="pt-4 border-t border-gray-100 space-y-5">
            <div className="grid grid-cols-2 gap-3">
              <FieldRow label="سعر الباقة المدفوعة (ريال)" htmlFor="paid-price">
                <Input
                  id="paid-price"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  dir="ltr"
                  value={String(form.paidPlanPrice)}
                  onChange={(event) => setField("paidPlanPrice", Number(event.target.value))}
                />
              </FieldRow>
              <FieldRow label="مدة الباقة بالأشهر" htmlFor="paid-months">
                <Input
                  id="paid-months"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={120}
                  dir="ltr"
                  value={String(form.paidPlanMonths)}
                  onChange={(event) => setField("paidPlanMonths", Number(event.target.value))}
                />
              </FieldRow>
            </div>
            <SaveBar
              pending={updateSettings.isPending}
              onSave={() => saveSettings(["paidPlanPrice", "paidPlanMonths"], "تم حفظ بيانات الباقة")}
              label="حفظ بيانات الباقة"
              note="السعر يظهر في صفحة الباقات للمستخدمين."
            />
          </div>
        </SettingsCard>

        <SettingsCard
          id="templates"
          icon={Palette}
          title="إدارة القوالب والثيمات"
          description="القالب غير المفعّل يختفي من خيارات المستخدمين ولا يتأثر به من استخدمه سابقاً."
        >
          <div className="space-y-3">
            {(templates ?? []).map((template) => (
              <div
                key={template.id}
                className="flex items-center gap-3 border border-gray-100 rounded-xl p-3"
              >
                <div className="w-12 h-12 rounded-lg bg-gray-100 overflow-hidden shrink-0 flex items-center justify-center">
                  {template.previewImage ? (
                    <img
                      src={template.previewImage}
                      alt=""
                      loading="lazy"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <FileText className="w-5 h-5 text-gray-400" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-gray-900 truncate">{template.name}</p>
                  <p className="text-xs text-gray-500">
                    {CATEGORY_OPTIONS.find((option) => option.value === template.category)?.label ?? template.category}
                  </p>
                </div>
                <Switch
                  aria-label="تفعيل القالب"
                  checked={template.active}
                  onCheckedChange={(value) => toggleTemplateActive(template.id, value)}
                  disabled={updateTemplate.isPending}
                  className="shrink-0"
                />
                {confirmTemplateId === template.id ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    disabled={deleteTemplate.isPending}
                    onClick={() => removeTemplate(template.id)}
                  >
                    تأكيد
                  </Button>
                ) : (
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label="حذف القالب"
                    onClick={() => setConfirmTemplateId(template.id)}
                  >
                    <Trash2 className="w-4 h-4 text-red-500" />
                  </Button>
                )}
              </div>
            ))}
          </div>

          <div className="pt-4 border-t border-gray-100 space-y-4">
            <p className="font-medium text-gray-800">إضافة قالب</p>
            <div className="grid sm:grid-cols-2 gap-3">
              <FieldRow label="اسم القالب">
                <Input
                  value={newTemplate.name}
                  maxLength={80}
                  onChange={(event) => setNewTemplate((prev) => ({ ...prev, name: event.target.value }))}
                />
              </FieldRow>
              <FieldRow label="التصنيف">
                <SelectInput
                  value={newTemplate.category}
                  onChange={(value) => setNewTemplate((prev) => ({ ...prev, category: value }))}
                  options={CATEGORY_OPTIONS}
                />
              </FieldRow>
            </div>
            <FieldRow label="رابط صورة المعاينة" hint="رابط مباشر لصورة تُعرض للمستخدم قبل الاختيار.">
              <Input
                dir="ltr"
                inputMode="url"
                placeholder="https://"
                value={newTemplate.previewImage}
                onChange={(event) => setNewTemplate((prev) => ({ ...prev, previewImage: event.target.value }))}
              />
            </FieldRow>
            <Button
              type="button"
              className="bg-ink text-gold-light hover:bg-ink-soft gap-2"
              disabled={createTemplate.isPending || newTemplate.name.trim().length < 2}
              onClick={addTemplate}
            >
              {createTemplate.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Plus className="w-4 h-4" />
              )}
              إضافة القالب
            </Button>
          </div>
        </SettingsCard>
        <SettingsCard
          id="invites"
          icon={FileText}
          title="إعدادات الدعوات العامة"
          description="تطبّق على صفحة الدعوة التي يفتحها المدعو."
        >
          <ToggleRow
            label="إظهار رقم التواصل في الدعوة"
            description="عند الإيقاف يُخفى زر الاتصال والواتساب من كل الدعوات."
            checked={form.inviteShowContact}
            onCheckedChange={(value) => setField("inviteShowContact", value)}
          />
          <FieldRow
            label="الوسائل المسموح إظهارها للمدعو"
            htmlFor="invite-method"
            hint="سياسة عامة تعلو على اختيار صاحب الدعوة: لو حددت واتساب فقط لن يظهر زر الاتصال في أي دعوة."
          >
            <SelectInput
              id="invite-method"
              value={form.inviteDefaultContactMethod}
              onChange={(value) => setField("inviteDefaultContactMethod", value as ContactMethod)}
              options={CONTACT_METHOD_OPTIONS}
            />
          </FieldRow>
          <FieldRow
            label="نص يظهر أسفل كل دعوة"
            htmlFor="invite-footer"
            hint="مثال: لأي استفسار تواصل معنا. اتركه فارغاً لإخفائه."
          >
            <Textarea
              id="invite-footer"
              rows={2}
              maxLength={300}
              value={form.inviteFooterNote}
              onChange={(event) => setField("inviteFooterNote", event.target.value)}
            />
          </FieldRow>
          <SaveBar
            pending={updateSettings.isPending}
            onSave={() =>
              saveSettings(
                ["inviteShowContact", "inviteDefaultContactMethod", "inviteFooterNote"],
                "تم حفظ إعدادات الدعوات",
              )
            }
          />
        </SettingsCard>

        <SettingsCard
          id="notifications"
          icon={Bell}
          title="إعدادات الإشعارات"
          description="تنبيهات داخل الموقع — لا تُرسل رسائل بريد، فخدمة الإرسال غير مربوطة بعد."
        >
          <ToggleRow
            label="تذكيرات المناسبات للمستخدمين"
            description="مفتاح عام: عند إيقافه تختفي تذكيرات المواعيد من لوحات المستخدمين كلهم."
            checked={form.notifyUsersReminders}
            onCheckedChange={(value) => setField("notifyUsersReminders", value)}
          />
          <ToggleRow
            label="تنبيهي بالحسابات الجديدة"
            description="يعرض عدد الحسابات المسجّلة خلال آخر سبعة أيام في هذه الصفحة."
            checked={form.notifyAdminOnNewUser}
            onCheckedChange={(value) => setField("notifyAdminOnNewUser", value)}
          />
          <ToggleRow
            label="تنبيهي بالمناسبات القريبة"
            description="يعرض عدد المناسبات خلال الأيام السبعة القادمة في هذه الصفحة."
            checked={form.notifyAdminOnNewEvent}
            onCheckedChange={(value) => setField("notifyAdminOnNewEvent", value)}
          />
          <SaveBar
            pending={updateSettings.isPending}
            onSave={() =>
              saveSettings(
                ["notifyUsersReminders", "notifyAdminOnNewUser", "notifyAdminOnNewEvent"],
                "تم حفظ إعدادات الإشعارات",
              )
            }
          />
        </SettingsCard>

        <SettingsCard
          id="site"
          icon={Globe}
          title="إعدادات الموقع العامة"
          description="اسم الموقع وحالة التسجيل ووضع الصيانة."
        >
          <FieldRow label="اسم الموقع" htmlFor="site-name" hint="يظهر في القائمة الجانبية وعنوان التبويب.">
            <Input
              id="site-name"
              maxLength={40}
              value={form.siteName}
              onChange={(event) => setField("siteName", event.target.value)}
            />
          </FieldRow>
          <ToggleRow
            label="السماح بإنشاء حسابات جديدة"
            description="عند الإيقاف تظهر رسالة في صفحة التسجيل بدل النموذج."
            checked={form.signupsEnabled}
            onCheckedChange={(value) => setField("signupsEnabled", value)}
          />
          <ToggleRow
            label="وضع الصيانة"
            description="يوقف لوحات المستخدمين ويُظهر رسالة الصيانة. حسابات الأدمن وصفحات الدعوات تبقى تعمل."
            checked={form.maintenanceMode}
            onCheckedChange={(value) => setField("maintenanceMode", value)}
          />
          <FieldRow label="رسالة الصيانة" htmlFor="maintenance-message">
            <Textarea
              id="maintenance-message"
              rows={2}
              maxLength={300}
              placeholder="نجري تحديثاً سريعاً، نعود قريباً."
              value={form.maintenanceMessage}
              onChange={(event) => setField("maintenanceMessage", event.target.value)}
            />
          </FieldRow>
          <SaveBar
            pending={updateSettings.isPending}
            onSave={() =>
              saveSettings(
                ["siteName", "signupsEnabled", "maintenanceMode", "maintenanceMessage"],
                "تم حفظ إعدادات الموقع",
              )
            }
          />
        </SettingsCard>
        <SettingsCard
          id="support"
          icon={Mail}
          title="البريد الرسمي وخدمة العملاء"
          description="تظهر هذه البيانات للمستخدمين في صفحة المساعدة."
        >
          <FieldRow label="البريد الرسمي" htmlFor="support-email">
            <Input
              id="support-email"
              type="email"
              inputMode="email"
              dir="ltr"
              placeholder="support@example.com"
              value={form.supportEmail}
              onChange={(event) => setField("supportEmail", event.target.value)}
            />
          </FieldRow>
          <FieldRow label="رقم خدمة العملاء" htmlFor="support-phone">
            <Input
              id="support-phone"
              type="tel"
              inputMode="tel"
              dir="ltr"
              placeholder="0501234567"
              value={form.supportPhone}
              onChange={(event) => setField("supportPhone", event.target.value)}
            />
          </FieldRow>
          <FieldRow label="رقم الواتساب" htmlFor="support-whatsapp" hint="اتركه فارغاً لاستخدام رقم خدمة العملاء.">
            <Input
              id="support-whatsapp"
              type="tel"
              inputMode="tel"
              dir="ltr"
              placeholder="0501234567"
              value={form.supportWhatsapp}
              onChange={(event) => setField("supportWhatsapp", event.target.value)}
            />
          </FieldRow>
          <SaveBar
            pending={updateSettings.isPending}
            onSave={() =>
              saveSettings(["supportEmail", "supportPhone", "supportWhatsapp"], "تم حفظ بيانات التواصل")
            }
          />
        </SettingsCard>

        <SettingsCard
          id="content"
          icon={ScrollText}
          title="إدارة المحتوى والسياسات"
          description="أي نص تكتبه هنا يستبدل النص الجاهز في صفحته. الحقل الفارغ يعني الاعتماد على النص الأصلي."
        >
          <FieldRow label="الشروط والأحكام" htmlFor="terms-text">
            <Textarea
              id="terms-text"
              rows={5}
              value={form.termsText}
              onChange={(event) => setField("termsText", event.target.value)}
            />
          </FieldRow>
          <FieldRow label="سياسة الخصوصية" htmlFor="privacy-text">
            <Textarea
              id="privacy-text"
              rows={5}
              value={form.privacyText}
              onChange={(event) => setField("privacyText", event.target.value)}
            />
          </FieldRow>
          <FieldRow label="سياسة الاسترجاع" htmlFor="refund-text">
            <Textarea
              id="refund-text"
              rows={5}
              value={form.refundText}
              onChange={(event) => setField("refundText", event.target.value)}
            />
          </FieldRow>
          <FieldRow label="سياسة المحتوى" htmlFor="content-policy-text">
            <Textarea
              id="content-policy-text"
              rows={5}
              value={form.contentPolicyText}
              onChange={(event) => setField("contentPolicyText", event.target.value)}
            />
          </FieldRow>
          <SaveBar
            pending={updateSettings.isPending}
            onSave={() =>
              saveSettings(
                ["termsText", "privacyText", "refundText", "contentPolicyText"],
                "تم حفظ المحتوى",
              )
            }
          />
        </SettingsCard>

        <SettingsCard
          id="session"
          icon={LogOut}
          title="تسجيل الخروج"
          description="إنهاء جلسة الإدارة على هذا الجهاز."
        >
          <Button
            type="button"
            variant="outline"
            className="gap-2"
            onClick={handleSignOut}
            disabled={signingOut}
          >
            {signingOut ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogOut className="w-4 h-4" />}
            تسجيل الخروج
          </Button>
        </SettingsCard>
      </div>
    </AppLayout>
  );
}
