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

/**
 * خريطة الأرقام الشرقية (العربية والفارسية) إلى الغربية.
 * لوحة المفاتيح العربية على iPhone وAndroid تكتب ٠١٢…، وكانت
 * replace(/\D/g) تحذفها بالكامل فيصبح الرقم فارغاً و«غير صالح».
 */
const EASTERN_DIGITS: Record<string, string> = {
  "\u0660": "0", "\u0661": "1", "\u0662": "2", "\u0663": "3", "\u0664": "4",
  "\u0665": "5", "\u0666": "6", "\u0667": "7", "\u0668": "8", "\u0669": "9",
  "\u06F0": "0", "\u06F1": "1", "\u06F2": "2", "\u06F3": "3", "\u06F4": "4",
  "\u06F5": "5", "\u06F6": "6", "\u06F7": "7", "\u06F8": "8", "\u06F9": "9",
};

/** يحوّل أي أرقام شرقية في النص إلى أرقام غربية */
export function toWesternDigits(raw: string): string {
  return String(raw ?? "").replace(
    /[\u0660-\u0669\u06F0-\u06F9]/g,
    (d) => EASTERN_DIGITS[d] ?? d,
  );
}

/**
 * توحيد صيغة الجوال — صيغة واحدة في كل المنصة.
 * - الأرقام الشرقية تُحوَّل إلى غربية.
 * - البادئة الدولية 00 تُحوَّل إلى + حتى لا يتجاوز الرقم 15 خانة
 *   ولا يُخزَّن نفس الشخص مرتين بصيغتين مختلفتين.
 */
export function normalizePhone(raw: string): string {
  const trimmed = toWesternDigits(raw).trim();
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return "";
  if (trimmed.startsWith("+")) return "+" + digits;
  if (digits.startsWith("00")) return "+" + digits.slice(2);
  return digits;
}

/**
 * مفتاح مطابقة واحد لكل رقم: آخر تسع خانات.
 * بهذا يُعتبر 0501234567 و+966501234567 و00966501234567 شخصاً واحداً،
 * وهي نفس القاعدة التي تستخدمها تطبيقات المراسلة.
 */
export function phoneMatchKey(raw: string): string {
  const digits = normalizePhone(raw).replace(/\D/g, "");
  return digits.length > 9 ? digits.slice(-9) : digits;
}

/** نفس التحقق المطبّق في قاعدة البيانات — رفض مبكر برسالة أوضح */
export function isValidPhone(phone: string): boolean {
  return /^\+?[0-9]{9,15}$/.test(phone);
}

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

function invalidateGuests(qc: ReturnType<typeof useQueryClient>, eventId: number) {
  qc.invalidateQueries({ queryKey: getListGuestsQueryKey(eventId) });
  qc.invalidateQueries({ queryKey: getGetEventQueryKey(eventId) });
  qc.invalidateQueries({ queryKey: getListEventsQueryKey() });
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

      // نظّف ووحّد الأرقام، ثم أزل التكرار داخل الملف نفسه
      const seen = new Set<string>();
      const rows: { event_id: number; name: string; phone: string }[] = [];
      let skipped = 0;

      for (const g of data.guests) {
        const name = (g.name ?? "").trim();
        const phone = normalizePhone(g.phone ?? "");
        if (!name || !isValidPhone(phone) || seen.has(phone)) {
          skipped++;
          continue;
        }
        seen.add(phone);
        rows.push({ event_id: eventId, name: name.slice(0, 100), phone });
      }

      if (rows.length === 0) return { created: 0, skipped };

      // [ح-3] upsert بدل insert: تكرار الاستيراد لم يعد يضاعف المدعوين.
      // ignoreDuplicates يُبقي رد المدعو الحالي كما هو ولا يدهسه.
      const { error } = await supabase
        .from("guests")
        .upsert(rows, { onConflict: "event_id,phone", ignoreDuplicates: true });
      throwIf(error);
      return { created: rows.length, skipped };
    },
    onSuccess: (_d, vars) => invalidateGuests(qc, vars.eventId),
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
  reminderType: "24h" | "3h";
  eventTitle: string;
  eventDate: string;
}

/** [م-2] مشتقّة أيضاً من نفس الاستعلام — بلا رحلة شبكة إضافية. */
export function useListNotifications() {
  const { user } = useAuth();
  // تفضيلات التذكير تُقرأ من الحساب: إيقافها من صفحة الإعدادات يُفرغ القائمة فعلياً
  const { data: me } = useGetMe();
  const remindersOn = me?.notifyReminders ?? true;
  const want24h = me?.reminder24h ?? true;
  const want3h = me?.reminder3h ?? true;
  return useQuery({
    queryKey: getListEventsQueryKey(),
    enabled: !!user,
    queryFn: () => fetchMyEvents(user!.id),
    select: (events): EventNotification[] => {
      if (!remindersOn) return [];
      const now = Date.now();
      const out: EventNotification[] = [];
      for (const e of events) {
        const diff = new Date(e.eventDate).getTime() - now;
        if (diff <= 0) continue;
        if (diff <= 3 * 3600_000) {
          if (want3h) out.push({ reminderType: "3h", eventTitle: e.title, eventDate: e.eventDate });
        } else if (diff <= 24 * 3600_000) {
          if (want24h) out.push({ reminderType: "24h", eventTitle: e.title, eventDate: e.eventDate });
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
}

const APP_SETTINGS_COLUMNS: Record<keyof AppSettings, string> = {
  siteName: "site_name",
  supportEmail: "support_email",
  supportPhone: "support_phone",
  supportWhatsapp: "support_whatsapp",
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
};

export const DEFAULT_APP_SETTINGS: AppSettings = {
  siteName: "دعوات",
  supportEmail: "",
  supportPhone: "",
  supportWhatsapp: "",
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
        if (typeof fallback === "boolean") out[key] = Boolean(value);
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
        row[column] = typeof value === "string" ? value.slice(0, 20000) : value;
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
