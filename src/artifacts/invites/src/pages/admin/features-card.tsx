import { useEffect, useState } from "react";
import { ToggleLeft } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  FEATURE_DEFAULTS,
  FEATURE_LABELS,
  useUpdateAppSettings,
  type AppSettings,
  type FeatureFlags,
  type FeatureKey,
} from "@/lib/api";
import { SaveBar, SettingsCard, ToggleRow } from "../settings/parts";

/**
 * تفعيل/تعطيل ميزات المنصة. تُخزَّن في app_settings.feature_flags (jsonb)
 * ولا يعدّلها إلا الأدمن بسياسة RLS. الواجهة تقرأها عبر useFeature.
 */
export function FeaturesCard({ settings }: { settings: AppSettings }) {
  const { toast } = useToast();
  const updateSettings = useUpdateAppSettings();
  const [flags, setFlags] = useState<FeatureFlags>(settings.featureFlags ?? FEATURE_DEFAULTS);

  useEffect(() => {
    setFlags(settings.featureFlags ?? FEATURE_DEFAULTS);
  }, [settings.featureFlags]);

  const dirty = (Object.keys(FEATURE_DEFAULTS) as FeatureKey[]).some(
    (key) => flags[key] !== (settings.featureFlags?.[key] ?? FEATURE_DEFAULTS[key]),
  );

  const save = () =>
    updateSettings.mutate(
      { featureFlags: flags },
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
      <SaveBar pending={updateSettings.isPending} disabled={!dirty} onSave={save} label="حفظ الميزات" />
    </SettingsCard>
  );
}
