import { Suspense, lazy } from "react";
import { Loader2, ShieldAlert } from "lucide-react";
import { AppLayout } from "@/components/layout/app-layout";
import { useGetMe } from "@/lib/api";

/**
 * صفحة واحدة ومحتوى مختلف حسب role.
 *
 * خيارات الأدمن لا تُخفى بالتنسيق: ملف إعدادات الأدمن مقسوم في حزمة
 * منفصلة لا ينزّلها المتصفح إلا لحساب أدمن فعلاً، وكل عملية إدارية
 * محميّة فوق ذلك بسياسات RLS ودوال تتحقق من الصلاحية.
 */
const UserSettings = lazy(() => import("./user"));
const AdminSettings = lazy(() => import("./admin"));

function SettingsLoader() {
  return (
    <AppLayout>
      <div className="flex justify-center py-32">
        <Loader2 className="w-8 h-8 animate-spin text-gold" />
      </div>
    </AppLayout>
  );
}

export default function SettingsPage() {
  const { data: me, isLoading, isError } = useGetMe();

  if (isLoading) return <SettingsLoader />;

  if (isError || !me) {
    return (
      <AppLayout>
        <div className="p-6 md:p-10 max-w-md mx-auto">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8 text-center">
            <ShieldAlert className="w-10 h-10 text-gold mx-auto mb-4" />
            <h1 className="text-lg font-bold text-gray-900">تعذّر تحميل الإعدادات</h1>
            <p className="text-sm text-gray-600 mt-2 leading-relaxed">
              لم نتمكن من قراءة بيانات حسابك. تحقق من الاتصال ثم أعد تحديث الصفحة.
            </p>
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <Suspense fallback={<SettingsLoader />}>
      {me.role === "admin" ? <AdminSettings me={me} /> : <UserSettings me={me} />}
    </Suspense>
  );
}
