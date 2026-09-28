import { useMemo } from "react";
import { format } from "date-fns";
import { BarChart3, Loader2 } from "lucide-react";
import {
  useListAdminEvents,
  useListAdminGuests,
  useListAdminPayments,
  useListAdminUsers,
} from "@/lib/api";
import { formatFee } from "@/components/send-payment-dialog";

/** مفتاح الشهر yyyy-MM لتجميع الأرقام */
function monthKey(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : format(d, "yyyy-MM");
}

/** آخر ستة أشهر بالترتيب الزمني */
function lastMonths(count: number): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let i = count - 1; i >= 0; i--) {
    out.push(format(new Date(now.getFullYear(), now.getMonth() - i, 1), "yyyy-MM"));
  }
  return out;
}

function MonthTable({
  title,
  rows,
  columns,
}: {
  title: string;
  rows: string[];
  columns: Array<{ label: string; value: (month: string) => string | number }>;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-100">
      <table className="w-full text-right text-sm">
        <caption className="bg-gray-50 px-4 py-2 text-right text-sm font-bold text-gray-900">{title}</caption>
        <thead className="text-xs text-gray-600">
          <tr>
            <th className="px-4 py-2">الشهر</th>
            {columns.map((c) => (
              <th key={c.label} className="px-4 py-2">{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((month) => (
            <tr key={month}>
              <td className="px-4 py-2 text-gray-700" dir="ltr">{month}</td>
              {columns.map((c) => (
                <td key={c.label} className="px-4 py-2 font-medium text-gray-900">{c.value(month)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * تقارير الاستخدام — محسوبة من البيانات التي لا يراها إلا الأدمن (RLS):
 * التسجيلات والمناسبات والمدعوون والردود والمدفوعات شهرياً.
 */
export function UsageReports() {
  const users = useListAdminUsers();
  const events = useListAdminEvents();
  const guests = useListAdminGuests();
  const payments = useListAdminPayments();

  const months = useMemo(() => lastMonths(6), []);

  const data = useMemo(() => {
    const count = <T,>(list: T[] | undefined, key: (item: T) => string | null) => {
      const map = new Map<string, number>();
      for (const item of list ?? []) {
        const k = key(item);
        if (k) map.set(k, (map.get(k) ?? 0) + 1);
      }
      return map;
    };
    const signups = count(users.data, (u) => monthKey(u.createdAt));
    const newEvents = count(events.data, (e) => monthKey(e.createdAt));
    const newGuests = count(guests.data, (g) => monthKey(g.createdAt));
    const paid = (payments.data ?? []).filter((p) => p.status === "paid" && p.method !== "free");
    const revenue = new Map<string, number>();
    for (const p of paid) {
      const k = monthKey(p.paidAt);
      if (k) revenue.set(k, (revenue.get(k) ?? 0) + p.amount);
    }
    const paidCount = count(paid, (p) => monthKey(p.paidAt));

    const allGuests = guests.data ?? [];
    const responded = allGuests.filter((g) => g.attendanceStatus !== "pending").length;
    const sent = allGuests.filter((g) => g.inviteStatus === "sent").length;
    const totals = {
      users: users.data?.length ?? 0,
      paidUsers: (users.data ?? []).filter((u) => u.plan === "paid").length,
      events: events.data?.length ?? 0,
      guests: allGuests.length,
      sent,
      responded,
      attending: allGuests.filter((g) => g.attendanceStatus === "attending").length,
      revenue: paid.reduce((s, p) => s + p.amount, 0),
      currency: paid[0]?.currency ?? "SAR",
      awaitingReview: (payments.data ?? []).filter((p) => p.status === "submitted").length,
    };
    return { signups, newEvents, newGuests, revenue, paidCount, totals };
  }, [users.data, events.data, guests.data, payments.data]);

  const loading = users.isLoading || events.isLoading || guests.isLoading || payments.isLoading;
  if (loading) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    );
  }

  const t = data.totals;
  const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) + "٪" : "—");
  const tiles = [
    { label: "إجمالي المستخدمين", value: t.users },
    { label: "الباقات المدفوعة", value: t.paidUsers + " (" + pct(t.paidUsers, t.users) + ")" },
    { label: "إجمالي المناسبات", value: t.events },
    { label: "إجمالي المدعوين", value: t.guests },
    { label: "دعوات مُرسلة", value: t.sent + " (" + pct(t.sent, t.guests) + ")" },
    { label: "ردّ المدعوون", value: t.responded + " (" + pct(t.responded, t.guests) + ")" },
    { label: "مؤكدو الحضور", value: t.attending },
    { label: "إيرادات رسوم الإرسال", value: formatFee(t.revenue, t.currency) },
    { label: "مدفوعات بانتظار المراجعة", value: t.awaitingReview },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <BarChart3 className="h-5 w-5 text-gold-deep" />
        <h2 className="text-xl font-bold text-gray-900">تقارير الاستخدام</h2>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {tiles.map((tile) => (
          <div key={tile.label} className="rounded-xl border border-gray-100 bg-white p-4">
            <p className="text-xs text-gray-600">{tile.label}</p>
            <p className="mt-1 text-xl font-bold text-gray-900">{tile.value}</p>
          </div>
        ))}
      </div>
      <MonthTable
        title="النشاط الشهري — آخر 6 أشهر"
        rows={months}
        columns={[
          { label: "تسجيلات جديدة", value: (m) => data.signups.get(m) ?? 0 },
          { label: "مناسبات جديدة", value: (m) => data.newEvents.get(m) ?? 0 },
          { label: "مدعوون مضافون", value: (m) => data.newGuests.get(m) ?? 0 },
          { label: "مدفوعات مؤكدة", value: (m) => data.paidCount.get(m) ?? 0 },
          { label: "الإيرادات", value: (m) => formatFee(data.revenue.get(m) ?? 0, t.currency) },
        ]}
      />
    </div>
  );
}
