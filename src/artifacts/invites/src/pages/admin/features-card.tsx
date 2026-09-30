import { useEffect, useState } from "react";
import { ToggleLeft } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import {
  FEATURE_DEFAULTS,
  FEATURE_LABELS,
  IOS_SHORTCUT_NAME,
  useUpdateAppSettings,
  type AppSettings,
  type FeatureFlags,
  type FeatureKey,
} from "@/lib/api";
import { FieldRow, SaveBar, SettingsCard, ToggleRow } from "../settings/parts";

/**
 * تفعيل/تعطيل ميزات المنصة. تُخزَّن في app_settings.feature_flags (jsonb)
 * ولا يعدّلها إلا الأدمن بسياسة RLS. الواجهة تقرأها عبر useFeature.
 */
export function FeaturesCard({ settings }: { settings: AppSettings }) {
  const { toast } = useToast();
  const updateSettings = useUpdateAppSettings();
  const [flags, setFlags] = useState<FeatureFlags>(settings.featureFlags ?? FEATURE_DEFAULTS);
  /** رابط iCloud لاختصار الآيفون «Dawaat – Contacts» (يُعرض لمستخدمي سفاري لتثبيته مرة واحدة) */
  const [shortcutUrl, setShortcutUrl] = useState(settings.iosShortcutUrl ?? "");

  useEffect(() => {
    setFlags(settings.featureFlags ?? FEATURE_DEFAULTS);
  }, [settings.featureFlags]);
  useEffect(() => {
    setShortcutUrl(settings.iosShortcutUrl ?? "");
  }, [settings.iosShortcutUrl]);

  const trimmedShortcutUrl = shortcutUrl.trim();
  const shortcutUrlValid =
    trimmedShortcutUrl === "" || /^https:\/\/(www\.)?icloud\.com\/shortcuts\/[A-Za-z0-9]+\/?$/i.test(trimmedShortcutUrl);

  const dirty =
    (Object.keys(FEATURE_DEFAULTS) as FeatureKey[]).some(
      (key) => flags[key] !== (settings.featureFlags?.[key] ?? FEATURE_DEFAULTS[key]),
    ) || trimmedShortcutUrl !== (settings.iosShortcutUrl ?? "");

  const save = () =>
    updateSettings.mutate(
      { featureFlags: flags, iosShortcutUrl: trimmedShortcutUrl },
      {
        onSuccess: () => toast({ title: "تم حفظ مفاتيح الميزات" }),
        onError: (error: Error) =>
          toast({ title: "تعذّر الحفظ", description: error.message, variant: "destructive" }),
      },
    );

  return (
    <SettingsCard
      id="features"
      icon={ToggleLeft}
      title="تفعيل/تعطيل الميزات"
      description="الميزة المعطّلة تختفي من الواجهة لكل المستخدمين فوراً."
    >
      {(Object.keys(FEATURE_LABELS) as FeatureKey[]).map((key) => (
        <ToggleRow
          key={key}
          label={FEATURE_LABELS[key].label}
          description={FEATURE_LABELS[key].hint}
          checked={flags[key]}
          onCheckedChange={(value) => setFlags((prev) => ({ ...prev, [key]: value }))}
        />
      ))}
      {flags.contacts_import && (
        <FieldRow
          label="رابط اختصار الآيفون (iCloud)"
          htmlFor="ios-shortcut-url"
          hint={
            "يظهر لمستخدمي سفاري زر «إضافة اختصار دعوات» بهذا الرابط. أنشئ الاختصار باسم «" +
            IOS_SHORTCUT_NAME +
            "» على آيفون ثم شاركه ← نسخ رابط iCloud (الخطوات في README). فارغ = يُعرض شرح فقط بلا زر."
          }
        >
          <Input
            id="ios-shortcut-url"
            dir="ltr"
            inputMode="url"
            placeholder="https://www.icloud.com/shortcuts/…"
            value={shortcutUrl}
            onChange={(event) => setShortcutUrl(event.target.value)}
            aria-invalid={!shortcutUrlValid}
            data-testid="ios-shortcut-url"
          />
          {!shortcutUrlValid && (
            <p className="text-xs text-red-600">الرابط يجب أن يكون رابط مشاركة اختصار من iCloud: https://www.icloud.com/shortcuts/…</p>
          )}
        </FieldRow>
      )}
      <SaveBar
        pending={updateSettings.isPending}
        disabled={!dirty || !shortcutUrlValid}
        onSave={save}
        label="حفظ الميزات"
      />
    </SettingsCard>
  );
}
