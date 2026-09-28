import { useMemo, useState } from "react";
import { format } from "date-fns";
import { Loader2, Users } from "lucide-react";
import { Input } from "@/components/ui/input";
import { formatPhoneForDisplay, useListAdminGuests, type AttendanceStatus, type InviteStatus } from "@/lib/api";
import { formatGuestNameForDisplay, isPhoneLikeName } from "@/lib/phone";

const ATTENDANCE: Record<AttendanceStatus, { label: string; cls: string }> = {
  pending: { label: "لم يرد", cls: "bg-gray-100 text-gray-700" },
  attending: { label: "سيحضر", cls: "bg-emerald-100 text-emerald-800" },
  maybe: { label: "محتمل", cls: "bg-amber-100 text-amber-800" },
  declined: { label: "معتذر", cls: "bg-red-100 text-red-800" },
};

const INVITE: Record<InviteStatus, string> = {
  pending: "بانتظار الإرسال",
  prepared: "جُهّزت",
  sent: "أُرسلت",
  no_response: "بلا رد",
};

/** كل مدعوي المنصة مع الإحصائيات — الأدمن فقط يرى هذه البيانات (RLS) */
export function AdminGuests() {
  const { data: guests, isLoading, error } = useListAdminGuests();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | AttendanceStatus>("all");

  const list = guests ?? [];
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const digits = q.replace(/\D/g, "");
    return list.filter((g) => {
      if (filter !== "all" && g.attendanceStatus !== filter) return false;
      if (!q) return true;
      return (
        g.name.toLowerCase().includes(q) ||
        g.eventTitle.toLowerCase().includes(q) ||
        (digits.length >= 3 && g.phone.replace(/\D/g, "").includes(digits))
      );
    });
  }, [list, search, filter]);

  const stats = useMemo(() => {
    const count = (s: AttendanceStatus) => list.filter((g) => g.attendanceStatus === s).length;
    return {
      total: list.length,
      sent: list.filter((g) => g.inviteStatus === "sent").length,
      attending: count("attending"),
      maybe: count("maybe"),
      declined: count("declined"),
      pending: count("pending"),
    };
  }, [list]);

  const filters: Array<{ value: "all" | AttendanceStatus; label: string }> = [
    { value: "all", label: "الكل (" + stats.total + ")" },
    { value: "attending", label: "سيحضر (" + stats.attending + ")" },
    { value: "maybe", label: "محتمل (" + stats.maybe + ")" },
    { value: "declined", label: "معتذر (" + stats.declined + ")" },
    { value: "pending", label: "لم يرد (" + stats.pending + ")" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-gold-deep" />
          <h2 className="text-xl font-bold text-gray-900">جميع المدعوين</h2>
          <span className="text-sm text-gray-600">— أُرسلت {stats.sent} من {stats.total}</span>
        </div>
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="بحث بالاسم أو الجوال أو المناسبة..."
          className="max-w-xs"
        />
      </div>
      <div className="flex flex-wrap gap-2">
        {filters.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setFilter(f.value)}
            className={
              "rounded-full border px-3 py-1 text-xs font-medium " +
              (filter === f.value ? "border-gold bg-gold/10 text-gray-900" : "border-gray-200 text-gray-600 hover:border-gold/60")
            }
          >
            {f.label}
          </button>
        ))}
      </div>
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error instanceof Error ? error.message : "تعذر تحميل المدعوين"}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-right text-sm">
          <thead className="bg-gray-50 font-medium text-gray-600">
            <tr>
              <th className="px-4 py-3">الاسم</th>
              <th className="px-4 py-3">الجوال</th>
              <th className="px-4 py-3">المناسبة</th>
              <th className="px-4 py-3">الدعوة</th>
              <th className="px-4 py-3">الرد</th>
              <th className="px-4 py-3">أُضيف</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading ? (
              <tr><td colSpan={6} className="px-4 py-10 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin text-gray-400" /></td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-500">لا نتائج</td></tr>
            ) : (
              rows.slice(0, 500).map((g) => (
                <tr key={g.id}>
                  <td className="px-4 py-2 font-medium text-gray-900">
                    {isPhoneLikeName(g.name) ? <span dir="ltr">{formatGuestNameForDisplay(g.name)}</span> : g.name}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-gray-700" dir="ltr">{formatPhoneForDisplay(g.phone)}</td>
                  <td className="px-4 py-2 text-gray-700">
                    {g.eventTitle}
                    {g.eventDate && <span className="block text-xs text-gray-500">{format(new Date(g.eventDate), "yyyy/MM/dd")}</span>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-xs text-gray-700">{INVITE[g.inviteStatus]}</td>
                  <td className="px-4 py-2">
                    <span className={"whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-bold " + ATTENDANCE[g.attendanceStatus].cls}>
                      {ATTENDANCE[g.attendanceStatus].label}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-xs text-gray-500">
                    {g.createdAt ? format(new Date(g.createdAt), "yyyy/MM/dd") : "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        {rows.length > 500 && (
          <p className="px-4 py-2 text-xs text-gray-500">يُعرض أول 500 — ضيّق البحث لرؤية البقية.</p>
        )}
      </div>
    </div>
  );
}
