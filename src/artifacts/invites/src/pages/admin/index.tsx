import { AppLayout } from "@/components/layout/app-layout";
import { useGetMe, useGetAdminStats, useListAdminUsers, useListAdminEvents, useListTemplates, useCreateTemplate, useUpdateTemplate, useDeleteTemplate, useUpdateAdminUser, useDeleteAdminEvent } from "@/lib/api";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Link, Redirect } from "wouter";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Users, Calendar, Palette, Crown, Trash2, Edit, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQueryClient } from "@tanstack/react-query";
import { getListTemplatesQueryKey, getListAdminUsersQueryKey, getListAdminEventsQueryKey, getGetAdminStatsQueryKey } from "@/lib/api";
import { format } from "date-fns";
import { ar } from "date-fns/locale";

export default function AdminPage() {
  const { data: user, isLoading: isLoadingUser } = useGetMe();
  const { data: stats, isLoading: isLoadingStats } = useGetAdminStats({ query: { enabled: user?.role === 'admin', queryKey: getGetAdminStatsQueryKey() } });
  
  if (isLoadingUser) {
    return <AppLayout><div className="flex justify-center py-32"><Loader2 className="w-8 h-8 animate-spin text-gold" /></div></AppLayout>;
  }

  if (user?.role !== 'admin') {
    return <Redirect to="/dashboard" />;
  }

  return (
    <AppLayout>
      <div className="p-6 md:p-10 max-w-7xl mx-auto space-y-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">لوحة تحكم الإدارة</h1>
          <p className="text-gray-600 mt-1">إدارة المستخدمين، القوالب، والمناسبات في المنصة</p>
        </div>

        {isLoadingStats ? (
          <div className="flex justify-center py-10"><Loader2 className="w-8 h-8 animate-spin text-gold" /></div>
        ) : stats ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm flex flex-col items-center justify-center text-center">
              <Users className="w-8 h-8 text-blue-500 mb-2" />
              <p className="text-sm text-gray-600 font-medium">المستخدمين</p>
              <p className="text-2xl font-bold text-gray-900">{stats.usersCount}</p>
            </div>
            <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm flex flex-col items-center justify-center text-center">
              <Crown className="w-8 h-8 text-gold mb-2" />
              <p className="text-sm text-gray-600 font-medium">الاشتراكات المدفوعة</p>
              <p className="text-2xl font-bold text-gray-900">{stats.paidPlanCount}</p>
            </div>
            <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm flex flex-col items-center justify-center text-center">
              <Calendar className="w-8 h-8 text-emerald-500 mb-2" />
              <p className="text-sm text-gray-600 font-medium">المناسبات</p>
              <p className="text-2xl font-bold text-gray-900">{stats.eventsCount}</p>
            </div>
            <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm flex flex-col items-center justify-center text-center">
              <Palette className="w-8 h-8 text-purple-500 mb-2" />
              <p className="text-sm text-gray-600 font-medium">القوالب</p>
              <p className="text-2xl font-bold text-gray-900">{stats.templatesCount}</p>
            </div>
          </div>
        ) : null}

        <Tabs defaultValue="templates" className="w-full">
          <TabsList className="grid grid-cols-3 max-w-2xl bg-white border border-gray-100">
            <TabsTrigger value="templates">القوالب</TabsTrigger>
            <TabsTrigger value="users">المستخدمين</TabsTrigger>
            <TabsTrigger value="events">المناسبات</TabsTrigger>
          </TabsList>
          
          <div className="mt-6 bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <TabsContent value="templates"><AdminTemplates /></TabsContent>
            <TabsContent value="users"><AdminUsers /></TabsContent>
            <TabsContent value="events"><AdminEvents /></TabsContent>
          </div>
        </Tabs>
      </div>
    </AppLayout>
  );
}

