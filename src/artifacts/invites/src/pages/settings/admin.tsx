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
  Banknote,
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
import { AnnouncementsCard } from "./announcements-card";

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
export type AdminCardId =
  | "stats" | "profile" | "security" | "users" | "send-fee" | "templates"
  | "invites" | "notifications" | "announcements" | "site" | "support" | "content" | "session";

interface AdminSettingsProps {
  me: Me;
  /** البطاقات المعروضة — الافتراضي الكل */
  only?: AdminCardId[];
  /** داخل لوحة الأدمن: بلا تخطيط الصفحة ولا العنوان */
  embedded?: boolean;
}

export default function AdminSettings({ me, only, embedded = false }: AdminSettingsProps) {
  const show = (id: AdminCardId) => !only || only.includes(id);
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
  const createTemplate = useCreateTemplate();
  const updateTemplate = useUpdateTemplate();
  const deleteTemplate = useDeleteTemplate();

  const [name, setName] = useState(me.name);
  const [form, setForm] = useState<AppSettings | null>(null);
  const [search, setSearch] = useState("");
  const [visibleUsers, setVisibleUsers] = useState(10);
  const [drafts, setDrafts] = useState<Record<string, UserDraft>>({});
  const [savingUserId, setSavingUserId] = useState<string | null>(null);
  const [confirmTemplateId, setConfirmTemplateId] = useState<number | null>(null);
  const [newTemplate, setNewTemplate] = useState({ name: "", category: "general", previewImage: "" });
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => { setName(me.name); }, [me.name]);
  useEffect(() => { if (settings) setForm(settings); }, [settings]);
  useEffect(() => {
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
    const loader = (
      <div className="flex justify-center py-32">
        <Loader2 className="w-8 h-8 animate-spin text-gold" />
      </div>
    );
    return embedded ? loader : <AppLayout>{loader}</AppLayout>;
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

  const body = (
      <div className={embedded ? "space-y-6" : "p-5 md:p-10 max-w-4xl mx-auto space-y-6"}>
        {!embedded && (
        <header>
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900">إعدادات الحساب</h1>
          <p className="text-gray-600 mt-1">
            بيانات حسابك وأمانه. إدارة المنصة كاملة من{" "}
            <a href="/admin" className="text-gold-deep underline">لوحة التحكم</a>.
          </p>
        </header>
        )}

        {show("stats") && (
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
        )}

        {show("profile") && (
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
        )}

        {show("security") && <AccountSecurityCard currentEmail={me.email} />}
        {show("users") && (
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
        )}
        {show("send-fee") && (
        <SettingsCard
          id="send-fee"
          icon={Banknote}
          title="رسوم إرسال الدعوات"
          description="السعر تراكمي: الأساس + ما يضيفه العميل من مزايا. اترك الكل 0 ليكون الإرسال مجانياً بلا شاشة دفع."
        >
          <div className="grid grid-cols-2 gap-3">
            <FieldRow
              label="الأساس (ريال)"
              htmlFor="fee-base"
              hint="لكل مناسبة. أقل من 5 لا يقبله الدفع بالبطاقة — الحد الأدنى لفاتورة بيلينك."
            >
              <Input
                id="fee-base"
                type="number" inputMode="decimal" min={0} max={100000} step="0.01" dir="ltr"
                value={String(form.feeBaseAmount)}
                onChange={(event) => setField("feeBaseAmount", Math.max(0, Number(event.target.value) || 0))}
              />
            </FieldRow>
            <FieldRow label="العملة" htmlFor="send-fee-currency">
              <Input
                id="send-fee-currency"
                dir="ltr"
                maxLength={8}
                value={form.sendFeeCurrency}
                onChange={(event) => setField("sendFeeCurrency", event.target.value.toUpperCase())}
              />
            </FieldRow>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <FieldRow label="+ صورة الغلاف" htmlFor="fee-cover">
              <Input
                id="fee-cover"
                type="number" inputMode="decimal" min={0} max={100000} step="0.01" dir="ltr"
                value={String(form.feeCoverImageAmount)}
                onChange={(event) => setField("feeCoverImageAmount", Math.max(0, Number(event.target.value) || 0))}
              />
            </FieldRow>
            <FieldRow label="+ التسجيل الصوتي" htmlFor="fee-audio">
              <Input
                id="fee-audio"
                type="number" inputMode="decimal" min={0} max={100000} step="0.01" dir="ltr"
                value={String(form.feeAudioAmount)}
                onChange={(event) => setField("feeAudioAmount", Math.max(0, Number(event.target.value) || 0))}
              />
            </FieldRow>
            <FieldRow label="+ القالب المميز" htmlFor="fee-template">
              <Input
                id="fee-template"
                type="number" inputMode="decimal" min={0} max={100000} step="0.01" dir="ltr"
                value={String(form.feeTemplateAmount)}
                onChange={(event) => setField("feeTemplateAmount", Math.max(0, Number(event.target.value) || 0))}
              />
            </FieldRow>
          </div>
          <p className="text-xs text-gray-500 leading-relaxed" data-testid="fee-example">
            مثال: مناسبة فيها صورة وتسجيل صوتي ={" "}
            <span className="font-medium text-gray-800" dir="rtl">
              {form.feeBaseAmount + form.feeCoverImageAmount + form.feeAudioAmount} {form.sendFeeCurrency === "SAR" ? "ريال" : form.sendFeeCurrency}
            </span>
          </p>
          <SaveBar
            pending={updateSettings.isPending}
            onSave={() =>
              saveSettings(
                ["feeBaseAmount", "feeCoverImageAmount", "feeAudioAmount", "feeTemplateAmount", "sendFeeCurrency"],
                "تم حفظ الأسعار",
              )
            }
            label="حفظ الأسعار"
            note={
              form.feeBaseAmount > 0
                ? "الإرسال مقفل لكل مناسبة حتى يُسدَّد مبلغها كاملاً. من أضاف ميزة مسعَّرة بعد الدفع يُطالَب بالفرق."
                : "الأساس صفر: الإرسال مفتوح بلا شاشة دفع ما لم تُسعَّر ميزة أخرى."
            }
          />

          <div className="pt-4 border-t border-gray-100 space-y-4">
            <ToggleRow
              label="الدفع بالبطاقة"
              description="يظهر للعميل زر «ادفع بالبطاقة» ويُفتح الإرسال فور نجاح الدفع بلا مراجعة. يتطلب ضبط مفاتيح المزوّد في Cloudflare."
              checked={form.paymentGatewayEnabled}
              onCheckedChange={(value) => setField("paymentGatewayEnabled", value)}
            />
            <div className="grid grid-cols-2 gap-3">
              <FieldRow
                label="اسم المزوّد كما يظهر للعميل"
                htmlFor="gateway-name"
                hint="مثل: بيلينك أو ميسر. يظهر في شاشة الدفع فقط."
              >
                <Input
                  id="gateway-name"
                  maxLength={40}
                  value={form.paymentGatewayName}
                  onChange={(event) => setField("paymentGatewayName", event.target.value)}
                  placeholder="ميسر"
                />
              </FieldRow>
              <FieldRow
                label="أقل مبلغ يقبله المزوّد"
                htmlFor="gateway-min"
                hint="بيلينك ٥ ريالات، ميسر ريال واحد. دونه يُعرض التحويل البنكي وحده."
              >
                <Input
                  id="gateway-min"
                  type="number" inputMode="decimal" min={0} max={100000} step="0.01" dir="ltr"
                  value={String(form.paymentGatewayMinAmount)}
                  onChange={(event) =>
                    setField("paymentGatewayMinAmount", Math.max(0, Number(event.target.value) || 0))
                  }
                />
              </FieldRow>
            </div>
            <SaveBar
              pending={updateSettings.isPending}
              onSave={() =>
                saveSettings(
                  ["paymentGatewayEnabled", "paymentGatewayName", "paymentGatewayMinAmount"],
                  "تم حفظ إعداد بوابة الدفع",
                )
              }
              label="حفظ البوابة"
              note={
                form.paymentGatewayEnabled
                  ? "العميل يرى «ادفع بالبطاقة» والتحويل البنكي معاً."
                  : "البوابة مطفأة: التحويل البنكي وحده."
              }
            />
          </div>

          <div className="pt-4 border-t border-gray-100 space-y-5">
            <p className="text-sm text-gray-700 leading-relaxed">
              التحويل البنكي: يحوّل العميل ثم يرفع الإثبات، وتراجعه الإدارة من
              لوحة التحكم ← تبويب «المدفوعات». هذه البيانات تظهر للمستخدم في شاشة الدفع.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <FieldRow label="اسم البنك" htmlFor="bank-name">
                <Input
                  id="bank-name"
                  value={form.bankName}
                  onChange={(event) => setField("bankName", event.target.value)}
                  placeholder="مثال: مصرف الراجحي"
                />
              </FieldRow>
              <FieldRow label="اسم المستفيد" htmlFor="bank-account-name">
                <Input
                  id="bank-account-name"
                  value={form.bankAccountName}
                  onChange={(event) => setField("bankAccountName", event.target.value)}
                />
              </FieldRow>
            </div>
            <FieldRow label="الآيبان (IBAN)" htmlFor="bank-iban">
              <Input
                id="bank-iban"
                dir="ltr"
                className="font-mono"
                maxLength={40}
                value={form.bankIban}
                onChange={(event) => setField("bankIban", event.target.value.toUpperCase())}
                placeholder="SA00 0000 0000 0000 0000 0000"
              />
            </FieldRow>
            <FieldRow
              label="تعليمات إضافية للدفع"
              htmlFor="payment-instructions"
              hint="اختياري — مثل: اكتب اسم المناسبة في وصف التحويل."
            >
              <Textarea
                id="payment-instructions"
                rows={3}
                value={form.paymentInstructions}
                onChange={(event) => setField("paymentInstructions", event.target.value)}
              />
            </FieldRow>
            <SaveBar
              pending={updateSettings.isPending}
              onSave={() =>
                saveSettings(
                  ["bankName", "bankAccountName", "bankIban", "paymentInstructions"],
                  "تم حفظ بيانات التحويل",
                )
              }
              label="حفظ بيانات التحويل"
            />
          </div>
        </SettingsCard>
        )}

        {show("templates") && (
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
        )}
        {show("invites") && (
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
        )}

        {show("notifications") && (
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
        )}

        {show("announcements") && <AnnouncementsCard settings={settings ?? form} />}

        {show("site") && (
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
        )}
        {show("support") && (
        <SettingsCard
          id="support"
          icon={Mail}
          title="معلومات التواصل"
          description="تظهر في قسم تواصل معنا بالقائمة الجانبية وفي صفحة المساعدة، وأي تعديل ينعكس عند جميع العملاء."
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
          <FieldRow label="حساب سناب شات" htmlFor="support-snapchat" hint="اسم المستخدم فقط بدون @ وبدون رابط.">
            <Input
              id="support-snapchat"
              dir="ltr"
              placeholder="yf.343"
              value={form.supportSnapchat}
              onChange={(event) => setField("supportSnapchat", event.target.value)}
            />
          </FieldRow>
          <SaveBar
            pending={updateSettings.isPending}
            onSave={() =>
              saveSettings(["supportEmail", "supportPhone", "supportWhatsapp", "supportSnapchat"], "تم حفظ بيانات التواصل")
            }
          />
        </SettingsCard>
        )}

        {show("content") && (
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
        )}

        {show("session") && (
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
        )}
      </div>
  );
  return embedded ? body : <AppLayout>{body}</AppLayout>;
}
