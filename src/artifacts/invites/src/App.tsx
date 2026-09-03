import { lazy, Suspense } from "react";
import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/lib/auth";
import { useGetMe } from "@/lib/api";

// صفحات محمّلة مباشرة: الواجهة العامة وصفحة الدعوة — أخف مسار ممكن
import Home from "@/pages/home";
import PublicInvite from "@/pages/invite/index";
import NotFound from "@/pages/not-found";
import SignInPage from "@/pages/auth/sign-in";
import SignUpPage from "@/pages/auth/sign-up";

/**
 * [م-4] تقسيم على مستوى المسار.
 * سابقاً كانت الحزمة ملفاً واحداً بحجم 884 KB، أي أن كل مدعو يفتح رابط
 * دعوة على شبكة جوال كان ينزّل لوحة الإدارة والرسوم البيانية بالكامل.
 */
const Dashboard          = lazy(() => import("@/pages/dashboard"));
const EventsList         = lazy(() => import("@/pages/events/index"));
const EventForm          = lazy(() => import("@/pages/events/form"));
const EventDetail        = lazy(() => import("@/pages/events/detail"));
const SubscriptionPage   = lazy(() => import("@/pages/subscription"));
const AdminPage          = lazy(() => import("@/pages/admin/index"));
const TermsPage          = lazy(() => import("@/pages/policies/terms"));
const PrivacyPage        = lazy(() => import("@/pages/policies/privacy"));
const RefundPage         = lazy(() => import("@/pages/policies/refund"));
const ContentPolicyPage  = lazy(() => import("@/pages/policies/content-policy"));
const HelpPage           = lazy(() => import("@/pages/help/index"));
const ForgotPasswordPage = lazy(() => import("@/pages/auth/forgot-password"));
const ResetPasswordPage  = lazy(() => import("@/pages/auth/reset-password"));

const queryClient = new QueryClient();
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function RoleLoader() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-gray-50">
      <Loader2 className="h-8 w-8 animate-spin text-gold" />
    </div>
  );
}

function RoleBasedHome() {
  const { data: user, isLoading } = useGetMe();
  if (isLoading) return <RoleLoader />;
  return <Redirect to={user?.role === "admin" ? "/admin" : "/dashboard"} />;
}

function HomeRedirect() {
  const { user, isLoaded } = useAuth();
  if (!isLoaded) return <RoleLoader />;
  return user ? <RoleBasedHome /> : <Home />;
}

/**
 * [م-1] حارس واحد مسطّح.
 *
 * سابقاً كان AdminRoute يمرّر دالة سهمية مجهولة إلى ProtectedRoute،
 * فتُنشأ بهوية جديدة في كل رندر ويرى React مكوّناً مختلفاً — فيفكّك
 * الشجرة ويعيد تركيبها: فقدان حالة النماذج ووميض شاشة التحميل
 * وإعادة جلب غير ضرورية. هنا الحارس مكوّن ثابت واحد.
 *
 * `requiredRole` تُطبَّق في الواجهة للتوجيه فقط؛ الحماية الحقيقية
 * مفروضة في قاعدة البيانات عبر RLS وسياسات الأدمن.
 */
function ProtectedRoute({
  component: Component,
  requiredRole,
}: {
  component: React.ComponentType;
  requiredRole?: "admin" | "user";
}) {
  const { user, isLoaded } = useAuth();
  const { data: me, isLoading: isLoadingMe } = useGetMe();

  if (!isLoaded) return <RoleLoader />;
  if (!user) return <Redirect to="/" />;

  if (requiredRole) {
    if (isLoadingMe) return <RoleLoader />;
    if (requiredRole === "admin" && me?.role !== "admin") {
      return <Redirect to="/dashboard" />;
    }
    if (requiredRole === "user" && me?.role === "admin") {
      // الأدمن يدير الاشتراكات ولا يشترك
      return <Redirect to="/admin" />;
    }
  }

  return <Component />;
}

function AppRoutes() {
  return (
    <TooltipProvider>
      <Suspense fallback={<RoleLoader />}>
      <Switch>
        <Route path="/" component={HomeRedirect} />
        <Route path="/sign-in" component={SignInPage} />
        <Route path="/sign-up" component={SignUpPage} />
        <Route path="/forgot-password" component={ForgotPasswordPage} />
        <Route path="/reset-password" component={ResetPasswordPage} />

        {/* Static pages (public) */}
        <Route path="/terms" component={TermsPage} />
        <Route path="/privacy" component={PrivacyPage} />
        <Route path="/refund" component={RefundPage} />
        <Route path="/content-policy" component={ContentPolicyPage} />
        <Route path="/help" component={HelpPage} />

        {/* Protected Routes */}
        <Route path="/dashboard"><ProtectedRoute component={Dashboard} /></Route>
        <Route path="/events"><ProtectedRoute component={EventsList} /></Route>
        <Route path="/events/new"><ProtectedRoute component={EventForm} /></Route>
        <Route path="/events/:id/edit"><ProtectedRoute component={EventForm} /></Route>
        <Route path="/events/:id"><ProtectedRoute component={EventDetail} /></Route>
        <Route path="/subscription"><ProtectedRoute component={SubscriptionPage} requiredRole="user" /></Route>
        <Route path="/admin"><ProtectedRoute component={AdminPage} requiredRole="admin" /></Route>

        {/* Public Invite Route */}
        <Route path="/invite/:slug" component={PublicInvite} />

        <Route component={NotFound} />
      </Switch>
      </Suspense>
      <Toaster />
    </TooltipProvider>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </QueryClientProvider>
    </WouterRouter>
  );
}

export default App;
