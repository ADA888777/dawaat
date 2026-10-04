/**
 * طبقة البيانات المبنية مباشرة على Supabase.
 * تحافظ على نفس أسماء وتواقيع hooks القديمة (orval) لتقليل التغييرات في الصفحات.
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryOptions,
} from "@tanstack/react-query";
import { supabase } from "./supabase";
import { useAuth } from "./auth";

// ---------------- الأنواع ----------------
export type EventCategory =
  | "wedding" | "engagement" | "birthday" | "graduation" | "meeting" | "general";
export type AttendanceStatus = "pending" | "attending" | "maybe" | "declined";
/** حالة تجهيز/إرسال الدعوة — مستقلة عن رد المدعو */
export type InviteStatus = "pending" | "prepared" | "sent" | "no_response";
/** الوسيلة التي يحددها صاحب الدعوة لرقم التواصل */
export type ContactMethod = "call" | "whatsapp" | "both";

export interface Me {
  id: string;
  name: string;
  email: string;
  role: "user" | "admin";
  plan: "free" | "paid";
  eventsLimit: number | null;
  createdAt: string;
  planStartDate: string | null;
  planEndDate: string | null;
  /** تفضيلات الحساب — تُدار من صفحة الإعدادات */
  notifyRsvp: boolean;
  notifyReminders: boolean;
  reminder24h: boolean;
  reminder3h: boolean;
  defaultContactPhone: string;
  defaultContactMethod: ContactMethod;
  defaultTemplateId: number | null;
  defaultInviteNote: string;
}

export interface Template {
  id: number;
  name: string;
  category: EventCategory;
  previewImage: string;
  active: boolean;
}

export interface EventRecord {
  id: number;
  userId: string;
  title: string;
  category: EventCategory;
  eventDate: string;
  location: string;
  description: string;
  coverImage: string | null;
  audioFile: string | null;
  templateId: number | null;
  shareSlug: string;
  guestsCount: number;
  attendingCount: number;
  declinedCount: number;
  maybeCount: number;
  sentCount: number;
  pendingSendCount: number;
  /** رقم التواصل للاستفسارات — يظهر للمدعو في صفحة الدعوة */
  contactPhone: string | null;
  contactMethod: ContactMethod;
  createdAt: string;
}

export interface Guest {
  id: number;
  eventId: number;
  name: string;
  phone: string;
  attendanceStatus: AttendanceStatus;
  /** حالة إرسال الدعوة، لا تُخلط برد المدعو */
  inviteStatus: InviteStatus;
  inviteSentAt: string | null;
  /** الرمز الشخصي المستخدم في رابط الدعوة بدل الاسم والجوال */
  inviteToken: string;
  createdAt: string;
}

export interface PublicInvitation {
  title: string;
  category: EventCategory;
  description: string;
  eventDate: string;
  location: string;
  coverImage: string | null;
  audioFile: string | null;
  contactPhone: string | null;
  contactMethod: ContactMethod;
  shareSlug: string;
}

// ---------------- صفوف قاعدة البيانات ----------------
// أنواع صريحة بدل any — أي انحراف في المخطط يظهر وقت الترجمة لا وقت التشغيل.
interface EventRow {
  id: number; user_id: string; title: string; category: EventCategory;
  event_date: string; location: string; description: string | null;
  cover_image: string | null; audio_file: string | null;
  template_id: number | null; share_slug: string;
  contact_phone?: string | null; contact_method?: ContactMethod;
  guests_count?: number; attending_count?: number;
  declined_count?: number; maybe_count?: number;
  sent_count?: number; pending_send_count?: number;
}
interface GuestRow {
  id: number; event_id: number; name: string; phone: string;
  attendance_status: AttendanceStatus; invite_token: string;
  invite_status?: InviteStatus; invite_sent_at?: string | null;
}
interface TemplateRow {
  id: number; name: string; category: EventCategory;
  preview_image: string; active: boolean;
}
interface ProfileRow {
  id: string; name: string; email: string; role: "user" | "admin";
  plan: "free" | "paid"; events_limit: number | null; created_at: string;
notify_rsvp?: boolean; notify_reminders?: boolean;
reminder_24h?: boolean; reminder_3h?: boolean;
default_contact_phone?: string | null; default_contact_method?: ContactMethod;
default_template_id?: number | null; default_invite_note?: string | null;
plan_start_date?: string | null; plan_end_date?: string | null;
}

// ---------------- تحويل الصفوف ----------------
function mapEvent(row: EventRow): EventRecord {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    category: row.category,
    eventDate: row.event_date,
    location: row.location,
    description: row.description ?? "",
    coverImage: row.cover_image,
    audioFile: row.audio_file,
    templateId: row.template_id,
    shareSlug: row.share_slug,
    guestsCount: row.guests_count ?? 0,
    attendingCount: row.attending_count ?? 0,
    declinedCount: row.declined_count ?? 0,
    maybeCount: row.maybe_count ?? 0,
    sentCount: row.sent_count ?? 0,
    pendingSendCount: row.pending_send_count ?? 0,
    contactPhone: row.contact_phone ?? null,
    contactMethod: row.contact_method ?? "both",
    createdAt: String((row as unknown as { created_at?: string }).created_at ?? ""),
  };
}

function mapGuest(row: GuestRow): Guest {
  return {
    id: row.id,
    eventId: row.event_id,
    name: row.name,
    phone: row.phone,
    attendanceStatus: row.attendance_status,
    inviteStatus: row.invite_status ?? "pending",
    inviteSentAt: row.invite_sent_at ?? null,
    inviteToken: row.invite_token,
    createdAt: String((row as unknown as { created_at?: string }).created_at ?? ""),
  };
}

function mapTemplate(row: TemplateRow): Template {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    previewImage: row.preview_image,
    active: row.active,
  };
}

/**
 * يرمي عند وجود خطأ، ويؤكد للمترجم أن data ليست null بعده.
 * يمنع الانهيار وقت التشغيل الذي كان ممكناً مع `data!` السابقة.
 */
function unwrap<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  if (res.data === null || res.data === undefined) {
    throw new Error("لم تُرجع قاعدة البيانات أي بيانات");
  }
  return res.data;
}

function throwIf(error: { message: string } | null): void {
  if (error) throw new Error(error.message);
}

type QueryOpts = { query?: { enabled?: boolean; queryKey?: readonly unknown[] } };

/** [م-8] سقف الاستيراد الجماعي في العملية الواحدة */
export const MAX_IMPORT_ROWS = 1000;

// توحيد الأرقام في مكان واحد (lib/phone.ts) — نفس قواعد قاعدة البيانات
export {
  toWesternDigits,
  normalizePhone,
  phoneMatchKey,
  isValidPhone,
  isSaudiMobile,
  formatPhoneForDisplay,
} from "./phone";
import { normalizePhone, phoneMatchKey, isValidPhone } from "./phone";

// ---------------- مفاتيح الاستعلام ----------------
export const getGetMeQueryKey = () => ["me"] as const;
export const getListTemplatesQueryKey = (p?: { includeInactive?: boolean }) =>
  ["templates", p?.includeInactive ?? false] as const;
export const getListEventsQueryKey = () => ["events"] as const;
export const getGetEventQueryKey = (id: number) => ["events", id] as const;
export const getListGuestsQueryKey = (eventId: number) => ["guests", eventId] as const;
export const getGetPublicInvitationQueryKey = (slug: string) => ["invitation", slug] as const;
export const getGetSubscriptionQueryKey = () => ["subscription"] as const;
export const getGetAdminStatsQueryKey = () => ["admin", "stats"] as const;
export const getListAdminUsersQueryKey = () => ["admin", "users"] as const;
export const getListAdminEventsQueryKey = () => ["admin", "events"] as const;

// ---------------- الحساب ----------------
export function useGetMe() {
  const { user } = useAuth();
  return useQuery({
    queryKey: getGetMeQueryKey(),
    enabled: !!user,
    queryFn: async (): Promise<Me> => {
      const data = unwrap<ProfileRow>(await supabase
        .from("profiles").select("*").eq("id", user!.id).single());
      return {
        id: data.id,
        name: data.name,
        email: data.email,
        role: data.role,
        plan: data.plan,
        eventsLimit: data.events_limit,
        createdAt: data.created_at,
        planStartDate: data.plan_start_date ?? null,
        planEndDate: data.plan_end_date ?? null,
        notifyRsvp: data.notify_rsvp ?? true,
        notifyReminders: data.notify_reminders ?? true,
        reminder24h: data.reminder_24h ?? true,
        reminder3h: data.reminder_3h ?? true,
        defaultContactPhone: data.default_contact_phone ?? "",
        defaultContactMethod: data.default_contact_method ?? "both",
        defaultTemplateId: data.default_template_id ?? null,
        defaultInviteNote: data.default_invite_note ?? "",
      };
    },
  });
}