function AdminTemplates() {
  const { data: templates, isLoading } = useListTemplates({ includeInactive: true });
  const createTemplate = useCreateTemplate();
  const updateTemplate = useUpdateTemplate();
  const deleteTemplate = useDeleteTemplate();
  const queryClient = useQueryClient();

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  
  const [formData, setFormData] = useState({
    name: "",
    category: "general" as const,
    previewImage: "",
    active: true
  });

  const handleOpenForm = (template?: any) => {
    if (template) {
      setEditingId(template.id);
      setFormData({
        name: template.name,
        category: template.category,
        previewImage: template.previewImage,
        active: template.active
      });
    } else {
      setEditingId(null);
      setFormData({
        name: "",
        category: "general",
        previewImage: "",
        active: true
      });
    }
    setIsFormOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingId) {
      updateTemplate.mutate({ id: editingId, data: formData }, {
        onSuccess: () => {
          setIsFormOpen(false);
          queryClient.invalidateQueries({ queryKey: getListTemplatesQueryKey() });
        }
      });
    } else {
      createTemplate.mutate({ data: formData }, {
        onSuccess: () => {
          setIsFormOpen(false);
          queryClient.invalidateQueries({ queryKey: getListTemplatesQueryKey() });
        }
      });
    }
  };

  // [ن-1] حوار داخل التطبيق بدل confirm()
  const [templateToDelete, setTemplateToDelete] = useState<number | null>(null);

  const handleDelete = (id: number) => setTemplateToDelete(id);

  const confirmDeleteTemplate = () => {
    if (templateToDelete === null) return;
    deleteTemplate.mutate({ id: templateToDelete }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListTemplatesQueryKey() });
        setTemplateToDelete(null);
      },
      onError: () => setTemplateToDelete(null),
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-bold text-gray-900">إدارة القوالب</h2>
        <Button onClick={() => handleOpenForm()} className="bg-ink text-gold-light hover:bg-ink-soft">
          <Plus className="w-4 h-4 ml-2" /> قالب جديد
        </Button>
      </div>

      <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>{editingId ? 'تعديل القالب' : 'إضافة قالب جديد'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4 py-4">
            <div>
              <label className="text-sm font-medium mb-1 block">اسم القالب</label>
              <Input value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} required />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">الفئة</label>
              <Select value={formData.category} onValueChange={(v: any) => setFormData({...formData, category: v})}>
                <SelectTrigger dir="rtl"><SelectValue /></SelectTrigger>
                <SelectContent dir="rtl">
                  <SelectItem value="wedding">زفاف</SelectItem>
                  <SelectItem value="engagement">خطوبة</SelectItem>
                  <SelectItem value="graduation">تخرج</SelectItem>
                  <SelectItem value="birthday">ميلاد</SelectItem>
                  <SelectItem value="meeting">اجتماع</SelectItem>
                  <SelectItem value="general">عام</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">رابط الصورة (Preview URL)</label>
              <Input value={formData.previewImage} onChange={e => setFormData({...formData, previewImage: e.target.value})} required dir="ltr" />
            </div>
            <div className="flex items-center gap-2 mt-4">
              <input type="checkbox" id="active" checked={formData.active} onChange={e => setFormData({...formData, active: e.target.checked})} className="w-4 h-4 text-gold" />
              <label htmlFor="active" className="text-sm font-medium">مفعل (يظهر للمستخدمين)</label>
            </div>
            <DialogFooter className="mt-6">
              <Button type="submit" disabled={createTemplate.isPending || updateTemplate.isPending} className="bg-ink text-gold-light hover:bg-ink-soft w-full">
                {(createTemplate.isPending || updateTemplate.isPending) ? <Loader2 className="w-4 h-4 animate-spin" /> : 'حفظ'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {isLoading ? (
        <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {templates?.map(t => (
            <div key={t.id} className={`border rounded-lg overflow-hidden ${t.active ? 'border-gray-200' : 'border-red-200 opacity-70'}`}>
              <img src={t.previewImage} alt={t.name} className="w-full aspect-[3/4] object-cover bg-gray-100" />
              <div className="p-3 bg-gray-50 border-t border-gray-200">
                <div className="flex justify-between items-center mb-2">
                  <span className="font-bold text-sm text-gray-900 truncate">{t.name}</span>
                  {!t.active && <span className="text-[10px] bg-red-100 text-red-700 px-2 py-0.5 rounded">معطل</span>}
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="flex-1 h-8 text-xs" onClick={() => handleOpenForm(t)}>
                    تعديل
                  </Button>
                  <Button variant="outline" size="icon" className="h-8 w-8 text-red-500 hover:text-red-700 hover:bg-red-50" onClick={() => handleDelete(t.id)}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={templateToDelete !== null}
        onOpenChange={(open) => !open && setTemplateToDelete(null)}
        title="حذف القالب"
        description="سيُحذف القالب نهائياً. المناسبات المرتبطة به ستبقى بلا قالب."
        confirmLabel="حذف"
        destructive
        isPending={deleteTemplate.isPending}
        onConfirm={confirmDeleteTemplate}
      />
    </div>
  );
}

function AdminUsers() {
  const { data: users, isLoading } = useListAdminUsers();
  const updateUser = useUpdateAdminUser();
  const queryClient = useQueryClient();

  const handleRoleChange = (id: string, role: 'user' | 'admin') => {
    updateUser.mutate({ id, data: { role } }, {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getListAdminUsersQueryKey() })
    });
  };

  const handlePlanChange = (id: string, plan: 'free' | 'paid') => {
    updateUser.mutate({ id, data: { plan } }, {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getListAdminUsersQueryKey() })
    });
  };

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold text-gray-900">إدارة المستخدمين</h2>
      
      <div className="overflow-x-auto">
        <table className="w-full text-right text-sm">
          <thead className="bg-gray-50 text-gray-600 font-medium">
            <tr>
              <th className="px-4 py-3">الاسم / البريد</th>
              <th className="px-4 py-3">تاريخ التسجيل</th>
              <th className="px-4 py-3">الصلاحية</th>
              <th className="px-4 py-3">الباقة</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading ? (
              <tr><td colSpan={4} className="px-4 py-10 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-gray-400" /></td></tr>
            ) : users?.map(u => (
              <tr key={u.id}>
                <td className="px-4 py-3">
                  <p className="font-medium text-gray-900">{u.name}</p>
                  <p className="text-xs text-gray-600" dir="ltr">{u.email}</p>
                </td>
                <td className="px-4 py-3 text-gray-600">{format(new Date(u.createdAt), 'yyyy/MM/dd')}</td>
                <td className="px-4 py-3">
                  <Select value={u.role} onValueChange={(val: any) => handleRoleChange(u.id, val)}>
                    <SelectTrigger className="h-8 w-28 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent dir="rtl">
                      <SelectItem value="user">مستخدم</SelectItem>
                      <SelectItem value="admin">مدير</SelectItem>
                    </SelectContent>
                  </Select>
                </td>
                <td className="px-4 py-3">
                  <Select value={u.plan} onValueChange={(val: any) => handlePlanChange(u.id, val)}>
                    <SelectTrigger className={`h-8 w-28 text-xs ${u.plan === 'paid' ? 'bg-gold/10 text-yellow-800 border-gold/50' : ''}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent dir="rtl">
                      <SelectItem value="free">أساسية</SelectItem>
                      <SelectItem value="paid">ماسية (Pro)</SelectItem>
                    </SelectContent>
                  </Select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AdminEvents() {
  const { data: events, isLoading } = useListAdminEvents();
  const deleteEvent = useDeleteAdminEvent();
  const queryClient = useQueryClient();

  // [ن-1] حوار داخل التطبيق بدل confirm()
  const [eventToDelete, setEventToDelete] = useState<number | null>(null);

  const handleDelete = (id: number) => setEventToDelete(id);

  const confirmDeleteEvent = () => {
    if (eventToDelete === null) return;
    deleteEvent.mutate({ id: eventToDelete }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListAdminEventsQueryKey() });
        setEventToDelete(null);
      },
      onError: () => setEventToDelete(null),
    });
  };

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold text-gray-900">جميع المناسبات في المنصة</h2>
      
      <div className="overflow-x-auto">
        <table className="w-full text-right text-sm">
          <thead className="bg-gray-50 text-gray-600 font-medium">
            <tr>
              <th className="px-4 py-3">المناسبة</th>
              <th className="px-4 py-3">تاريخ المناسبة</th>
              <th className="px-4 py-3">المدعوين</th>
              <th className="px-4 py-3">معاينة</th>
              <th className="px-4 py-3 w-16"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading ? (
              <tr><td colSpan={5} className="px-4 py-10 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-gray-400" /></td></tr>
            ) : events?.map(e => (
              <tr key={e.id}>
                <td className="px-4 py-3">
                  <p className="font-medium text-gray-900">{e.title}</p>
                  <p className="text-xs text-gray-600">ID المستخدم: {e.userId}</p>
                </td>
                <td className="px-4 py-3 text-gray-600">{format(new Date(e.eventDate), 'yyyy/MM/dd')}</td>
                <td className="px-4 py-3 text-gray-600">{e.guestsCount} مدعو</td>
                <td className="px-4 py-3">
                  <a href={`/invite/${e.shareSlug}`} target="_blank" rel="noreferrer" className="text-blue-500 hover:underline text-xs">
                    رابط الدعوة
                  </a>
                </td>
                <td className="px-4 py-3">
                  <Button variant="ghost" size="icon" onClick={() => handleDelete(e.id)} className="text-red-500 hover:text-red-700 hover:bg-red-50 h-8 w-8">
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={eventToDelete !== null}
        onOpenChange={(open) => !open && setEventToDelete(null)}
        title="حذف المناسبة"
        description="سيُحذف المناسبة وجميع مدعويها وردودهم نهائياً. لا يمكن التراجع."
        confirmLabel="حذف نهائياً"
        destructive
        isPending={deleteEvent.isPending}
        onConfirm={confirmDeleteEvent}
      />
    </div>
  );
}
