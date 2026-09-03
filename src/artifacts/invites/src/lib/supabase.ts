import { createClient } from "@supabase/supabase-js";

/**
 * الإعداد يُقرأ وقت التشغيل من public/config.js لا وقت البناء.
 *
 * السبب: متغيرات VITE_ تُدمج داخل ملفات JavaScript لحظة البناء، فأي
 * تغيير في الرابط أو المفتاح كان يستلزم إعادة بناء الموقع ورفعه من
 * جديد. بهذه الطريقة يكفي تعديل سطر واحد في config.js وتحديث الصفحة.
 */
type AppConfig = {
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
  APP_URL?: string;
};

const runtime: AppConfig =
  (typeof window !== "undefined" &&
    (window as unknown as { __APP_CONFIG__?: AppConfig }).__APP_CONFIG__) || {};

export const supabaseUrl =
  runtime.SUPABASE_URL?.trim() || (import.meta.env.VITE_SUPABASE_URL as string) || "";

export const supabaseAnonKey =
  runtime.SUPABASE_ANON_KEY?.trim() ||
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string) ||
  "";

export const appUrl =
  runtime.APP_URL?.trim() ||
  (import.meta.env.VITE_APP_URL as string) ||
  (typeof window !== "undefined" ? window.location.origin : "");

/** هل الإعداد مكتمل؟ تُستخدم لعرض شاشة إرشاد بدل صفحة بيضاء */
export const isConfigured = Boolean(supabaseUrl && supabaseAnonKey);

// عميل صالح دائماً: لو نقص الإعداد نعرض شاشة الإرشاد قبل أي استدعاء
export const supabase = createClient(
  supabaseUrl || "https://placeholder.supabase.co",
  supabaseAnonKey || "placeholder-key",
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  },
);