// ---------------- القوالب ----------------
export function useListTemplates(params?: { includeInactive?: boolean }) {
  return useQuery({
    queryKey: getListTemplatesQueryKey(params),
    queryFn: async (): Promise<Template[]> => {
      let q = supabase.from("templates").select("*").order("id");
      if (!params?.includeInactive) q = q.eq("active", true);
      const { data, error } = await q;
      throwIf(error);
      return (data ?? []).map(mapTemplate);
    },
  });
}

export function useCreateTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ data }: { data: { name: string; category: EventCategory; previewImage: string; active: boolean } }) => {
      const { error } = await supabase.from("templates").insert({
        name: data.name, category: data.category,
        preview_image: data.previewImage, active: data.active,
      });
      throwIf(error);
    },
    // القائمة تُقرأ بمفتاحين (مع/بدون المعطّلة) — إبطال بالبادئة يغطيهما
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["templates"] });
      qc.invalidateQueries({ queryKey: getGetAdminStatsQueryKey() });
    },
  });
}

export function useUpdateTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: number; data: { name: string; category: EventCategory; previewImage: string; active: boolean } }) => {
      const { error } = await supabase.from("templates").update({
        name: data.name, category: data.category,
        preview_image: data.previewImage, active: data.active,
      }).eq("id", id);
      throwIf(error);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["templates"] }),
  });
}

export function useDeleteTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: number }) => {
      const { error } = await supabase.from("templates").delete().eq("id", id);
      throwIf(error);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["templates"] });
      qc.invalidateQueries({ queryKey: getGetAdminStatsQueryKey() });
    },
  });
}

// ---------------- المناسبات ----------------
async function fetchMyEvents(userId: string): Promise<EventRecord[]> {
  const { data, error } = await supabase
    .from("events_with_counts").select("*")
    .eq("user_id", userId)
    .order("event_date", { ascending: true });
  throwIf(error);
  return (data ?? []).map(mapEvent);
}

export function useListEvents() {
  const { user } = useAuth();
  return useQuery({
    queryKey: getListEventsQueryKey(),
    enabled: !!user,
    queryFn: () => fetchMyEvents(user!.id),
  });
}

export function useGetEvent(id: number, opts?: QueryOpts) {
  return useQuery({
    queryKey: getGetEventQueryKey(id),
    enabled: opts?.query?.enabled ?? true,
    queryFn: async (): Promise<EventRecord> => {
      return mapEvent(unwrap<EventRow>(await supabase
        .from("events_with_counts").select("*").eq("id", id).single()));
    },
  });
}

export interface EventPayload {
  title: string;
  category: EventCategory;
  eventDate: string;
  location: string;
  description: string;
  templateId?: number;
  coverImage?: string;
  audioFile?: string;
  contactPhone?: string;
  contactMethod?: ContactMethod;
}

function eventRow(data: EventPayload) {
  return {
    title: data.title,
    category: data.category,
    event_date: data.eventDate,
    location: data.location,
    description: data.description ?? "",
    template_id: data.templateId ?? null,
    cover_image: data.coverImage ?? null,
    audio_file: data.audioFile ?? null,
    // رقم فارغ يُخزَّن null حتى لا يظهر زر اتصال بلا رقم
    contact_phone: normalizePhone(data.contactPhone ?? "") || null,
    contact_method: data.contactMethod ?? "both",
  };
}

export function useCreateEvent() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ data }: { data: EventPayload }): Promise<{ id: number }> => {
      // share_slug يُولَّد داخل قاعدة البيانات (default gen_random_bytes)
      // فلا يستطيع العميل اختيار رابط قصير أو متوقع.
      const row = unwrap<{ id: number }>(await supabase.from("events")
        .insert({ ...eventRow(data), user_id: user!.id })
        .select("id").single());
      return { id: row.id };
    },
    onSuccess: () => {
      // لوحة المعلومات والتنبيهات مشتقّتان من نفس المفتاح — إبطال واحد يكفي
      qc.invalidateQueries({ queryKey: getListEventsQueryKey() });
    },
  });
}

export function useUpdateEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: number; data: EventPayload }) => {
      const { error } = await supabase.from("events")
        .update(eventRow(data))   // updated_at يُضبط بتريجر في قاعدة البيانات
        .eq("id", id);
      throwIf(error);
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: getGetEventQueryKey(vars.id) });
      qc.invalidateQueries({ queryKey: getListEventsQueryKey() });
    },
  });
}

export function useDeleteEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: number }) => {
      const { error } = await supabase.from("events").delete().eq("id", id);
      throwIf(error);
    },
    onSuccess: () => {
      // لوحة المعلومات والتنبيهات مشتقّتان من نفس المفتاح — إبطال واحد يكفي
      qc.invalidateQueries({ queryKey: getListEventsQueryKey() });
    },
  });
}

// ---------------- الضيوف ----------------
export function useListGuests(eventId: number, opts?: QueryOpts) {
  return useQuery({
    queryKey: getListGuestsQueryKey(eventId),
    enabled: opts?.query?.enabled ?? true,
    queryFn: async (): Promise<Guest[]> => {
      const { data, error } = await supabase
        .from("guests").select("*").eq("event_id", eventId).order("created_at");
      throwIf(error);
      return (data ?? []).map(mapGuest);
    },
  });
}

/**
 * يعيد وعداً ينتهي بعد إعادة جلب القائمة وعدّادات المناسبة معاً،
 * فتُعاد من onSuccess حتى لا تُغلق النافذة أو تظهر رسالة النجاح قبل تحديث
 * الأرقام في رأس الصفحة.
 */
function invalidateGuests(qc: ReturnType<typeof useQueryClient>, eventId: number) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: getListGuestsQueryKey(eventId) }),
    qc.invalidateQueries({ queryKey: getGetEventQueryKey(eventId) }),
    qc.invalidateQueries({ queryKey: getListEventsQueryKey() }),
  ]);
}

export function useCreateGuest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ eventId, data }: { eventId: number; data: { name: string; phone: string } }) => {
      const name = data.name.trim();
      const phone = normalizePhone(data.phone);
      if (!name) throw new Error("اسم المدعو مطلوب");
      if (!isValidPhone(phone)) throw new Error("رقم الجوال غير صالح");

      const { error } = await supabase.from("guests")
        .insert({ event_id: eventId, name: name.slice(0, 100), phone });
      // 23505 = انتهاك قيد التفرد → رسالة مفهومة بدل خطأ Postgres خام
      if (error && (error as { code?: string }).code === "23505") {
        throw new Error("هذا الرقم مضاف مسبقاً في قائمة المدعوين");
      }
      throwIf(error);
    },
    onSuccess: (_d, vars) => invalidateGuests(qc, vars.eventId),
  });
}

export function useBulkCreateGuests() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ eventId, data }: { eventId: number; data: { guests: { name: string; phone: string }[] } }) => {
      // [م-8] سقف يحمي المتصفح وقاعدة البيانات من ملف ضخم
      if (data.guests.length > MAX_IMPORT_ROWS) {
        throw new Error(`لا يمكن استيراد أكثر من ${MAX_IMPORT_ROWS} مدعو دفعة واحدة`);
      }

      // نظّف ووحّد الأرقام (+9665XXXXXXXX)، ثم أزل التكرار داخل الدفعة نفسها
      const seen = new Set<string>();
      const rows: { event_id: number; name: string; phone: string }[] = [];
      let skipped = 0;

      for (const g of data.guests) {
        const phone = normalizePhone(g.phone ?? "");
        const name = (g.name ?? "").trim() || phone;
        const key = phoneMatchKey(phone);
        if (!isValidPhone(phone) || !key || seen.has(key)) {
          skipped++;
          continue;
        }
        seen.add(key);
        rows.push({ event_id: eventId, name: name.slice(0, 100), phone });
      }

      if (rows.length === 0) return { created: 0, skipped, ids: [] as number[] };

      // [ح-3] upsert بدل insert: تكرار الاستيراد لا يضاعف المدعوين،
      // و ignoreDuplicates يُبقي رد المدعو الحالي كما هو.
      // select يعيد الصفوف المُضافة فعلاً فقط، فيكون العدد المعروض صادقاً.
      const { data: inserted, error } = await supabase
        .from("guests")
        .upsert(rows, { onConflict: "event_id,phone", ignoreDuplicates: true })
        .select("id");
      throwIf(error);
      const ids = ((inserted ?? []) as { id: number }[]).map((r) => r.id);
      return { created: ids.length, skipped: skipped + (rows.length - ids.length), ids };
    },
    onSuccess: (_d, vars) => invalidateGuests(qc, vars.eventId),
  });
}

// ---------------- استيراد جهات الاتصال عبر اختصار الآيفون (الهجرة 0011) ----------------

