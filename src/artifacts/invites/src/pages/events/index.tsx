import { appUrl } from "@/lib/supabase";
import { useState } from "react";
import { AppLayout } from "@/components/layout/app-layout";
import { useListEvents, useDeleteEvent } from "@/lib/api";
import { Link } from "wouter";
import { Loader2, Plus, Settings2, Trash2, Link as LinkIcon, Edit, Users, Eye, Calendar } from "lucide-react";
import { format } from "date-fns";
import { ar } from "date-fns/locale";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { useQueryClient } from "@tanstack/react-query";
import { getListEventsQueryKey } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { ConfirmDialog } from "@/components/confirm-dialog";

export default function EventsList() {
  const { data: events, isLoading } = useListEvents();
  const deleteEvent = useDeleteEvent();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // [ن-1] حوار داخل التطبيق بدل confirm()
  const [eventToDelete, setEventToDelete] = useState<number | null>(null);

  const handleDelete = (id: number) => setEventToDelete(id);

  const confirmDelete = () => {
    if (eventToDelete === null) return;
    deleteEvent.mutate(
      { id: eventToDelete },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListEventsQueryKey() });
          setEventToDelete(null);
          toast({ title: "تم حذف الدعوة" });
        },
        onError: (err) => {
          setEventToDelete(null);
          toast({
            title: "تعذر حذف الدعوة",
            description: err instanceof Error ? err.message : undefined,
            variant: "destructive",
          });
        },
      }
    );
  };

  // [م-7] يحترم BASE_URL و VITE_APP_URL بدل origin وحده
  const copyLink = async (slug: string) => {
    const origin =
      appUrl.replace(/\/$/, "");
    const url = `${origin}/invite/${slug}`;
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: "تم نسخ رابط الدعوة" });
    } catch {
      // clipboard يفشل بلا HTTPS أو بلا إذن — لا نترك المستخدم بلا رابط
      toast({
        title: "تعذر النسخ تلقائياً",
        description: url,
        variant: "destructive",
      });
    }
  };

  return (
    <AppLayout>
      <div className="p-6 md:p-10 max-w-7xl mx-auto space-y-8">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">دعواتي</h1>
            <p className="text-gray-600 mt-1">إدارة جميع الدعوات والمناسبات الخاصة بك</p>
          </div>
          <Link href="/events/new" className="bg-ink text-gold-light px-6 py-2.5 rounded-md font-medium hover:bg-ink-soft transition-colors shadow-md flex items-center gap-2">
            <Plus className="w-5 h-5" />
            إنشاء دعوة جديدة
          </Link>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-32">
            <Loader2 className="w-8 h-8 animate-spin text-gold" />
          </div>
        ) : events && events.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {events.map(event => (
              <div key={event.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden hover:shadow-lg transition-shadow group flex flex-col">
                <div className="h-40 bg-gray-100 relative">
                  {event.coverImage ? (
                    <img src={event.coverImage} alt={event.title} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-ink text-gold-light">
                      <span className="font-serif text-2xl opacity-50">دعوات</span>
                    </div>
                  )}
                  <div className="absolute top-3 right-3 bg-black/60 backdrop-blur text-white text-xs px-3 py-1 rounded-full">
                    {format(new Date(event.eventDate), 'dd MMMM yyyy', { locale: ar })}
                  </div>
                </div>
                
                <div className="p-5 flex-1 flex flex-col">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h3 className="font-bold text-xl text-gray-900 mb-1">{event.title}</h3>
                      <p className="text-sm text-gray-600">{event.location}</p>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="-mr-2 text-gray-600 hover:text-gray-900">
                          <Settings2 className="w-5 h-5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-48">
                        <DropdownMenuItem asChild>
                          <Link href={`/events/${event.id}/edit`} className="flex items-center gap-2 cursor-pointer w-full">
                            <Edit className="w-4 h-4" /> تعديل الدعوة
                          </Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => copyLink(event.shareSlug)} className="flex items-center gap-2 cursor-pointer">
                          <LinkIcon className="w-4 h-4" /> نسخ الرابط
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => window.open(`/invite/${event.shareSlug}`, '_blank')} className="flex items-center gap-2 cursor-pointer">
                          <Eye className="w-4 h-4" /> معاينة
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleDelete(event.id)} className="flex items-center gap-2 text-red-600 focus:text-red-700 cursor-pointer">
                          <Trash2 className="w-4 h-4" /> حذف
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  <div className="mt-auto">
                    <div className="flex items-center justify-between text-sm text-gray-600 mb-3 border-t pt-4">
                      <span className="flex items-center gap-1"><Users className="w-4 h-4" /> المدعوين: {event.guestsCount}</span>
                      <span className="text-emerald-600 font-medium">مؤكد: {event.attendingCount}</span>
                    </div>
                    <Link href={`/events/${event.id}`}>
                      <Button variant="outline" className="w-full border-gray-200 text-gray-700 hover:bg-gray-50 hover:text-gray-900">
                        إدارة الضيوف
                      </Button>
                    </Link>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-32 bg-white rounded-xl border border-dashed border-gray-200">
            <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4">
              <Calendar className="w-8 h-8 text-gray-400" />
            </div>
            <h3 className="text-lg font-bold text-gray-900 mb-2">لا توجد دعوات</h3>
            <p className="text-gray-600 mb-6">ابدأ بإنشاء دعوتك الأولى وصممها بأناقة</p>
            <Link href="/events/new" className="bg-ink text-gold-light px-6 py-2.5 rounded-md font-medium hover:bg-ink-soft transition-colors shadow-md inline-flex items-center gap-2">
              <Plus className="w-5 h-5" />
              إنشاء دعوة
            </Link>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={eventToDelete !== null}
        onOpenChange={(open) => !open && setEventToDelete(null)}
        title="حذف الدعوة"
        description="سيتم حذف الدعوة وجميع مدعويها وردودهم نهائياً. لا يمكن التراجع."
        confirmLabel="حذف"
        destructive
        isPending={deleteEvent.isPending}
        onConfirm={confirmDelete}
      />
    </AppLayout>
  );
}
