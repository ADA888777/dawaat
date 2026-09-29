import { useRef, useState } from "react";
import { ImagePlus, Link2, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { UPLOAD_LIMITS, useUpload } from "@/hooks/use-upload";
import { useToast } from "@/hooks/use-toast";

interface AnnouncementImageFieldProps {
  /** رابط الصورة الحالي (فارغ = تُعرض الأيقونة بدلها) */
  value: string;
  /** يُستدعى بالرابط الجديد بعد الرفع أو اللصق، أو بنص فارغ عند الإزالة */
  onChange: (url: string) => void;
  disabled?: boolean;
  /** معرّف لعناصر الاختبار */
  testId?: string;
}

/**
 * صورة الإعلان: رفع من الجهاز (إلى bucket الصور العامة في Supabase) مع
 * معاينة فورية، أو لصق رابط جاهز. الصورة اختيارية وتحل محل الأيقونة.
 */
export function AnnouncementImageField({
  value,
  onChange,
  disabled = false,
  testId = "announcement-image",
}: AnnouncementImageFieldProps) {
  const { toast } = useToast();
  const { uploadFile, isUploading } = useUpload();
  const inputRef = useRef<HTMLInputElement>(null);
  const [showUrl, setShowUrl] = useState(false);
  const [urlDraft, setUrlDraft] = useState("");

  const pick = async (file: File | undefined) => {
    if (!file) return;
    try {
      const { objectPath } = await uploadFile(file, file.name);
      onChange(objectPath);
      toast({ title: "رُفعت الصورة" });
    } catch (err) {
      toast({
        title: "تعذّر رفع الصورة",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    }
  };

  const applyUrl = () => {
    const url = urlDraft.trim();
    if (!/^https?:\/\//i.test(url)) {
      toast({ title: "الرابط يجب أن يبدأ بـ https://", variant: "destructive" });
      return;
    }
    onChange(url);
    setUrlDraft("");
    setShowUrl(false);
  };

  const busy = disabled || isUploading;

  return (
    <div className="space-y-2" data-testid={testId}>
      <input
        ref={inputRef}
        type="file"
        accept={UPLOAD_LIMITS.image.types.join(",")}
        className="hidden"
        data-testid={testId + "-input"}
        onChange={(event) => {
          void pick(event.target.files?.[0]);
          event.target.value = "";
        }}
      />

      <div className="flex items-center gap-3">
        {/* المعاينة بنفس شكل أيقونة البطاقة في الشريط */}
        <span className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-gold/30 bg-gold/10">
          {value ? (
            <img src={value} alt="" className="h-full w-full object-cover" />
          ) : (
            <ImagePlus className="h-5 w-5 text-gold-deep" strokeWidth={1.8} />
          )}
        </span>

        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="border-line"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            data-testid={testId + "-upload"}
          >
            {isUploading ? (
              <Loader2 className="ml-1 h-4 w-4 animate-spin" />
            ) : (
              <ImagePlus className="ml-1 h-4 w-4" />
            )}
            {value ? "تغيير الصورة" : "رفع صورة"}
          </Button>
          <button
            type="button"
            onClick={() => setShowUrl((v) => !v)}
            disabled={busy}
            className="inline-flex items-center gap-1 text-xs text-gold-deep underline disabled:opacity-50"
          >
            <Link2 className="h-3.5 w-3.5" /> أو الصق رابط صورة
          </button>
          {value && (
            <button
              type="button"
              onClick={() => onChange("")}
              disabled={busy}
              className="inline-flex items-center gap-1 text-xs text-red-600 underline disabled:opacity-50"
              data-testid={testId + "-remove"}
            >
              <X className="h-3.5 w-3.5" /> إزالة الصورة
            </button>
          )}
        </div>
      </div>

      {showUrl && (
        <div className="flex gap-2">
          <Input
            value={urlDraft}
            onChange={(event) => setUrlDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                applyUrl();
              }
            }}
            dir="ltr"
            className="h-9 text-xs"
            placeholder="https://…"
            aria-label="رابط الصورة"
          />
          <Button type="button" size="sm" variant="outline" className="border-line" onClick={applyUrl}>
            استخدام
          </Button>
        </div>
      )}

      <p className="text-[11px] text-gray-500">
        اختيارية — تحل محل الأيقونة. JPG أو PNG أو WebP حتى {UPLOAD_LIMITS.image.label}؛ الأنسب صورة مربعة.
      </p>
    </div>
  );
}