/** اسم الاختصار كما يجب أن يكون على جهاز المستخدم — يطابقه رابط التشغيل حرفياً */
export const IOS_SHORTCUT_NAME = "Dawaat – Contacts";

/** رابط تشغيل الاختصار ومعه الرمز كنص إدخال */
export function iosShortcutRunUrl(token: string): string {
  return (
    "shortcuts://run-shortcut?name=" +
    encodeURIComponent(IOS_SHORTCUT_NAME) +
    "&input=text&text=" +
    encodeURIComponent(token)
  );
}

/**
 * الدفع بالبطاقة عبر بوابة «بيلينك».
 *
 * المتصفح لا يلمس أي مفتاح: ينادي Worker دعوات بجلسة المستخدم فقط، والـ Worker
 * (خادم) ينشئ الفاتورة بمفاتيحه السرية ويعيد رابط صفحة الدفع. تأكيد الدفع يتم
 * خادماً لخادم بعد التحقق من بيلينك مباشرة — لا من المتصفح.
 */
export interface GatewayCheckout {
  ok: boolean;
  url?: string;
  paymentId?: number;
  alreadyPaid?: boolean;
  amount?: number;
}

export function useStartGatewayPayment() {
  return useMutation({
    mutationFn: async (vars: {
      eventId: number;
      clientName?: string;
      clientMobile?: string;
      clientEmail?: string;
    }): Promise<GatewayCheckout> => {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("سجّل الدخول أولاً ثم أعد المحاولة.");

      const res = await fetch("/api/pay/create", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer " + token },
        body: JSON.stringify(vars),
      });
      const body = (await res.json().catch(() => null)) as
        | (GatewayCheckout & { message?: string })
        | null;
      if (!res.ok || !body?.ok) {
        throw new Error(body?.message ?? "تعذر فتح صفحة الدفع. حاول مرة أخرى.");
      }
      return body;
    },
  });
}

export interface ContactImportToken {
  token: string;
  expiresAt: string;
}

/**
 * رمز استخدام واحد مرتبط بالمستخدم والمناسبة، صالح 15 دقيقة.
 * يُنشأ في قاعدة البيانات (create_contact_import_token) التي تتحقق من ملكية المناسبة.
 */
export function useCreateContactImportToken() {
  return useMutation({
    mutationFn: async ({ eventId }: { eventId: number }): Promise<ContactImportToken> => {
      const { data, error } = await supabase.rpc("create_contact_import_token", { p_event_id: eventId });
      throwIf(error);
      const row = (Array.isArray(data) ? data[0] : data) as { token: string; expires_at: string } | undefined;
      if (!row?.token) throw new Error("تعذر إنشاء رمز الاستيراد");
      return { token: row.token, expiresAt: String(row.expires_at) };
    },
  });
}

export interface ContactImportStatus {
  usedAt: string | null;
  expiresAt: string;
  importedCount: number;
  duplicateCount: number;
  skippedCount: number;
}

export const getContactImportStatusQueryKey = (token: string) => ["contact-import", token] as const;

/**
 * يستطلع حالة الرمز كل ثانيتين ما دام غير مستخدم وغير منتهٍ، حتى تظهر
 * جهات الاتصال في القائمة فور وصولها من الاختصار دون تحديث الصفحة.
 */
export function useContactImportStatus(token: string | null) {
  return useQuery({
    queryKey: getContactImportStatusQueryKey(token ?? ""),
    enabled: !!token,
    refetchInterval: (query) => {
      const status = query.state.data as ContactImportStatus | undefined;
      if (!status) return 2000;
      if (status.usedAt) return false;
      if (new Date(status.expiresAt).getTime() <= Date.now()) return false;
      return 2000;
    },
    queryFn: async (): Promise<ContactImportStatus> => {
      const { data, error } = await supabase.rpc("contact_import_status", { p_token: token });
      throwIf(error);
      const row = (Array.isArray(data) ? data[0] : data) as
        | { used_at: string | null; expires_at: string; imported_count: number; duplicate_count: number; skipped_count: number }
        | undefined;
      if (!row) throw new Error("الرمز غير موجود");
      return {
        usedAt: row.used_at ?? null,
        expiresAt: String(row.expires_at),
        importedCount: Number(row.imported_count ?? 0),
        duplicateCount: Number(row.duplicate_count ?? 0),
        skippedCount: Number(row.skipped_count ?? 0),
      };
    },
  });
}

export function useUpdateGuest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: number; data: { name?: string; phone?: string; attendanceStatus?: AttendanceStatus; inviteStatus?: InviteStatus } }) => {
      const row: Record<string, unknown> = {};
      if (data.name !== undefined) {
        const name = data.name.trim();
        if (!name) throw new Error("اسم المدعو مطلوب");
        row.name = name.slice(0, 100);
      }
      // الرقم يُوحَّد ويُتحقَّق منه هنا أيضاً، وإلا رفضه قيد قاعدة
      // البيانات برسالة Postgres خام لا يفهمها المستخدم.
      if (data.phone !== undefined) {
        const phone = normalizePhone(data.phone);
        if (!isValidPhone(phone)) {
          throw new Error("رقم الجوال غير صالح. مثال: 0501234567");
        }
        row.phone = phone;
      }
      if (data.attendanceStatus !== undefined) row.attendance_status = data.attendanceStatus;
      if (data.inviteStatus !== undefined) {
        row.invite_status = data.inviteStatus;
        if (data.inviteStatus === "sent") row.invite_sent_at = new Date().toISOString();
      }
      const updated = unwrap<{ event_id: number }>(await supabase.from("guests")
        .update(row).eq("id", id).select("event_id").single());
      return { eventId: updated.event_id };
    },
    onSuccess: (d) => invalidateGuests(qc, d.eventId),
  });
}

/**
 * تسجيل حالة التجهيز/الإرسال لعدة مدعوين في نداء واحد.
 * الدالة في قاعدة البيانات تتحقق أن المناسبة تخص المستخدم الحالي،
 * فلا يستطيع أحد تعديل حالة مدعوي مناسبة لا يملكها.
 */
export function useMarkInviteStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      guestIds,
      status,
    }: {
      eventId: number;
      guestIds: number[];
      status: InviteStatus;
    }): Promise<{ updated: number }> => {
      if (guestIds.length === 0) return { updated: 0 };
      const { data, error } = await supabase.rpc("mark_guests_invite_status", {
        p_guest_ids: guestIds,
        p_status: status,
      });
      throwIf(error);
      return { updated: typeof data === "number" ? data : guestIds.length };
    },
    onSuccess: (_d, vars) => invalidateGuests(qc, vars.eventId),
  });
}

export function useDeleteGuest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: number }) => {
      const { data: row } = await supabase.from("guests").select("event_id").eq("id", id).single();
      const { error } = await supabase.from("guests").delete().eq("id", id);
      throwIf(error);
      return { eventId: (row?.event_id ?? 0) as number };
    },
    onSuccess: (d) => { if (d.eventId) invalidateGuests(qc, d.eventId); },
  });
}

// ---------------- لوحة المعلومات والتنبيهات ----------------
export interface DashboardSummary {
  eventsCount: number;
  guestsCount: number;
  confirmedCount: number;
  upcomingEvents: EventRecord[];
}

/**
 * [م-2] مشتقّة من نفس استعلام useListEvents عبر `select`.
 * سابقاً كانت تستدعي fetchMyEvents بمفتاح مستقل، فكانت لوحة المعلومات
 * تُطلق ثلاث رحلات شبكة متطابقة لنفس البيانات في كل تحميل.
 */
export function useGetDashboardSummary() {
  const { user } = useAuth();
  return useQuery({
    queryKey: getListEventsQueryKey(),
    enabled: !!user,
    queryFn: () => fetchMyEvents(user!.id),
    select: (events): DashboardSummary => {
      const now = Date.now();
      return {
        eventsCount: events.length,
        guestsCount: events.reduce((sum, e) => sum + e.guestsCount, 0),
        confirmedCount: events.reduce((sum, e) => sum + e.attendingCount, 0),
        upcomingEvents: events
          .filter((e) => new Date(e.eventDate).getTime() >= now)
          .slice(0, 5),
      };
    },
  });
}

export interface EventNotification {
  /** rsvp = تنبيه ردود المدعوين، وليس تذكيراً زمنياً */
  reminderType: "24h" | "3h" | "rsvp";
  eventTitle: string;
  eventDate: string;
  pendingCount?: number;
}

