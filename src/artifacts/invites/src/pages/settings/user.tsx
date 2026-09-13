import { useEffect, useState } from "react";
import { Link } from "wouter";
import {
  User,
  Bell,
  Crown,
  Phone,
  FileText,
  LogOut,
  Trash2,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import { format } from "date-fns";
import { ar } from "date-fns/locale";
import { AppLayout } from "@/components/layout/app-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import {
  useDeleteMyAccount,
  useGetDashboardSummary,
  useListTemplates,
  useUpdateMyProfile,
  type ContactMethod,
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

const CONTACT_METHOD_OPTIONS = [
  { value: "both", label: "اتصال وواتساب" },
  { value: "whatsapp", label: "واتساب فقط" },
  { value: "call", label: "اتصال فقط" },
];

/** تاريخ غير صالح في قاعدة البيانات لا يجب أن يُسقط الصفحة */
function safeDate(value: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDay(value: string | null): string {
  const parsed = safeDate(value);
  return parsed ? format(parsed, "dd MMMM yyyy", { locale: ar }) : "—";
}

/**
 * إعدادات المستخدم العادي.
 * لا يحتوي هذا الملف أي خيار إداري: التوجيه في index يمنع تحميله
 * للأدمن والعكس، وأي عمود حسّاس محمي في قاعدة البيانات أصلاً.
 */
export default function UserSettings({ me }: { me: Me }) {
  const { toast } = useToast();
  const { signOut } = useAuth();
  const updateProfile = useUpdateMyProfile();
  const deleteAccount = useDeleteMyAccount();
  const { data: summary } = useGetDashboardSummary();
  const { data: templates } = useListTemplates();

  const [name, setName] = useState(me.name);
  const [contactPhone, setContactPhone] = useState(me.defaultContactPhone);
  const [contactMethod, setContactMethod] = useState<ContactMethod>(me.defaultContactMethod);
  const [templateId, setTemplateId] = useState(String(me.defaultTemplateId ?? ""));
  const [inviteNote, setInviteNote] = useState(me.defaultInviteNote);
  const [confirmText, setConfirmText] = useState("");
  const [signingOut, setSigningOut] = useState(false);

  // مزامنة الحقول عند وصول بيانات محدّثة من الخادم دون دهس ما يكتبه المستخدم
  useEffect(() => { setName(me.name); }, [me.name]);
  useEffect(() => { setContactPhone(me.defaultContactPhone); }, [me.defaultContactPhone]);
  useEffect(() => { setContactMethod(me.defaultContactMethod); }, [me.defaultContactMethod]);
  useEffect(() => { setTemplateId(String(me.defaultTemplateId ?? "")); }, [me.defaultTemplateId]);
  useEffect(() => { setInviteNote(me.defaultInviteNote); }, [me.defaultInviteNote]);

  const save = (patch: Parameters<typeof updateProfile.mutate>[0], successTitle: string) => {
    updateProfile.mutate(patch, {
      onSuccess: () => toast({ title: successTitle }),
      onError: (error: Error) =>
        toast({ title: "تعذّر الحفظ", description: error.message, variant: "destructive" }),
    });
  };

  const handleSignOut = async () => {
    setSigningOut(true);
    await signOut();
    window.location.href = import.meta.env.BASE_URL;
  };

  const handleDelete = () => {
    deleteAccount.mutate(undefined, {
      onSuccess: async () => {
        await signOut();
        window.location.href = import.meta.env.BASE_URL;
      },
      onError: (error: Error) =>
        toast({ title: "تعذّر حذف الحساب", description: error.message, variant: "destructive" }),
    });
  };

  const isPaid = me.plan === "paid";
  const planEnd = safeDate(me.planEndDate);
  const planExpired = isPaid && planEnd !== null && planEnd.getTime() < Date.now();
  const usedEvents = summary?.eventsCount ?? 0;
  const limitLabel = me.eventsLimit === null ? "غير محدود" : String(me.eventsLimit);
  const templateOptions = [
    { value: "", label: "بدون قالب افتراضي" },
    ...(templates ?? []).map((template) => ({ value: String(template.id), label: template.name })),
  ];
  return (
    <AppLayout>
      <div className="p-5 md:p-10 max-w-3xl mx-auto space-y-6">
        <header>
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900">الإعدادات</h1>
          <p className="text-gray-600 mt-1">بياناتك وتفضيلاتك وإعدادات دعواتك الافتراضية.</p>
        </header>

        <SettingsCard
          id="profile"
          icon={User}
          title="البيانات الشخصية"
          description="الاسم الذي يظهر لك داخل الحساب."
        >
          <FieldRow label="الاسم" htmlFor="settings-name">
            <Input
              id="settings-name"
              autoComplete="name"
              value={name}
              maxLength={80}
              onChange={(event) => setName(event.target.value)}
            />
          </FieldRow>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-gray-500">نوع الحساب</p>
              <p className="font-medium text-gray-800 mt-0.5">مستخدم</p>
            </div>
            <div>
              <p className="text-gray-500">تاريخ الانضمام</p>
              <p className="font-medium text-gray-800 mt-0.5">{formatDay(me.createdAt)}</p>
            </div>
          </div>
          <SaveBar
            pending={updateProfile.isPending}
            disabled={name.trim() === me.name || name.trim().length < 2}
            onSave={() => save({ name }, "تم تحديث الاسم")}
          />
        </SettingsCard>

        <AccountSecurityCard currentEmail={me.email} />

        <SettingsCard
          id="plan"
          icon={Crown}
          title="الباقة الحالية"
          description="حالة اشتراكك والحد المتاح للمناسبات."
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className={`text-sm font-bold px-3 py-1 rounded-full ${isPaid ? "bg-gold/15 text-gold-deep" : "bg-gray-100 text-gray-700"}`}>
              {isPaid ? "الباقة الماسية" : "الباقة المجانية"}
            </span>
            <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${planExpired ? "bg-red-50 text-red-600" : "bg-emerald-50 text-emerald-700"}`}>
              {planExpired ? "منتهية" : "سارية"}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-gray-500">المناسبات المستخدمة</p>
              <p className="font-medium text-gray-800 mt-0.5">{usedEvents} من {limitLabel}</p>
            </div>
            <div>
              <p className="text-gray-500">{isPaid ? "تنتهي في" : "تجديد تلقائي"}</p>
              <p className="font-medium text-gray-800 mt-0.5">{isPaid ? formatDay(me.planEndDate) : "لا ينتهي"}</p>
            </div>
          </div>
          <div className="pt-3 border-t border-gray-100">
            <Link
              href="/subscription"
              className="inline-flex items-center gap-2 bg-ink text-gold-light px-5 py-2.5 rounded-md font-medium hover:bg-ink-soft transition-colors"
            >
              <Crown className="w-4 h-4" />
              إدارة الاشتراك والترقية
            </Link>
          </div>
        </SettingsCard>
        <SettingsCard
          id="notifications"
          icon={Bell}
          title="الإشعارات والتذكيرات"
          description="تظهر هذه التنبيهات في لوحة المعلومات، ويُحفظ كل تغيير فوراً."
        >
          <ToggleRow
            label="تذكيرات المناسبات"
            description="تنبيه قبل موعد كل مناسبة قادمة."
            checked={me.notifyReminders}
            onCheckedChange={(value) => save({ notifyReminders: value }, "تم تحديث التذكيرات")}
            disabled={updateProfile.isPending}
          />
          <div className="pr-4 border-r-2 border-gray-100 space-y-4">
            <ToggleRow
              label="تذكير قبل 24 ساعة"
              checked={me.reminder24h}
              onCheckedChange={(value) => save({ reminder24h: value }, "تم تحديث التذكير")}
              disabled={!me.notifyReminders || updateProfile.isPending}
            />
            <ToggleRow
              label="تذكير قبل 3 ساعات"
              checked={me.reminder3h}
              onCheckedChange={(value) => save({ reminder3h: value }, "تم تحديث التذكير")}
              disabled={!me.notifyReminders || updateProfile.isPending}
            />
          </div>
          <div className="pt-4 border-t border-gray-100">
            <ToggleRow
              label="تنبيه من لم يرد بعد"
              description="يعرض عدد المدعوين الذين لم يسجلوا ردهم في كل مناسبة قادمة."
              checked={me.notifyRsvp}
              onCheckedChange={(value) => save({ notifyRsvp: value }, "تم تحديث التنبيهات")}
              disabled={updateProfile.isPending}
            />
          </div>
        </SettingsCard>

        <SettingsCard
          id="invite-defaults"
          icon={FileText}
          title="إعدادات الدعوات الافتراضية"
          description="تُطبَّق تلقائياً على كل دعوة جديدة، ويمكنك تغييرها لكل مناسبة على حدة."
        >
          <FieldRow
            label="القالب الافتراضي"
            htmlFor="settings-template"
            hint="يُحدَّد مسبقاً عند إنشاء دعوة جديدة."
          >
            <SelectInput
              id="settings-template"
              value={templateId}
              onChange={setTemplateId}
              options={templateOptions}
            />
          </FieldRow>
          <FieldRow
            label="نص افتراضي لوصف الدعوة"
            htmlFor="settings-invite-note"
            hint="يُكتب مسبقاً في حقل الوصف عند إنشاء دعوة جديدة. 500 حرف كحد أعلى."
          >
            <Textarea
              id="settings-invite-note"
              rows={3}
              maxLength={500}
              value={inviteNote}
              onChange={(event) => setInviteNote(event.target.value)}
            />
          </FieldRow>
          <SaveBar
            pending={updateProfile.isPending}
            disabled={
              templateId === String(me.defaultTemplateId ?? "") &&
              inviteNote.trim() === me.defaultInviteNote
            }
            onSave={() =>
              save(
                {
                  defaultTemplateId: templateId ? Number(templateId) : null,
                  defaultInviteNote: inviteNote,
                },
                "تم حفظ إعدادات الدعوات",
              )
            }
          />
        </SettingsCard>
        <SettingsCard
          id="contact"
          icon={Phone}
          title="رقم التواصل الظاهر في الدعوات"
          description="يظهر للمدعو في صفحة الدعوة للاستفسار، ويُستخدم تلقائياً في كل دعوة جديدة."
        >
          <FieldRow
            label="رقم التواصل"
            htmlFor="settings-contact-phone"
            hint="اتركه فارغاً إذا لا تريد إظهار أي رقم. مثال: 0501234567"
          >
            <Input
              id="settings-contact-phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              dir="ltr"
              placeholder="0501234567"
              value={contactPhone}
              onChange={(event) => setContactPhone(event.target.value)}
            />
          </FieldRow>
          <FieldRow label="طريقة التواصل" htmlFor="settings-contact-method">
            <SelectInput
              id="settings-contact-method"
              value={contactMethod}
              onChange={(value) => setContactMethod(value as ContactMethod)}
              options={CONTACT_METHOD_OPTIONS}
            />
          </FieldRow>
          <SaveBar
            pending={updateProfile.isPending}
            disabled={
              contactPhone.trim() === me.defaultContactPhone &&
              contactMethod === me.defaultContactMethod
            }
            onSave={() =>
              save(
                { defaultContactPhone: contactPhone, defaultContactMethod: contactMethod },
                "تم حفظ رقم التواصل",
              )
            }
          />
        </SettingsCard>

        <SettingsCard
          id="session"
          icon={LogOut}
          title="تسجيل الخروج"
          description="إنهاء الجلسة على هذا الجهاز."
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

        <SettingsCard
          id="danger"
          icon={Trash2}
          tone="danger"
          title="حذف الحساب"
          description="إجراء نهائي لا يمكن التراجع عنه."
        >
          <div className="flex gap-3 bg-red-50 border border-red-100 rounded-xl p-4">
            <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
            <div className="text-sm text-red-800 leading-relaxed">
              سيُحذف حسابك مع كل مناسباتك وقوائم المدعوين والردود، وتتوقف روابط
              الدعوات التي أرسلتها عن العمل. لا توجد طريقة لاستعادة هذه البيانات.
            </div>
          </div>
          <FieldRow
            label="اكتب كلمة حذف للتأكيد"
            htmlFor="settings-delete-confirm"
            hint="خطوة مقصودة حتى لا يُحذف الحساب بلمسة خاطئة."
          >
            <Input
              id="settings-delete-confirm"
              value={confirmText}
              autoComplete="off"
              placeholder="حذف"
              onChange={(event) => setConfirmText(event.target.value)}
            />
          </FieldRow>
          <Button
            type="button"
            variant="destructive"
            className="gap-2"
            disabled={confirmText.trim() !== "حذف" || deleteAccount.isPending}
            onClick={handleDelete}
          >
            {deleteAccount.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Trash2 className="w-4 h-4" />
            )}
            حذف حسابي نهائياً
          </Button>
        </SettingsCard>
      </div>
    </AppLayout>
  );
}
