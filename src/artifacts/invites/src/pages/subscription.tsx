import { AppLayout } from "@/components/layout/app-layout";
import { useToast } from "@/hooks/use-toast";
import { useUpgradeSubscription, useGetMe, useGetDashboardSummary } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Check, Star, Loader2, Crown, Sparkles, MessageCircle, Users, Calendar, Upload, Music, Image, BarChart3, Palette } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetSubscriptionQueryKey, getGetMeQueryKey } from "@/lib/api";

const FREE_FEATURES = [
  { icon: Calendar,      label: "إنشاء مناسبة واحدة" },
  { icon: Users,         label: "إضافة المدعوين" },
  { icon: MessageCircle, label: "إرسال الدعوات عبر واتساب" },
  { icon: Check,         label: "متابعة حالة الردود" },
  { icon: Upload,        label: "استخدام القوالب المجانية" },
];

const PRO_EXTRAS = [
  { icon: Music,    label: "تسجيل صوتي للدعوة" },
  { icon: Image,    label: "إضافة صور وألبومات" },
  { icon: BarChart3,label: "إحصائيات متقدمة" },
  { icon: Palette,  label: "تخصيصات متقدمة للقالب" },
  { icon: Calendar, label: "مناسبات غير محدودة" },
  { icon: Sparkles, label: "إزالة شعار الموقع" },
];