/** [م-2] مشتقّة أيضاً من نفس الاستعلام — بلا رحلة شبكة إضافية. */
export function useListNotifications() {
  const { user } = useAuth();
  // تفضيلات التذكير تُقرأ من الحساب: إيقافها من صفحة الإعدادات يُفرغ القائمة فعلياً
  const { data: me } = useGetMe();
  // المفتاح العام في إعدادات الموقع يعلو على تفضيل المستخدم:
  // إذا أوقف الأدمن التذكيرات لا تظهر لأحد.
  const { data: appSettings } = useGetAppSettings();
  const remindersOn =
    (me?.notifyReminders ?? true) && (appSettings?.notifyUsersReminders ?? true);
  const want24h = me?.reminder24h ?? true;
  const want3h = me?.reminder3h ?? true;
  const wantRsvp = me?.notifyRsvp ?? true;
  return useQuery({
    queryKey: getListEventsQueryKey(),
    enabled: !!user,
    queryFn: () => fetchMyEvents(user!.id),
    select: (events): EventNotification[] => {
      const now = Date.now();
      const out: EventNotification[] = [];
      for (const e of remindersOn ? events : []) {
        const diff = new Date(e.eventDate).getTime() - now;
        if (diff <= 0) continue;
        if (diff <= 3 * 3600_000) {
          if (want3h) out.push({ reminderType: "3h", eventTitle: e.title, eventDate: e.eventDate });
        } else if (diff <= 24 * 3600_000) {
          if (want24h) out.push({ reminderType: "24h", eventTitle: e.title, eventDate: e.eventDate });
        }
      }
      if (wantRsvp) {
        for (const e of events) {
          if (new Date(e.eventDate).getTime() - now <= 0) continue;
          const answered = e.attendingCount + e.declinedCount + e.maybeCount;
          const pending = e.guestsCount - answered;
          if (pending > 0) {
            out.push({
              reminderType: "rsvp",
              eventTitle: e.title,
              eventDate: e.eventDate,
              pendingCount: pending,
            });
          }
        }
      }
      return out;
    },
  });
}

// ---------------- الدعوة العامة و RSVP ----------------
export function useGetPublicInvitation(slug: string, opts?: QueryOpts) {
  return useQuery({
    queryKey: getGetPublicInvitationQueryKey(slug),
    enabled: opts?.query?.enabled ?? true,
    queryFn: async (): Promise<PublicInvitation> => {
      const { data, error } = await supabase.rpc("get_public_invitation", { p_slug: slug });
      throwIf(error);
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) throw new Error("الدعوة غير موجودة");
      return {
        title: row.title,
        category: row.category,
        description: row.description ?? "",
        eventDate: row.event_date,
        location: row.location,
        coverImage: row.cover_image,
        audioFile: row.audio_file,
        contactPhone: row.contact_phone ?? null,
        contactMethod: (row.contact_method ?? "both") as ContactMethod,
        shareSlug: row.share_slug ?? slug,
      };
    },
  });
}

/** [ح-2] بيانات المدعو المُعرَّف مسبقاً — تُقرأ من الرمز لا من الرابط */
export interface TokenGuest {
  name: string;
  attendanceStatus: AttendanceStatus;
}

export const getGetGuestByTokenQueryKey = (token: string) =>
  ["invite-guest", token] as const;

export function useGetGuestByToken(token: string | null) {
  return useQuery({
    queryKey: getGetGuestByTokenQueryKey(token ?? ""),
    enabled: !!token,
    retry: false,
    queryFn: async (): Promise<TokenGuest> => {
      const { data, error } = await supabase.rpc("get_guest_by_token", {
        p_token: token,
      });
      throwIf(error);
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) throw new Error("رابط الدعوة غير صالح");
      return { name: row.name, attendanceStatus: row.attendance_status };
    },
  });
}

/**
 * [ح-2] تسجيل الرد بالرمز الشخصي فقط.
 * الاسم والجوال لم يعودا يمران في الرابط، فلا يستطيع من تُمرَّر إليه
 * الرسالة أن يعرف رقم المدعو ولا أن يرد بالنيابة عن شخص آخر.
 */
export function useSubmitRsvpByToken() {
  return useMutation({
    mutationFn: async ({
      token,
      attendanceStatus,
    }: {
      token: string;
      attendanceStatus: Exclude<AttendanceStatus, "pending">;
    }) => {
      const { error } = await supabase.rpc("submit_rsvp_by_token", {
        p_token: token,
        p_status: attendanceStatus,
      });
      throwIf(error);
    },
  });
}

export function useSubmitRsvp() {
  return useMutation({
    mutationFn: async ({ slug, data }: { slug: string; data: { name: string; phone: string; attendanceStatus: Exclude<AttendanceStatus, "pending"> } }) => {
      const name = data.name.trim();
      const phone = normalizePhone(data.phone);
      if (!name) throw new Error("الاسم مطلوب");
      if (!isValidPhone(phone)) throw new Error("رقم الجوال غير صالح");

      const { error } = await supabase.rpc("submit_rsvp", {
        // قاعدة البيانات تحدّ الاسم بـ120 حرفاً؛ نقصّه هنا حتى لا يرى
        // المدعو رسالة قيد خام من Postgres.
        p_slug: slug, p_name: name.slice(0, 100), p_phone: phone, p_status: data.attendanceStatus,
      });
      throwIf(error);
    },
  });
}

// ---------------- الاشتراك ----------------
/**
 * [ن-4] مشتقّة مباشرة من useGetMe.
 * تغليفها في useQuery منفصل كان يخزّن نسخة قديمة من الباقة،
 * فلا تعكس الواجهة الترقية إلا بعد إبطال مفتاحين منفصلين.
 */
export function useGetSubscription() {
  const me = useGetMe();
  return {
    ...me,
    data: me.data
      ? { plan: me.data.plan, eventsLimit: me.data.eventsLimit }
      : undefined,
  };
}

export function useUpgradeSubscription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("upgrade_my_subscription");
      throwIf(error);
    },
    onSuccess: () => {
      // مصدر واحد للحقيقة: الباقة والحد يأتيان من ["me"]
      qc.invalidateQueries({ queryKey: getGetMeQueryKey() });
      qc.invalidateQueries({ queryKey: getListEventsQueryKey() });
    },
  });
}

// ---------------- الإدارة ----------------
export interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: "user" | "admin";
  plan: "free" | "paid";
  createdAt: string;
}

export function useListAdminUsers() {
  return useQuery({
    queryKey: getListAdminUsersQueryKey(),
    queryFn: async (): Promise<AdminUser[]> => {
      const { data, error } = await supabase
        .from("profiles").select("*").order("created_at", { ascending: false });
      throwIf(error);
      return (data ?? []).map((r) => ({
        id: r.id, name: r.name, email: r.email,
        role: r.role, plan: r.plan, createdAt: r.created_at,
      }));
    },
  });
}

export function useUpdateAdminUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: { role?: "user" | "admin"; plan?: "free" | "paid" } }) => {
      const row: Record<string, unknown> = {};
      if (data.role !== undefined) row.role = data.role;
      if (data.plan !== undefined) {
        row.plan = data.plan;
        // 1 هو القيمة الافتراضية لعمود events_limit في قاعدة البيانات.
        // كان الرقم 3 هنا، فإرجاع مستخدم إلى الباقة المجانية كان يمنحه
        // ثلاث مناسبات بدل واحدة دون أن يقصد الأدمن ذلك.
        row.events_limit = data.plan === "paid" ? null : 1;
      }
      const { error } = await supabase.from("profiles").update(row).eq("id", id);
      throwIf(error);
    },
    // بدون هذا يبقى عدّاد «الاشتراكات المدفوعة» على قيمته القديمة
    // حتى يُحدِّث الأدمن الصفحة يدوياً.
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: getListAdminUsersQueryKey() });
      qc.invalidateQueries({ queryKey: getGetAdminStatsQueryKey() });
      qc.invalidateQueries({ queryKey: getGetMeQueryKey() });
    },
  });
}

export function useListAdminEvents() {
  return useQuery({
    queryKey: getListAdminEventsQueryKey(),
    queryFn: async (): Promise<EventRecord[]> => {
      const { data, error } = await supabase
        .from("events_with_counts").select("*")
        .order("event_date", { ascending: false });
      throwIf(error);
      return (data ?? []).map(mapEvent);
    },
  });
}

export function useDeleteAdminEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: number }) => {
      const { error } = await supabase.from("events").delete().eq("id", id);
      throwIf(error);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: getListAdminEventsQueryKey() });
      qc.invalidateQueries({ queryKey: getGetAdminStatsQueryKey() });
      qc.invalidateQueries({ queryKey: getListEventsQueryKey() });
    },
  });
}

export interface AdminStats {
  usersCount: number;
  paidPlanCount: number;
  eventsCount: number;
  templatesCount: number;
  adminsCount: number;
  guestsCount: number;
  attendingCount: number;
}

