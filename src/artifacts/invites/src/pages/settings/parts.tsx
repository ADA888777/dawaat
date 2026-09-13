import { useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Loader2, Mail, KeyRound, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";

/**
 * عناصر مشتركة بين إعدادات المستخدم وإعدادات الأدمن.
 * كل حقل هنا مبني ليعمل على الجوال: منطقة لمس مريحة، ولوحة مفاتيح
 * مناسبة لنوع الإدخال، وسمات autoComplete حتى يعمل مدير كلمات المرور.
 */

export function SettingsCard({
  id,
  icon: Icon,
  title,
  description,
  tone = "default",
  children,
}: {
  id?: string;
  icon: LucideIcon;
  title: string;
  description?: string;
  tone?: "default" | "danger";
  children: ReactNode;
}) {
  const danger = tone === "danger";
  return (
    <section
      id={id}
      className={`scroll-mt-24 bg-white rounded-2xl border shadow-sm ${danger ? "border-red-200" : "border-gray-100"}`}
    >
      <header className="flex items-start gap-3 p-5 border-b border-gray-100">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${danger ? "bg-red-50" : "bg-gold/10"}`}>
          <Icon className={`w-5 h-5 ${danger ? "text-red-600" : "text-gold"}`} />
        </div>
        <div className="min-w-0">
          <h2 className={`font-bold text-lg leading-tight ${danger ? "text-red-700" : "text-gray-900"}`}>{title}</h2>
          {description ? (
            <p className="text-sm text-gray-500 mt-1 leading-relaxed">{description}</p>
          ) : null}
        </div>
      </header>
      <div className="p-5 space-y-5">{children}</div>
    </section>
  );
}

export function FieldRow({
  label,
  htmlFor,
  hint,
  children,
}: { label: string; htmlFor?: string; hint?: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={htmlFor} className="text-gray-800">{label}</Label>
      {children}
      {hint ? <p className="text-xs text-gray-500 leading-relaxed">{hint}</p> : null}
    </div>
  );
}

export function ToggleRow({
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onCheckedChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className={`flex items-start justify-between gap-4 ${disabled ? "opacity-60" : ""}`}>
      <div className="min-w-0">
        <p className="font-medium text-gray-800">{label}</p>
        {description ? (
          <p className="text-sm text-gray-500 mt-0.5 leading-relaxed">{description}</p>
        ) : null}
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        className="mt-1 shrink-0"
      />
    </div>
  );
}

/**
 * قائمة اختيار أصلية بدل قائمة مخصّصة: على iPhone وAndroid يفتح
 * المتصفح منتقي النظام فيسهل الاختيار بالإبهام، وحجم الخط 16px
 * حتى لا يقرّب iOS الصفحة تلقائياً عند اللمس.
 */
export function SelectInput({
  id,
  value,
  onChange,
  options,
  disabled,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
}) {
  return (
    <select
      id={id}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      className="w-full h-11 rounded-md border border-gray-200 bg-white px-3 text-base text-gray-900 focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold disabled:opacity-60"
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  );
}

export function SaveBar({
  pending,
  onSave,
  disabled,
  label = "حفظ التغييرات",
  note,
}: {
  pending: boolean;
  onSave: () => void;
  disabled?: boolean;
  label?: string;
  note?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 pt-3 border-t border-gray-100">
      <Button
        type="button"
        onClick={onSave}
        disabled={pending || disabled}
        className="bg-ink text-gold-light hover:bg-ink-soft gap-2 min-w-36"
      >
        {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
        {label}
      </Button>
      {note ? <span className="text-xs text-gray-500">{note}</span> : null}
    </div>
  );
}

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;

/**
 * البريد وكلمة المرور — مشتركة بين الحساب العادي وحساب الأدمن.
 * تغيير البريد يتطلب تأكيداً من العنوان الجديد، وتغيير كلمة المرور
 * يتطلب كلمة المرور الحالية: جلسة مفتوحة على جهاز غير مقفل لا تكفي.
 */
export function AccountSecurityCard({ currentEmail }: { currentEmail: string }) {
  const { toast } = useToast();
  const [newEmail, setNewEmail] = useState("");
  const [emailPending, setEmailPending] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordPending, setPasswordPending] = useState(false);

  const submitEmail = async () => {
    const value = newEmail.trim().toLowerCase();
    if (!EMAIL_PATTERN.test(value)) {
      toast({ title: "البريد الإلكتروني غير صالح", variant: "destructive" });
      return;
    }
    if (value === currentEmail.trim().toLowerCase()) {
      toast({ title: "هذا هو بريدك الحالي بالفعل" });
      return;
    }
    setEmailPending(true);
    const { error } = await supabase.auth.updateUser({ email: value });
    setEmailPending(false);
    if (error) {
      toast({ title: "تعذّر تغيير البريد", description: error.message, variant: "destructive" });
      return;
    }
    setNewEmail("");
    toast({
      title: "أرسلنا رابط التأكيد",
      description: "افتح الرسالة في بريدك الجديد لإكمال التغيير. بريد الدخول لن يتغيّر قبل ذلك.",
    });
  };

  const submitPassword = async () => {
    if (!currentPassword) {
      toast({ title: "أدخل كلمة المرور الحالية", variant: "destructive" });
      return;
    }
    if (newPassword.length < 8) {
      toast({ title: "كلمة المرور الجديدة يجب أن تكون 8 أحرف على الأقل", variant: "destructive" });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({ title: "كلمتا المرور غير متطابقتين", variant: "destructive" });
      return;
    }
    if (newPassword === currentPassword) {
      toast({ title: "كلمة المرور الجديدة مطابقة للحالية", variant: "destructive" });
      return;
    }
    setPasswordPending(true);
    const check = await supabase.auth.signInWithPassword({
      email: currentEmail,
      password: currentPassword,
    });
    if (check.error) {
      setPasswordPending(false);
      toast({ title: "كلمة المرور الحالية غير صحيحة", variant: "destructive" });
      return;
    }
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setPasswordPending(false);
    if (error) {
      toast({ title: "تعذّر تغيير كلمة المرور", description: error.message, variant: "destructive" });
      return;
    }
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    toast({ title: "تم تغيير كلمة المرور" });
  };
  return (
    <>
      <SettingsCard
        id="email"
        icon={Mail}
        title="البريد الإلكتروني"
        description="بريدك هو اسم الدخول. تغييره يحتاج تأكيداً من العنوان الجديد."
      >
        <FieldRow label="البريد الحالي">
          <Input value={currentEmail} readOnly dir="ltr" className="bg-gray-50 text-gray-600" />
        </FieldRow>
        <FieldRow
          label="البريد الجديد"
          htmlFor="settings-new-email"
          hint="سيصلك رابط تأكيد على العنوان الجديد، ولن يُستبدل بريد الدخول قبل فتحه."
        >
          <Input
            id="settings-new-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            dir="ltr"
            placeholder="name@example.com"
            value={newEmail}
            onChange={(event) => setNewEmail(event.target.value)}
          />
        </FieldRow>
        <SaveBar
          pending={emailPending}
          onSave={submitEmail}
          disabled={!newEmail.trim()}
          label="تحديث البريد"
        />
      </SettingsCard>

      <SettingsCard
        id="password"
        icon={KeyRound}
        title="كلمة المرور"
        description="نتحقق من كلمة المرور الحالية قبل أي تغيير."
      >
        <FieldRow label="كلمة المرور الحالية" htmlFor="settings-current-password">
          <Input
            id="settings-current-password"
            type="password"
            autoComplete="current-password"
            dir="ltr"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
          />
        </FieldRow>
        <FieldRow
          label="كلمة المرور الجديدة"
          htmlFor="settings-new-password"
          hint="8 أحرف على الأقل."
        >
          <Input
            id="settings-new-password"
            type="password"
            autoComplete="new-password"
            dir="ltr"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
          />
        </FieldRow>
        <FieldRow label="تأكيد كلمة المرور الجديدة" htmlFor="settings-confirm-password">
          <Input
            id="settings-confirm-password"
            type="password"
            autoComplete="new-password"
            dir="ltr"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
          />
        </FieldRow>
        <SaveBar
          pending={passwordPending}
          onSave={submitPassword}
          disabled={!currentPassword || !newPassword || !confirmPassword}
          label="تغيير كلمة المرور"
        />
      </SettingsCard>
    </>
  );
}