export default function SubscriptionPage() {
  const { data: user, isLoading } = useGetMe();
  const { data: summary } = useGetDashboardSummary();
  const upgradeSub = useUpgradeSubscription();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const isPro = user?.plan === "paid";
  const usedEvents = summary?.eventsCount ?? 0;
  const limit = user?.eventsLimit ?? 1;   // الباقة المجانية = مناسبة واحدة

  /**
   * بوابة الدفع غير جاهزة بعد.
   *
   * الدالة القديمة كانت تمنح الباقة المدفوعة فوراً بلا أي دفع، ولو
   * فُعّلت كما هي لأمكن لأي مستخدم استدعاؤها من الـ API مباشرة
   * والحصول على مناسبات غير محدودة مجاناً. لذلك أُوقفت في قاعدة
   * البيانات، ويعرض الزر هنا رسالة صريحة بدل استدعاء فاشل.
   */
  const PAYMENT_READY = false;

  const handleUpgrade = () => {
    if (!PAYMENT_READY) {
      toast({
        title: "الاشتراك المدفوع غير متاح حالياً",
        description: "نعمل على تفعيل الدفع قريباً. للترقية الآن تواصل معنا وسنفعّلها لك يدوياً.",
      });
      return;
    }
    upgradeSub.mutate(undefined, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetSubscriptionQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
      },
      onError: () => {
        toast({
          title: "تعذّر إتمام الترقية",
          description: "حاول لاحقاً أو تواصل معنا.",
          variant: "destructive",
        });
      },
    });
  };

  if (isLoading) {
    return (
      <AppLayout>
        <div className="flex justify-center py-32">
          <Loader2 className="w-8 h-8 animate-spin text-gold" />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="p-6 md:p-10 max-w-4xl mx-auto space-y-10">

        {/* Header */}
        <div className="text-center max-w-xl mx-auto">
          <h1 className="text-3xl md:text-4xl font-bold text-gray-900 mb-3">باقتك</h1>
          <p className="text-gray-600 text-lg">
            ابدأ مجاناً — الأساسيات متاحة دائماً، وطوّر تجربتك متى أردت.
          </p>
        </div>

        {/* Current usage card (free only) */}
        {!isPro && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 mb-1">مناسباتك هذا الشهر</p>
              <div className="flex items-center gap-3">
                <div className="h-2 w-48 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gold rounded-full transition-all"
                    style={{ width: `${Math.min((usedEvents / limit) * 100, 100)}%` }}
                  />
                </div>
                <span className="text-sm font-medium text-gray-700">{usedEvents} / {limit}</span>
              </div>
            </div>
            <div className="text-sm text-gray-400">الباقة المجانية</div>
          </div>
        )}

        {/* Plans grid */}
        <div className="grid md:grid-cols-2 gap-8">

          {/* Free plan */}
          <div className={`bg-white rounded-2xl border-2 p-8 relative flex flex-col ${!isPro ? "border-ink shadow-lg" : "border-gray-100"}`}>
            {!isPro && (
              <span className="absolute -top-3 right-1/2 translate-x-1/2 bg-ink text-white text-xs font-bold px-3 py-1 rounded-full">
                باقتك الحالية
              </span>
            )}
            <h3 className="text-2xl font-bold text-gray-900 mb-1">المجانية</h3>
            <p className="text-gray-400 text-sm mb-5">كل ما تحتاجه للبدء</p>
            <div className="mb-6">
              <span className="text-4xl font-bold text-gray-900">مجانًا</span>
              <span className="text-gray-400 text-sm mr-2">للأبد</span>
            </div>
            <ul className="space-y-3 mb-8 flex-1">
              {FREE_FEATURES.map(({ icon: Icon, label }) => (
                <li key={label} className="flex items-center gap-3 text-gray-700">
                  <div className="w-7 h-7 rounded-full bg-emerald-50 flex items-center justify-center shrink-0">
                    <Icon className="w-3.5 h-3.5 text-emerald-600" />
                  </div>
                  {label}
                </li>
              ))}
            </ul>
            <Button className="w-full bg-gray-100 text-gray-600 hover:bg-gray-100 cursor-default" disabled>
              {isPro ? "الانتقال للمجانية" : "باقتك الحالية ✓"}
            </Button>
          </div>

          {/* Pro plan */}
          <div className={`bg-ink rounded-2xl border-2 p-8 relative flex flex-col text-white ${isPro ? "border-gold shadow-xl shadow-gold/10" : "border-transparent"}`}>
            {isPro && (
              <span className="absolute -top-3 right-1/2 translate-x-1/2 bg-gold text-black text-xs font-bold px-3 py-1 rounded-full flex items-center gap-1">
                <Star className="w-3 h-3 fill-current" /> باقتك الحالية
              </span>
            )}
            <h3 className="text-2xl font-bold text-gold mb-1 font-serif">الماسية</h3>
            <p className="text-gray-400 text-sm mb-5">كل شيء في المجانية، ويزيد</p>
            <div className="mb-6">
              <span className="text-4xl font-bold text-white">299</span>
              <span className="text-gray-400 text-sm mr-2">ريال / سنة</span>
            </div>
            <ul className="space-y-3 mb-8 flex-1">
              <li className="flex items-center gap-3 text-gray-300 text-sm font-medium pb-2 border-b border-white/10">
                <Check className="w-4 h-4 text-gold" />
                كل مزايا الباقة المجانية
              </li>
              {PRO_EXTRAS.map(({ icon: Icon, label }) => (
                <li key={label} className="flex items-center gap-3 text-gray-300">
                  <div className="w-7 h-7 rounded-full bg-gold/10 flex items-center justify-center shrink-0">
                    <Icon className="w-3.5 h-3.5 text-gold" />
                  </div>
                  {label}
                </li>
              ))}
            </ul>
            <Button
              className={`w-full font-bold ${isPro ? "bg-white/10 text-white hover:bg-white/20" : "bg-gold text-black hover:bg-gold/90"}`}
              onClick={handleUpgrade}
              disabled={isPro || upgradeSub.isPending}
            >
              {upgradeSub.isPending ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : isPro ? (
                "مفعّلة ✓"
              ) : !PAYMENT_READY ? (
                "قريباً — تواصل معنا للترقية"
              ) : (
                "ترقية الحساب"
              )}
            </Button>
          </div>
        </div>

        {/* Bottom note */}
        {!isPro && (
          <p className="text-center text-sm text-gray-400">
            لا حاجة لبطاقة ائتمانية · يمكنك الترقية في أي وقت
          </p>
        )}
      </div>
    </AppLayout>
  );
}