export function useGetAdminStats(opts?: QueryOpts) {
  return useQuery({
    queryKey: getGetAdminStatsQueryKey(),
    enabled: opts?.query?.enabled ?? true,
    queryFn: async (): Promise<AdminStats> => {
      // [م-3] head:true يعدّ على الخادم ولا ينقل أي صف.
      const [users, paid, admins, events, templates, guests, attending] = await Promise.all([
        supabase.from("profiles").select("id", { count: "exact", head: true }),
        supabase.from("profiles").select("id", { count: "exact", head: true }).eq("plan", "paid"),
        supabase.from("profiles").select("id", { count: "exact", head: true }).eq("role", "admin"),
        supabase.from("events").select("id", { count: "exact", head: true }),
        supabase.from("templates").select("id", { count: "exact", head: true }),
        supabase.from("guests").select("id", { count: "exact", head: true }),
        supabase.from("guests").select("id", { count: "exact", head: true }).eq("attendance_status", "attending"),
      ]);
      throwIf(users.error); throwIf(paid.error); throwIf(admins.error);
      throwIf(events.error); throwIf(templates.error);
      throwIf(guests.error); throwIf(attending.error);
      return {
        usersCount: users.count ?? 0,
        paidPlanCount: paid.count ?? 0,
        adminsCount: admins.count ?? 0,
        eventsCount: events.count ?? 0,
        templatesCount: templates.count ?? 0,
        guestsCount: guests.count ?? 0,
        attendingCount: attending.count ?? 0,
      };
    },
  });
}

// ---------------- إعدادات الحساب الشخصي ----------------
export interface ProfilePrefsPayload {
  name?: string;
  notifyRsvp?: boolean;
  notifyReminders?: boolean;
  reminder24h?: boolean;
  reminder3h?: boolean;
  defaultContactPhone?: string;
  defaultContactMethod?: ContactMethod;
  defaultTemplateId?: number | null;
  defaultInviteNote?: string;
}

/**
 * تحديث بيانات الحساب وتفضيلاته.
 * أعمدة الدور والباقة والحد محميّة بتريجر في قاعدة البيانات، فلا يستطيع
 * المستخدم ترقية نفسه أو منح نفسه صلاحية أدمن من هذا المسار.
 */
export function useUpdateMyProfile() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: ProfilePrefsPayload) => {
      const row: Record<string, unknown> = {};
      if (data.name !== undefined) {
        const name = data.name.trim();
        if (name.length < 2) throw new Error("الاسم قصير جداً");
        row.name = name.slice(0, 80);
      }
      if (data.notifyRsvp !== undefined) row.notify_rsvp = data.notifyRsvp;
      if (data.notifyReminders !== undefined) row.notify_reminders = data.notifyReminders;
      if (data.reminder24h !== undefined) row.reminder_24h = data.reminder24h;
      if (data.reminder3h !== undefined) row.reminder_3h = data.reminder3h;
      if (data.defaultContactPhone !== undefined) {
        const phone = normalizePhone(data.defaultContactPhone);
        if (phone && !isValidPhone(phone)) {
          throw new Error("رقم التواصل غير صالح. مثال: 0501234567");
        }
        row.default_contact_phone = phone || null;
      }
      if (data.defaultContactMethod !== undefined) row.default_contact_method = data.defaultContactMethod;
      if (data.defaultTemplateId !== undefined) row.default_template_id = data.defaultTemplateId;
      if (data.defaultInviteNote !== undefined) {
        row.default_invite_note = data.defaultInviteNote.trim().slice(0, 500) || null;
      }
      if (Object.keys(row).length === 0) return;
      row.updated_at = new Date().toISOString();
      const { error } = await supabase.from("profiles").update(row).eq("id", user!.id);
      throwIf(error);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: getGetMeQueryKey() });
      qc.invalidateQueries({ queryKey: getListAdminUsersQueryKey() });
    },
  });
}

/**
 * حذف الحساب نهائياً.
 * التنفيذ في دالة قاعدة بيانات تتحقق من هوية الطالب، وتحذف صف
 * المستخدم فتتسلسل الحذف إلى المناسبات والمدعوين. لا يمكن حذف حساب أدمن
 * من هنا حتى لا يُفقد الموقع آخر حساب إداري بالخطأ.
 */
export function useDeleteMyAccount() {
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("delete_my_account");
      if (error) {
        if (error.message.includes("ADMIN_SELF_DELETE_BLOCKED")) {
          throw new Error("لا يمكن حذف حساب أدمن من صفحة الإعدادات");
        }
        throw new Error(error.message);
      }
    },
  });
}

// ---------------- إعدادات الموقع العامة (أدمن) ----------------
export interface AppSettings {
  siteName: string;
  supportEmail: string;
  supportPhone: string;
  supportWhatsapp: string;
  supportSnapchat: string;
  maintenanceMode: boolean;
  maintenanceMessage: string;
  signupsEnabled: boolean;
  freeEventsLimit: number;
  paidPlanPrice: number;
  paidPlanMonths: number;
  inviteFooterNote: string;
  inviteDefaultContactMethod: ContactMethod;
  inviteShowContact: boolean;
  notifyAdminOnNewUser: boolean;
  notifyAdminOnNewEvent: boolean;
  notifyUsersReminders: boolean;
  termsText: string;
  privacyText: string;
  refundText: string;
  contentPolicyText: string;
  /** رسوم إرسال الدعوات لكل مناسبة — 0 = مجاني بلا شاشة دفع */
  sendFeeAmount: number;
  sendFeeCurrency: string;
  bankName: string;
  bankAccountName: string;
  bankIban: string;
  paymentInstructions: string;
  /** شريط الإعلانات المتحرك: الإظهار والسرعة (بكسل/ثانية) */
  tickerEnabled: boolean;
  tickerSpeed: number;
  /** ثواني عرض كل إعلان قبل الانتقال للتالي */
  announcementInterval: number;
  /** مفاتيح تفعيل/تعطيل الميزات — تُخزَّن jsonb ويعدّلها الأدمن فقط */
  featureFlags: FeatureFlags;
  /** رابط iCloud لاختصار «Dawaat – Contacts» على الآيفون؛ فارغ = يُعرض شرح التثبيت فقط */
  iosShortcutUrl: string;
  paymentGatewayEnabled: boolean;
  paymentGatewayName: string;
}

export type FeatureKey =
  | "contacts_import"
  | "qr_code"
  | "whatsapp_send"
  | "subscription_page"
  | "announcements_bar"
  | "public_rsvp";

export type FeatureFlags = Record<FeatureKey, boolean>;

export const FEATURE_DEFAULTS: FeatureFlags = {
  contacts_import: true,
  qr_code: true,
  whatsapp_send: true,
  subscription_page: true,
  announcements_bar: true,
  public_rsvp: true,
};

export const FEATURE_LABELS: Record<FeatureKey, { label: string; hint: string }> = {
  contacts_import: { label: "استيراد جهات الاتصال", hint: "زر «جهات الاتصال» في صفحة المناسبة (اختصار الآيفون، منتقي أندرويد، VCF وCSV)." },
  qr_code: { label: "رمز QR ورابط الدعوة", hint: "زر «رمز QR والرابط» في صفحة المناسبة." },
  whatsapp_send: { label: "إرسال الدعوات عبر واتساب", hint: "زر «إرسال الدعوات» وقائمة الإرسال." },
  subscription_page: { label: "صفحة الباقات", hint: "رابط «الباقة» في قائمة المستخدم." },
  announcements_bar: { label: "شريط الإعلانات", hint: "بطاقة الإعلانات في الصفحة الرئيسية ولوحة العميل." },
  public_rsvp: { label: "رد المدعوين على الدعوة", hint: "أزرار «سأحضر/أعتذر» في صفحة الدعوة العامة." },
};

export function parseFeatureFlags(raw: unknown): FeatureFlags {
  const out: FeatureFlags = { ...FEATURE_DEFAULTS };
  if (raw && typeof raw === "object") {
    for (const key of Object.keys(FEATURE_DEFAULTS) as FeatureKey[]) {
      const value = (raw as Record<string, unknown>)[key];
      if (typeof value === "boolean") out[key] = value;
    }
  }
  return out;
}

/** هل الميزة مفعّلة؟ تعذّر القراءة = مفعّلة (الافتراضي) */
export function useFeature(key: FeatureKey): boolean {
  const { data } = useGetAppSettings();
  return data?.featureFlags?.[key] ?? FEATURE_DEFAULTS[key];
}

