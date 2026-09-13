import { AppLayout } from "@/components/layout/app-layout";
import { useGetDashboardSummary, useListNotifications } from "@/lib/api";
import { Calendar, Users, CheckCircle, Bell, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { ar } from "date-fns/locale";
import { Link } from "wouter";

export default function Dashboard() {
  const { data: summary, isLoading: isLoadingSummary } = useGetDashboardSummary();
  const { data: notifications, isLoading: isLoadingNotifs } = useListNotifications();

  return (
    <AppLayout>
      <div className="p-6 md:p-10 max-w-7xl mx-auto space-y-8">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">نظرة عامة</h1>
            <p className="text-gray-600 mt-1">ملخص نشاط دعواتك وإحصائيات الحضور</p>
          </div>
          <Link href="/events/new" className="bg-ink text-gold-light px-6 py-2.5 rounded-md font-medium hover:bg-ink-soft transition-colors shadow-md">
            إنشاء دعوة جديدة
          </Link>
        </div>

        {isLoadingSummary ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-gold" />
          </div>
        ) : summary ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm flex items-center gap-4">
              <div className="w-14 h-14 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center">
                <Calendar className="w-7 h-7" />
              </div>
              <div>
                <p className="text-sm text-gray-600 font-medium">إجمالي الدعوات</p>
                <p className="text-3xl font-bold text-gray-900">{summary.eventsCount}</p>
              </div>
            </div>
            
            <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm flex items-center gap-4">
              <div className="w-14 h-14 bg-purple-50 text-purple-600 rounded-full flex items-center justify-center">
                <Users className="w-7 h-7" />
              </div>
              <div>
                <p className="text-sm text-gray-600 font-medium">إجمالي المدعوين</p>
                <p className="text-3xl font-bold text-gray-900">{summary.guestsCount}</p>
              </div>
            </div>

            <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm flex items-center gap-4">
              <div className="w-14 h-14 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center">
                <CheckCircle className="w-7 h-7" />
              </div>
              <div>
                <p className="text-sm text-gray-600 font-medium">المؤكد حضورهم</p>
                <p className="text-3xl font-bold text-gray-900">{summary.confirmedCount}</p>
              </div>
            </div>
          </div>
        ) : null}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-6">
            <h2 className="text-xl font-bold text-gray-900">أقرب المناسبات</h2>
            {summary?.upcomingEvents && summary.upcomingEvents.length > 0 ? (
              <div className="space-y-4">
                {summary.upcomingEvents.map((event) => (
                  <Link key={event.id} href={`/events/${event.id}`}>
                    <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow flex items-center justify-between cursor-pointer">
                      <div className="flex items-center gap-6">
                        <div className="w-16 h-16 bg-gray-50 rounded-lg flex flex-col items-center justify-center text-gold-deep border border-gray-100">
                          <span className="text-xs font-medium">{format(new Date(event.eventDate), 'MMM', { locale: ar })}</span>
                          <span className="text-xl font-bold">{format(new Date(event.eventDate), 'dd')}</span>
                        </div>
                        <div>
                          <h3 className="font-bold text-lg text-gray-900">{event.title}</h3>
                          <p className="text-sm text-gray-600 mt-1">{event.location}</p>
                        </div>
                      </div>
                      <div className="text-center bg-gray-50 px-4 py-2 rounded-md">
                        <p className="text-xs text-gray-600 mb-1">المؤكدين</p>
                        <p className="font-bold text-emerald-600 text-lg">{event.attendingCount} / {event.guestsCount}</p>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="bg-white rounded-xl border border-gray-100 border-dashed p-10 text-center">
                <Calendar className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                <p className="text-gray-600">لا يوجد مناسبات قادمة</p>
                <Link href="/events/new" className="text-gold-deep font-medium mt-2 inline-block">أنشئ مناسبتك الأولى</Link>
              </div>
            )}
          </div>

          <div className="space-y-6">
            <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
              <Bell className="w-5 h-5 text-gold" />
              التنبيهات
            </h2>
            
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
              {isLoadingNotifs ? (
                <div className="flex justify-center py-10">
                  <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
                </div>
              ) : notifications && notifications.length > 0 ? (
                <div className="space-y-4">
                  {notifications.map((notif, idx) => (
                    <div key={idx} className="flex gap-4 p-3 rounded-lg hover:bg-gray-50 transition-colors">
                      <div className={`mt-1 w-2 h-2 rounded-full ${notif.reminderType === "rsvp" ? "bg-blue-400" : "bg-gold"}`} />
                      <div>
                        <p className="text-sm text-gray-900 font-medium">
                          {notif.reminderType === "24h"
                          ? "تبقّى 24 ساعة على "
                          : notif.reminderType === "3h"
                            ? "تبقّى 3 ساعات على "
                            : "لم يرد بعد " + (notif.pendingCount ?? 0) + " من مدعويك في "}
                          {notif.eventTitle}
                        </p>
                        <p className="text-xs text-gray-600 mt-1">
                          {format(new Date(notif.eventDate), 'dd MMMM yyyy - hh:mm a', { locale: ar })}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-10 text-center text-gray-600 text-sm">
                  لا توجد تنبيهات حالياً
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
