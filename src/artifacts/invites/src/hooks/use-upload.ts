import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";

/**
 * حدود الرفع — مطابقة لحدود الـ Buckets في قاعدة البيانات.
 * التحقق هنا يوفّر على المستخدم انتظار رفع ملف سيُرفض على الخادم،
 * ويعطيه رسالة عربية مفهومة بدل خطأ Supabase الخام.
 * الحماية الحقيقية تبقى على الخادم: حدود الـ bucket وسياسات التخزين.
 */
export const UPLOAD_LIMITS = {
  image: { maxBytes: 5 * 1024 * 1024, label: "5 ميجابايت",
           types: ["image/jpeg", "image/png", "image/webp", "image/gif"] },
  audio: { maxBytes: 15 * 1024 * 1024, label: "15 ميجابايت",
           types: ["audio/mpeg", "audio/mp4", "audio/wav", "audio/ogg",
                   "audio/webm", "audio/aac", "audio/x-m4a"] },
} as const;

interface UseUploadOptions {
  onSuccess?: (response: { objectPath: string }) => void;
  onError?: (error: Error) => void;
}

/** يرفع الملف إلى Supabase Storage ويعيد رابطاً عاماً صالحاً للعرض مباشرة. */
export function useUpload(options?: UseUploadOptions) {
  const { user } = useAuth();
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);

  const uploadFile = async (file: File | Blob, name: string) => {
    if (!user) throw new Error("يجب تسجيل الدخول أولاً");
    try {
      setIsUploading(true);
      setProgress(0);

      const contentType = file.type || "application/octet-stream";
      const isAudio = contentType.startsWith("audio/") || /\.(mp3|wav|ogg|webm|m4a)$/i.test(name);
      const bucket = isAudio ? "event-audios" : "event-images";

      // تحقق مبكر من الحجم والنوع قبل استهلاك شبكة المستخدم
      const rule = isAudio ? UPLOAD_LIMITS.audio : UPLOAD_LIMITS.image;
      if (file.size > rule.maxBytes) {
        const mb = (file.size / 1024 / 1024).toFixed(1);
        throw new Error(
          `حجم الملف ${mb} ميجابايت ويتجاوز الحد المسموح (${rule.label}). اختر ملفاً أصغر.`
        );
      }
      // النوع الفارغ يأتي من تسجيلات الصوت في بعض متصفحات iOS، فنقبله
      if (contentType !== "application/octet-stream" &&
          !rule.types.includes(contentType as never) &&
          !contentType.startsWith(isAudio ? "audio/" : "image/")) {
        throw new Error(
          isAudio ? "صيغة الملف الصوتي غير مدعومة" : "صيغة الصورة غير مدعومة"
        );
      }
      const ext = name.includes(".") ? name.split(".").pop() : "bin";
      const path = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

      const { error } = await supabase.storage.from(bucket).upload(path, file, {
        contentType,
        upsert: false,
      });
      if (error) throw new Error(error.message);
      setProgress(100);

      const { data } = supabase.storage.from(bucket).getPublicUrl(path);
      const result = { objectPath: data.publicUrl };
      options?.onSuccess?.(result);
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error("فشل رفع الملف");
      options?.onError?.(error);
      throw error;
    } finally {
      setIsUploading(false);
      setProgress(0);
    }
  };

  return { uploadFile, isUploading, progress };
}