const APP_SETTINGS_COLUMNS: Record<keyof AppSettings, string> = {
  siteName: "site_name",
  supportEmail: "support_email",
  supportPhone: "support_phone",
  supportWhatsapp: "support_whatsapp",
  supportSnapchat: "support_snapchat",
  maintenanceMode: "maintenance_mode",
  maintenanceMessage: "maintenance_message",
  signupsEnabled: "signups_enabled",
  freeEventsLimit: "free_events_limit",
  paidPlanPrice: "paid_plan_price",
  paidPlanMonths: "paid_plan_months",
  inviteFooterNote: "invite_footer_note",
  inviteDefaultContactMethod: "invite_default_contact_method",
  inviteShowContact: "invite_show_contact",
  notifyAdminOnNewUser: "notify_admin_on_new_user",
  notifyAdminOnNewEvent: "notify_admin_on_new_event",
  notifyUsersReminders: "notify_users_reminders",
  termsText: "terms_text",
  privacyText: "privacy_text",
  refundText: "refund_text",
  contentPolicyText: "content_policy_text",
  sendFeeAmount: "send_fee_amount",
  sendFeeCurrency: "send_fee_currency",
  bankName: "bank_name",
  bankAccountName: "bank_account_name",
  bankIban: "bank_iban",
  paymentInstructions: "payment_instructions",
  tickerEnabled: "ticker_enabled",
  tickerSpeed: "ticker_speed",
  announcementInterval: "announcement_interval",
  featureFlags: "feature_flags",
  iosShortcutUrl: "ios_shortcut_url",
  paymentGatewayEnabled: "payment_gateway_enabled",
  paymentGatewayName: "payment_gateway_name",
};

export const DEFAULT_APP_SETTINGS: AppSettings = {
  siteName: "دعوات",
  supportEmail: "",
  supportPhone: "",
  supportWhatsapp: "",
  supportSnapchat: "",
  maintenanceMode: false,
  maintenanceMessage: "",
  signupsEnabled: true,
  freeEventsLimit: 1,
  paidPlanPrice: 299,
  paidPlanMonths: 12,
  inviteFooterNote: "",
  inviteDefaultContactMethod: "both",
  inviteShowContact: true,
  notifyAdminOnNewUser: true,
  notifyAdminOnNewEvent: false,
  notifyUsersReminders: true,
  termsText: "",
  privacyText: "",
  refundText: "",
  contentPolicyText: "",
  sendFeeAmount: 0,
  sendFeeCurrency: "SAR",
  bankName: "",
  bankAccountName: "",
  bankIban: "",
  paymentInstructions: "",
  tickerEnabled: true,
  tickerSpeed: 60,
  announcementInterval: 5,
  featureFlags: { ...FEATURE_DEFAULTS },
  iosShortcutUrl: "",
  paymentGatewayEnabled: false,
  paymentGatewayName: "بيلينك",
};

export const getGetAppSettingsQueryKey = () => ["app-settings"] as const;

/**
 * إعدادات الموقع — صف واحد يقرأه الجميع (اسم الموقع وبيانات الدعم
 * وصيغة الصيانة تظهر للزائر أيضاً) ولا يحدّثه إلا الأدمن بسياسة RLS.
 * تعذّر القراءة يرجع القيم الافتراضية بدل إسقاط الصفحة.
 */
export function useGetAppSettings() {
  return useQuery({
    queryKey: getGetAppSettingsQueryKey(),
    staleTime: 300_000,
    retry: 1,
    queryFn: async (): Promise<AppSettings> => {
      const { data, error } = await supabase
        .from("app_settings").select("*").limit(1).maybeSingle();
      if (error || !data) return DEFAULT_APP_SETTINGS;
      const raw = data as Record<string, unknown>;
      const out: Record<string, unknown> = { ...DEFAULT_APP_SETTINGS };
      for (const key of Object.keys(APP_SETTINGS_COLUMNS) as (keyof AppSettings)[]) {
        const value = raw[APP_SETTINGS_COLUMNS[key]];
        if (value === null || value === undefined) continue;
        const fallback = DEFAULT_APP_SETTINGS[key];
        if (key === "featureFlags") out[key] = parseFeatureFlags(value);
        else if (typeof fallback === "boolean") out[key] = Boolean(value);
        else if (typeof fallback === "number") out[key] = Number(value);
        else out[key] = String(value);
      }
      if (!String(out.siteName ?? "").trim()) out.siteName = DEFAULT_APP_SETTINGS.siteName;
      return out as unknown as AppSettings;
    },
  });
}

export function useUpdateAppSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: Partial<AppSettings>) => {
      const row: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(data)) {
        const column = APP_SETTINGS_COLUMNS[key as keyof AppSettings];
        if (!column || value === undefined) continue;
        row[column] =
          typeof value === "string" ? value.slice(0, 20000)
          : key === "featureFlags" ? parseFeatureFlags(value)
          : value;
      }
      if (Object.keys(row).length === 0) return;
      row.updated_at = new Date().toISOString();
      const { error } = await supabase.from("app_settings").update(row).eq("id", true);
      throwIf(error);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: getGetAppSettingsQueryKey() }),
  });
}

/**
 * تغيير باقة مستخدم من لوحة الأدمن.
 * تمر عبر دالة admin_set_plan لأنها الوحيدة المصرّح لها بلمس أعمدة
 * الباقة، وهي تتحقق من صلاحية الأدمن داخل قاعدة البيانات وتضبط
 * تاريخ البداية والنهاية معاً.
 */
export function useAdminSetPlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, plan, months }: { userId: string; plan: "free" | "paid"; months: number }) => {
      const { error } = await supabase.rpc("admin_set_plan", {
        p_user_id: userId,
        p_plan: plan,
        p_months: Math.max(1, Math.min(120, Math.round(months))),
      });
      throwIf(error);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: getListAdminUsersQueryKey() });
      qc.invalidateQueries({ queryKey: getGetAdminStatsQueryKey() });
      qc.invalidateQueries({ queryKey: getGetMeQueryKey() });
    },
  });
}

/**
 * حد المناسبات للباقة المجانية.
 * الدالة في قاعدة البيانات تحدّث الإعدادات وقيمة العمود الافتراضية
 * للحسابات الجديدة، واختيارياً تطبّق الحد على الحسابات المجانية القائمة،
 * وترجع عدد الحسابات التي تأثّرت فعلاً.
 */
export function useAdminSetFreeLimit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ limit, applyExisting }: { limit: number; applyExisting: boolean }): Promise<number> => {
      const { data, error } = await supabase.rpc("admin_set_free_limit", {
        p_limit: Math.max(0, Math.min(1000, Math.round(limit))),
        p_apply_existing: applyExisting,
      });
      throwIf(error);
      return typeof data === "number" ? data : 0;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: getGetAppSettingsQueryKey() });
      qc.invalidateQueries({ queryKey: getListAdminUsersQueryKey() });
      qc.invalidateQueries({ queryKey: getGetMeQueryKey() });
    },
  });
}

// ---------------- رسوم الإرسال: الدفع قبل الإرسال النهائي ----------------
/**
 * إرسال الدعوات لمناسبة يتطلب عملية دفع بحالة «مدفوعة». الحماية الفعلية في
 * قاعدة البيانات (mark_guests_invite_status ترفض بـ PAYMENT_REQUIRED)،
 * والواجهة هنا تعرض الحالة وتقود المستخدم: طلب ← تحويل بنكي + إثبات ←
 * مراجعة الأدمن ← يُفتح الإرسال. الحقول provider/providerRef محجوزة
 * لربط بوابة دفع إلكترونية لاحقاً بنفس الجدول والتدفق.
 */
export type PaymentStatus = "pending" | "submitted" | "paid" | "rejected" | "cancelled";
export type PaymentMethod = "bank_transfer" | "gateway" | "free";
export type SendingStatus = "not_started" | "in_progress" | "completed";

