import { Link } from "wouter";
import { AlertTriangle, Crown, ListChecks } from "lucide-react";
import { useGetMe, useListEvents } from "@/lib/api";

/**
 * حصة الدعوات للحساب الحالي كما تفرضها قاعدة البيانات
 * (تريجر enforce_events_limit: profiles.events_limit، وnull = بلا حد، والأدمن بلا حد).
 * الحساب هنا للعرض والإرشاد فقط — الرفض الفعلي يبقى في قاعدة البيانات.
 */
export function useEventQuota() {
  const { data: me, isLoading: loadingMe } = useGetMe();
  const { data: events, isLoading: loadingEvents } = useListEvents();
  const used = events?.length ?? 0;
  const limit = me?.role === "admin" ? null : (me?.eventsLimit ?? null);
  const reached = limit !== null && used >= limit;
  return {
    used,
    limit,
    reached,
    isLoading: loadingMe || loadingEvents,
    isAdmin: me?.role === "admin",
    plan: me?.plan ?? "free",
  };
}

function eventsWord(n: number): string {
  if (n === 1) return "دعوة واحدة";
  if (n === 2) return "دعوتين";
  if (n >= 3 && n <= 10) return n + " دعوات";
  return n + " دعوة";
}

interface EventQuotaNoticeProps {
  /**
   * inline: شريط تنبيه فوق قائمة الدعوات.
   * block: بطاقة كاملة تحل محل نموذج الإنشاء.
   */
  variant?: "inline" | "block";
  className?: string;
}

/**
 * يُعرض فقط عندما يصل الحساب إلى حد باقته، حتى لا يملأ المستخدم النموذج
 * بخطواته الثلاث ثم تُرفض الدعوة عند الحفظ.
 */
export function EventQuotaNotice({ variant = "inline", className = "" }: EventQuotaNoticeProps) {
  const quota = useEventQuota();
  if (quota.isLoading || !quota.reached || quota.limit === null) return null;

  const title = "وصلت إلى حد باقتك: " + eventsWord(quota.limit);
  const body =
    "باقتك الحالية تسمح بـ" +
    eventsWord(quota.limit) +
    " وقد استخدمتها كلها (" +
    quota.used +
    " من " +
    quota.limit +
    "). لن تُحفظ أي دعوة جديدة حتى تحذف إحدى دعواتك الحالية أو ترقّي إلى الباقة الماسية.";

  const actions = (
    <div className="flex flex-wrap gap-2">
      {!quota.isAdmin && (
        <Link
          href="/subscription"
          className="inline-flex items-center gap-1.5 rounded-md bg-gold px-4 py-2 text-sm font-bold text-black hover:bg-gold/90"
          data-testid="quota-upgrade"
        >
          <Crown className="h-4 w-4" /> ترقية الباقة
        </Link>
      )}
      <Link
        href="/events"
        className="inline-flex items-center gap-1.5 rounded-md border border-line bg-white px-4 py-2 text-sm font-medium text-gray-800 hover:bg-cream-2"
        data-testid="quota-manage"
      >
        <ListChecks className="h-4 w-4" /> إدارة دعواتي
      </Link>
    </div>
  );

  if (variant === "block") {
    return (
      <div
        role="alert"
        data-testid="event-quota-block"
        className={"rounded-2xl border border-amber-200 bg-amber-50 p-6 text-right " + className}
      >
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-6 w-6 shrink-0 text-amber-600" />
          <div className="space-y-3">
            <h2 className="text-lg font-bold text-amber-900">{title}</h2>
            <p className="text-sm leading-relaxed text-amber-900/90">{body}</p>
            {actions}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      role="status"
      data-testid="event-quota-inline"
      className={
        "flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-right sm:flex-row sm:items-center sm:justify-between " +
        className
      }
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
        <div>
          <p className="text-sm font-bold text-amber-900">{title}</p>
          <p className="text-xs leading-relaxed text-amber-900/80">{body}</p>
        </div>
      </div>
      {!quota.isAdmin && (
        <Link
          href="/subscription"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-gold px-4 py-2 text-sm font-bold text-black hover:bg-gold/90"
          data-testid="quota-upgrade"
        >
          <Crown className="h-4 w-4" /> ترقية الباقة
        </Link>
      )}
    </div>
  );
}