export interface EventPayment {
  id: number;
  userId: string;
  eventId: number;
  amount: number;
  currency: string;
  method: PaymentMethod;
  status: PaymentStatus;
  reference: string;
  proofPath: string | null;
  provider: string | null;
  providerRef: string | null;
  submittedAt: string | null;
  paidAt: string | null;
  reviewedAt: string | null;
  adminNote: string;
  sendingStatus: SendingStatus;
  sendingStartedAt: string | null;
  sendingCompletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** عملية دفع كما يراها الأدمن: مع اسم المناسبة وصاحبها */
export interface AdminEventPayment extends EventPayment {
  eventTitle: string;
  eventDate: string | null;
  userName: string;
  userEmail: string;
}

/** PostgREST يعيد الصف المفرد كائناً؛ بعض البيئات تعيده داخل مصفوفة */
function singleRow(data: unknown): Record<string, unknown> {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") throw new Error("استجابة غير متوقعة من الخادم");
  return row as Record<string, unknown>;
}

function mapPayment(r: Record<string, unknown>): EventPayment {
  const str = (v: unknown) => (v === null || v === undefined ? null : String(v));
  return {
    id: Number(r.id),
    userId: String(r.user_id),
    eventId: Number(r.event_id),
    amount: Number(r.amount ?? 0),
    currency: String(r.currency ?? "SAR"),
    method: (r.method as PaymentMethod) ?? "bank_transfer",
    status: (r.status as PaymentStatus) ?? "pending",
    reference: String(r.reference ?? ""),
    proofPath: str(r.proof_path),
    provider: str(r.provider),
    providerRef: str(r.provider_ref),
    submittedAt: str(r.submitted_at),
    paidAt: str(r.paid_at),
    reviewedAt: str(r.reviewed_at),
    adminNote: String(r.admin_note ?? ""),
    sendingStatus: (r.sending_status as SendingStatus) ?? "not_started",
    sendingStartedAt: str(r.sending_started_at),
    sendingCompletedAt: str(r.sending_completed_at),
    createdAt: String(r.created_at ?? ""),
    updatedAt: String(r.updated_at ?? ""),
  };
}

export const getGetEventPaymentQueryKey = (eventId: number) =>
  ["event-payment", eventId] as const;
export const getListAdminPaymentsQueryKey = () => ["admin", "payments"] as const;

/** العملية النشطة للمناسبة (pending/submitted/paid) إن وُجدت — والمرفوضة الأخيرة وإلا */
export function useGetEventPayment(eventId: number, opts?: QueryOpts) {
  return useQuery({
    queryKey: getGetEventPaymentQueryKey(eventId),
    enabled: opts?.query?.enabled ?? Number.isFinite(eventId),
    // أثناء مراجعة الإدارة نعيد الاستعلام كل نصف دقيقة حتى يُفتح الإرسال تلقائياً
    refetchInterval: (query) =>
      query.state.data?.status === "submitted" ? 30_000 : false,
    queryFn: async (): Promise<EventPayment | null> => {
      const { data, error } = await supabase
        .from("event_payments").select("*")
        .eq("event_id", eventId)
        .order("id", { ascending: false });
      // الجدول غير موجود قبل تطبيق الهجرة 0006 — نعتبر ألا عملية دفع
      if (error) return null;
      const rows = (data ?? []) as Record<string, unknown>[];
      const active = rows.find((r) => ["pending", "submitted", "paid"].includes(String(r.status)));
      const row = active ?? rows[0];
      return row ? mapPayment(row) : null;
    },
  });
}

/** يرجع العملية النشطة أو ينشئ واحدة بالمبلغ الحالي من الإعدادات */
export function useRequestEventPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ eventId }: { eventId: number }): Promise<EventPayment> => {
      const { data, error } = await supabase.rpc("request_event_payment", { p_event_id: eventId });
      throwIf(error);
      return mapPayment(singleRow(data));
    },
    onSuccess: (_d, vars) =>
      qc.invalidateQueries({ queryKey: getGetEventPaymentQueryKey(vars.eventId) }),
  });
}

export const PROOF_UPLOAD_LIMIT = {
  maxBytes: 5 * 1024 * 1024,
  label: "5 ميجابايت",
  types: ["image/jpeg", "image/png", "image/webp", "application/pdf"],
} as const;

/** يرفع إثبات التحويل إلى bucket خاص ويعيد مساره (لا رابطاً عاماً) */
export async function uploadPaymentProof(userId: string, file: File): Promise<string> {
  if (file.size > PROOF_UPLOAD_LIMIT.maxBytes) {
    throw new Error(
      `حجم الملف يتجاوز الحد المسموح (${PROOF_UPLOAD_LIMIT.label}). اختر صورة أصغر.`,
    );
  }
  const type = file.type || "";
  if (!PROOF_UPLOAD_LIMIT.types.includes(type as never)) {
    throw new Error("الإثبات يجب أن يكون صورة (JPG/PNG/WEBP) أو ملف PDF");
  }
  const ext = type === "application/pdf" ? "pdf" : (file.name.split(".").pop() || "jpg").toLowerCase();
  const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage
    .from("payment-proofs").upload(path, file, { contentType: type, upsert: false });
  throwIf(error);
  return path;
}

/** رابط مؤقت لعرض الإثبات (المالك أو الأدمن فقط بحكم سياسة التخزين) */
export async function getPaymentProofUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from("payment-proofs").createSignedUrl(path, 60 * 10);
  throwIf(error);
  return data?.signedUrl ?? "";
}

/** تقديم الإثبات: الحالة تصبح «بانتظار المراجعة» لا «مدفوعة» */
export function useSubmitEventPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      paymentId,
      reference,
      proofPath,
    }: {
      paymentId: number;
      eventId: number;
      reference: string;
      proofPath: string;
    }): Promise<EventPayment> => {
      const { data, error } = await supabase.rpc("submit_event_payment", {
        p_payment_id: paymentId,
        p_reference: reference,
        p_proof_path: proofPath,
      });
      throwIf(error);
      return mapPayment(singleRow(data));
    },
    onSuccess: (_d, vars) =>
      qc.invalidateQueries({ queryKey: getGetEventPaymentQueryKey(vars.eventId) }),
  });
}

/** قائمة الأدمن: كل العمليات مع بيانات المناسبة وصاحبها */
export function useListAdminPayments() {
  return useQuery({
    queryKey: getListAdminPaymentsQueryKey(),
    queryFn: async (): Promise<AdminEventPayment[]> => {
      const { data, error } = await supabase
        .from("event_payments")
        .select("*, events(title, event_date), profiles(name, email)")
        .order("id", { ascending: false });
      throwIf(error);
      return ((data ?? []) as Record<string, unknown>[]).map((r) => {
        const ev = (r.events ?? {}) as Record<string, unknown>;
        const pr = (r.profiles ?? {}) as Record<string, unknown>;
        return {
          ...mapPayment(r),
          eventTitle: String(ev.title ?? "مناسبة محذوفة"),
          eventDate: ev.event_date ? String(ev.event_date) : null,
          userName: String(pr.name ?? ""),
          userEmail: String(pr.email ?? ""),
        };
      });
    },
  });
}

export function useReviewEventPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      paymentId,
      approve,
      note,
    }: {
      paymentId: number;
      approve: boolean;
      note?: string;
    }): Promise<EventPayment> => {
      const { data, error } = await supabase.rpc("review_event_payment", {
        p_payment_id: paymentId,
        p_approve: approve,
        p_note: note ?? "",
      });
      throwIf(error);
      return mapPayment(singleRow(data));
    },
    onSuccess: (payment) => {
      qc.invalidateQueries({ queryKey: getListAdminPaymentsQueryKey() });
      qc.invalidateQueries({ queryKey: getGetEventPaymentQueryKey(payment.eventId) });
    },
  });
}

/** عرض الحالة بالعربية في كل الواجهات */
export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  pending: "بانتظار الدفع",
  submitted: "بانتظار مراجعة الإدارة",
  paid: "مدفوعة",
  rejected: "مرفوضة",
  cancelled: "ملغاة",
};

export const SENDING_STATUS_LABELS: Record<SendingStatus, string> = {
  not_started: "لم يبدأ الإرسال",
  in_progress: "الإرسال جارٍ",
  completed: "اكتمل الإرسال",
};

/** ترجمة أخطاء دوال الدفع إلى رسائل عربية */
export function paymentErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  if (raw.includes("PAYMENT_REQUIRED")) return "يجب دفع رسوم الإرسال وموافقة الإدارة قبل إرسال الدعوات.";
  if (raw.includes("PROOF_REQUIRED")) return "أرفق صورة إثبات التحويل قبل الإرسال للمراجعة.";
  if (raw.includes("PAYMENT_NOT_EDITABLE")) return "هذه العملية قيد المراجعة أو مكتملة ولا يمكن تعديلها.";
  if (raw.includes("PAYMENT_ALREADY_REVIEWED")) return "تمت مراجعة هذه العملية مسبقاً.";
  if (raw.includes("EVENT_NOT_FOUND")) return "المناسبة غير موجودة أو ليست لك.";
  if (raw.includes("ADMIN_ONLY")) return "هذه العملية للإدارة فقط.";
  if (raw.includes("does not exist") || raw.includes("Could not find")) {
    return "نظام الدفع غير مفعّل بعد في قاعدة البيانات (الهجرة 0006 لم تُطبَّق).";
  }
  return raw || "حدث خطأ غير متوقع";
}

// ---------------- شريط الإعلانات المتحرك ----------------
export type AnnouncementAudience = "all" | "visitors" | "users" | "free" | "paid";

export const AUDIENCE_LABELS: Record<AnnouncementAudience, string> = {
  all: "الجميع",
  visitors: "الزوار غير المسجلين",
  users: "المستخدمون المسجلون",
  free: "أصحاب الباقة المجانية",
  paid: "أصحاب الباقة المدفوعة",
};

export type AnnouncementIcon =
  | "megaphone" | "sparkles" | "gift" | "crown" | "calendar" | "percent" | "star" | "party";

export const ANNOUNCEMENT_ICONS: AnnouncementIcon[] = [
  "megaphone", "sparkles", "gift", "crown", "calendar", "percent", "star", "party",
];

export const ANNOUNCEMENT_ICON_LABELS: Record<AnnouncementIcon, string> = {
  megaphone: "مكبّر صوت", sparkles: "بريق", gift: "هدية", crown: "تاج",
  calendar: "تقويم", percent: "خصم", star: "نجمة", party: "احتفال",
};

/**
 * شكل الإعلان:
 *   card   → بطاقة: أيقونة أو صورة صغيرة + عنوان + وصف + زر
 *   banner → صورة إعلانية كاملة (تصميم جاهز) بعرض الشريط، تُضغط كلها إن وُجد رابط
 */
export type AnnouncementLayout = "card" | "banner";

export const ANNOUNCEMENT_LAYOUT_LABELS: Record<AnnouncementLayout, string> = {
  card: "بطاقة: أيقونة أو صورة صغيرة + نص",
  banner: "صورة إعلانية كاملة (تصميم جاهز)",
};

export interface Announcement {
  id: number;
  /** عنوان البطاقة — الأساس؛ text القديم يبقى للتوافق مع بيانات سابقة */
  title: string;
  description: string;
  imageUrl: string;
  icon: AnnouncementIcon;
  layout: AnnouncementLayout;
  buttonText: string;
  buttonUrl: string;
  showOnHome: boolean;
  showOnDashboard: boolean;
  text: string;
  link: string;
  active: boolean;
  /** الأولوية: الأصغر يظهر أولاً */
  sortOrder: number;
  startsAt: string | null;
  endsAt: string | null;
  audience: AnnouncementAudience;
  createdAt: string;
}

function mapAnnouncement(r: Record<string, unknown>): Announcement {
  const icon = String(r.icon ?? "megaphone") as AnnouncementIcon;
  const legacyText = String(r.text ?? "");
  const legacyLink = String(r.link ?? "");
  return {
    id: Number(r.id),
    // بيانات ما قبل 0009 لا تحمل عنواناً، فيُستخدم النص القديم عنواناً
    title: String(r.title ?? "").trim() || legacyText,
    description: String(r.description ?? ""),
    imageUrl: String(r.image_url ?? ""),
    icon: ANNOUNCEMENT_ICONS.includes(icon) ? icon : "megaphone",
    // قبل الهجرة 0010 لا يوجد العمود، فالكل «بطاقة»
    layout: r.layout === "banner" ? "banner" : "card",
    buttonText: String(r.button_text ?? ""),
    buttonUrl: String(r.button_url ?? "").trim() || legacyLink,
    showOnHome: r.show_on_home === undefined ? true : Boolean(r.show_on_home),
    showOnDashboard: r.show_on_dashboard === undefined ? true : Boolean(r.show_on_dashboard),
    text: legacyText,
    link: legacyLink,
    active: Boolean(r.active),
    sortOrder: Number(r.sort_order ?? 0),
    startsAt: r.starts_at ? String(r.starts_at) : null,
    endsAt: r.ends_at ? String(r.ends_at) : null,
    audience: (r.audience as AnnouncementAudience) ?? "all",
    createdAt: String(r.created_at ?? ""),
  };
}

/** حالة الإعلان الآن كما يراها الأدمن: نشط/مجدول/منتهٍ/معطّل */
export function announcementState(a: Announcement): "live" | "scheduled" | "expired" | "disabled" {
  if (!a.active) return "disabled";
  const now = Date.now();
  if (a.startsAt && new Date(a.startsAt).getTime() > now) return "scheduled";
  if (a.endsAt && new Date(a.endsAt).getTime() < now) return "expired";
  return "live";
}

export const getListAnnouncementsQueryKey = () => ["announcements"] as const;

/**
 * الإعلانات مرتّبة. سياسة RLS تعيد للزائر والمستخدم النشط فقط، وللأدمن الكل.
 * تعذّر القراءة (مثلاً قبل تطبيق الهجرة 0007) يعني ببساطة: لا شريط.
 */
export function useListAnnouncements() {
  return useQuery({
    queryKey: getListAnnouncementsQueryKey(),
    staleTime: 120_000,
    retry: 1,
    queryFn: async (): Promise<Announcement[]> => {
      const { data, error } = await supabase
        .from("announcements").select("*")
        .order("sort_order").order("id");
      if (error) return [];
      return ((data ?? []) as Record<string, unknown>[]).map(mapAnnouncement);
    },
  });
}

/**
 * الإعلانات المعروضة في مكان معيّن الآن.
 * سياسة RLS تكفّلت بالفئة والجدولة، وهنا نرشّح المعطّل (يراه الأدمن وحده)
 * والمكان، ونرتّب بالأولوية.
 */
export function visibleAnnouncements(
  list: Announcement[] | undefined,
  place: "home" | "dashboard",
): Announcement[] {
  const now = Date.now();
  return (list ?? [])
    .filter((a) => {
      if (!a.active || !a.title.trim()) return false;
      if (place === "home" ? !a.showOnHome : !a.showOnDashboard) return false;
      if (a.startsAt && new Date(a.startsAt).getTime() > now) return false;
      if (a.endsAt && new Date(a.endsAt).getTime() < now) return false;
      return true;
    })
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
}

export interface AnnouncementPayload {
  title: string;
  description?: string;
  imageUrl?: string;
  icon?: AnnouncementIcon;
  layout?: AnnouncementLayout;
  buttonText?: string;
  buttonUrl?: string;
  showOnHome?: boolean;
  showOnDashboard?: boolean;
  active?: boolean;
  sortOrder?: number;
  startsAt?: string | null;
  endsAt?: string | null;
  audience?: AnnouncementAudience;
}

function announcementRow(data: Partial<AnnouncementPayload>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (data.title !== undefined) row.title = data.title.trim().slice(0, 120);
  if (data.description !== undefined) row.description = data.description.trim().slice(0, 300);
  if (data.imageUrl !== undefined) row.image_url = data.imageUrl.trim().slice(0, 1000);
  if (data.icon !== undefined) row.icon = data.icon;
  if (data.layout !== undefined) row.layout = data.layout;
  if (data.buttonText !== undefined) row.button_text = data.buttonText.trim().slice(0, 40);
  if (data.buttonUrl !== undefined) row.button_url = data.buttonUrl.trim().slice(0, 500);
  if (data.showOnHome !== undefined) row.show_on_home = data.showOnHome;
  if (data.showOnDashboard !== undefined) row.show_on_dashboard = data.showOnDashboard;
  if (data.active !== undefined) row.active = data.active;
  if (data.sortOrder !== undefined) row.sort_order = data.sortOrder;
  if (data.startsAt !== undefined) row.starts_at = data.startsAt || null;
  if (data.endsAt !== undefined) row.ends_at = data.endsAt || null;
  if (data.audience !== undefined) row.audience = data.audience;
  return row;
}

export function useCreateAnnouncement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: AnnouncementPayload): Promise<Announcement> => {
      const { data: row, error } = await supabase
        .from("announcements").insert(announcementRow(data)).select("*").single();
      throwIf(error);
      return mapAnnouncement(row as Record<string, unknown>);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: getListAnnouncementsQueryKey() }),
  });
}

export function useUpdateAnnouncement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<AnnouncementPayload> }) => {
      const row = announcementRow(data);
      if (Object.keys(row).length === 0) return;
      const { error } = await supabase.from("announcements").update(row).eq("id", id);
      throwIf(error);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: getListAnnouncementsQueryKey() }),
  });
}

export function useDeleteAnnouncement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: number }) => {
      const { error } = await supabase.from("announcements").delete().eq("id", id);
      throwIf(error);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: getListAnnouncementsQueryKey() }),
  });
}

/** يعيد ترقيم sort_order لكل القائمة بالترتيب المعطى (بعد تحريك عنصر) */
export function useReorderAnnouncements() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ orderedIds }: { orderedIds: number[] }) => {
      for (let i = 0; i < orderedIds.length; i++) {
        const { error } = await supabase
          .from("announcements").update({ sort_order: i + 1 }).eq("id", orderedIds[i]);
        throwIf(error);
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: getListAnnouncementsQueryKey() }),
  });
}

// ---------------- الأدمن: كل المدعوين ----------------
export interface AdminGuest extends Guest {
  eventTitle: string;
  eventDate: string | null;
}

export const getListAdminGuestsQueryKey = () => ["admin", "guests"] as const;

/** كل المدعوين في المنصة مع اسم المناسبة — سياسة RLS تسمح بذلك للأدمن فقط */
export function useListAdminGuests() {
  return useQuery({
    queryKey: getListAdminGuestsQueryKey(),
    queryFn: async (): Promise<AdminGuest[]> => {
      const { data, error } = await supabase
        .from("guests")
        .select("*, events(title, event_date)")
        .order("created_at", { ascending: false })
        .limit(2000);
      throwIf(error);
      return ((data ?? []) as Record<string, unknown>[]).map((r) => {
        const ev = (r.events ?? {}) as Record<string, unknown>;
        return {
          ...mapGuest(r as never),
          eventTitle: String(ev.title ?? "—"),
          eventDate: ev.event_date ? String(ev.event_date) : null,
        };
      });
    },
  });
}
