import { useState, useRef, useEffect } from "react";
import { AppLayout } from "@/components/layout/app-layout";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Link, useLocation, useParams } from "wouter";
import { useCreateEvent, useUpdateEvent, useGetEvent, useListTemplates, useGetMe, getGetEventQueryKey, normalizePhone, isValidPhone } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Mic, Square, UploadCloud, ChevronRight, Loader2, Play, Pause } from "lucide-react";
import { useUpload } from "@/hooks/use-upload";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

/**
 * قيمة حقل datetime-local بالتوقيت المحلي للجهاز.
 *
 * كانت الصفحة تستخدم toISOString() وهو يعيد التوقيت العالمي UTC،
 * بينما الحقل يتوقع توقيتاً محلياً. النتيجة: كل مرة يُفتح نموذج
 * التعديل يظهر الموعد متأخراً بمقدار فرق التوقيت (ثلاث ساعات في
 * السعودية)، ومجرد الحفظ كان يُزحزح موعد المناسبة فعلياً.
 */
function toLocalInputValue(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return format(date, "yyyy-MM-dd'T'HH:mm");
}

const eventSchema = z.object({
  title: z.string().min(1, "عنوان المناسبة مطلوب"),
  category: z.enum(['wedding', 'engagement', 'birthday', 'graduation', 'meeting', 'general']),
  eventDate: z.string().min(1, "التاريخ والوقت مطلوب"),
  location: z.string().min(1, "موقع المناسبة مطلوب"),
  description: z.string().optional(),
  templateId: z.number().optional(),
  coverImage: z.string().optional(),
  audioFile: z.string().optional(),
    contactPhone: z
      .string()
      .optional()
      // التحقق يجري على الرقم بعد التوحيد، فيقبل الأرقام العربية
    // ٠٥٠١٢٣٤٥٦٧ والمسافات والأقواس، ويرفض رموزاً بلا أرقام كافية.
    .refine(
      (value) => !value || !value.trim() || isValidPhone(normalizePhone(value)),
      "رقم غير صالح — مثال: 0501234567 أو +966501234567",
    ),
    contactMethod: z.enum(["call", "whatsapp", "both"]).optional(),
});

type EventFormValues = z.infer<typeof eventSchema>;

export default function EventForm() {
  const params = useParams();
  const [, setLocation] = useLocation();
  const isEditing = Boolean(params.id && params.id !== "new");
  const eventId = isEditing ? Number(params.id) : null;

  const [step, setStep] = useState(1);
  const { data: templates } = useListTemplates();
  const { data: me } = useGetMe();
  const { data: eventData, isLoading: isLoadingEvent } = useGetEvent(eventId!, { query: { enabled: !!eventId, queryKey: getGetEventQueryKey(eventId!) } });
  
  const createEvent = useCreateEvent();
  const updateEvent = useUpdateEvent();
  
  const { uploadFile, isUploading } = useUpload();
  const { toast } = useToast();
  
  const form = useForm<EventFormValues>({
    resolver: zodResolver(eventSchema),
    defaultValues: {
      title: "",
      category: "general",
      eventDate: "",
      location: "",
      description: "",
      contactPhone: "",
      contactMethod: "both",
    }
  });

  const initializedRef = useRef(false);
  useEffect(() => {
    if (eventData && !initializedRef.current) {
      initializedRef.current = true;
      form.reset({
        title: eventData.title,
        category: eventData.category,
        eventDate: toLocalInputValue(eventData.eventDate),
        location: eventData.location,
        description: eventData.description,
        templateId: eventData.templateId || undefined,
        coverImage: eventData.coverImage || undefined,
        audioFile: eventData.audioFile || undefined,
        contactPhone: eventData.contactPhone || "",
        contactMethod: eventData.contactMethod || "both",
      });
    }
  }, [eventData, form]);

  const [isRecording, setIsRecording] = useState(false);
  const [isFinalizingRecording, setIsFinalizingRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioLoadError, setAudioLoadError] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  // نحتفظ بنوع الـ MIME الحقيقي الذي سجّله الجهاز
  const recordedMimeRef = useRef<string>("audio/mp4");

  /**
   * هل يدعم هذا الجهاز التسجيل الصوتي أصلاً؟
   *
   * MediaRecorder غير موجود في Safari على iOS قبل 14.3، وغير متاح
   * في أي متصفح على اتصال غير آمن (http). بدون هذا الفحص يضغط
   * المستخدم زر التسجيل فيحصل على خطأ عام لا يفهم سببه.
   */
  const canRecordAudio =
    typeof window !== "undefined" &&
    typeof MediaRecorder !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    (window.isSecureContext ?? location.protocol === "https:");

  /** يكتشف أفضل صيغة صوتية يدعمها المتصفح الحالي */
  function getSupportedAudioMime(): string {
    const candidates = [
      "audio/mp4",           // iOS Safari, Chrome
      "audio/webm;codecs=opus", // Chrome/Firefox desktop
      "audio/webm",
      "audio/ogg;codecs=opus",
      "audio/ogg",
    ];
    for (const t of candidates) {
      if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) return t;
    }
    return "";
  }

  const startRecording = async () => {
    if (isRecording || isFinalizingRecording) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = getSupportedAudioMime();
      const mediaRecorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      // مصفوفة chunks معزولة لكل مسجّل — تمنع اختلاط البيانات بين تسجيلين
      const chunks: BlobPart[] = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      mediaRecorder.onstop = () => {
        // استخدم النوع الفعلي الذي سجّله الجهاز، مع إزالة لاحقة codecs
        // لأن Storage يقبل النوع الأساسي فقط (audio/webm وليس audio/webm;codecs=opus)
        const rawMime = mediaRecorder.mimeType || mimeType || "audio/mp4";
        const baseMime = rawMime.split(";")[0].trim();
        recordedMimeRef.current = baseMime;
        const blob = new Blob(chunks, { type: baseMime });
        setAudioBlob(blob);
        setIsFinalizingRecording(false);
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (err) {
      console.error("Failed to access microphone", err);
      toast({
        title: "تعذر الوصول إلى الميكروفون",
        description: "تأكد من السماح للمتصفح باستخدام الميكروفون ثم أعد المحاولة",
        variant: "destructive",
      });
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      setIsFinalizingRecording(true);
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      mediaRecorderRef.current.stream.getTracks().forEach(t => t.stop());
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, field: 'coverImage' | 'audioFile') => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (field === 'audioFile') setAudioLoadError(false);
    try {
      const { objectPath } = await uploadFile(file, file.name);
      form.setValue(field, objectPath);
    } catch (err) {
      toast({
        title: "فشل رفع الملف",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    }
  };

  const handleAudioBlobUpload = async () => {
    if (!audioBlob) return;
    setAudioLoadError(false);
    // اشتق الامتداد من نوع MIME الفعلي
    const mime = recordedMimeRef.current;
    const ext = mime.includes("mp4") ? "m4a"
               : mime.includes("ogg") ? "ogg"
               : "webm";
    try {
      const { objectPath } = await uploadFile(audioBlob, `recording.${ext}`);
      form.setValue("audioFile", objectPath);
      setAudioBlob(null);
    } catch (err) {
      toast({
        title: "فشل رفع التسجيل الصوتي",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    }
  };

  const onSubmit = (data: EventFormValues) => {
    setSubmitError(null);
    // الحقل يعطي توقيتاً محلياً، وnew Date تقرأه محلياً ثم نحوّله إلى UTC
    // للتخزين — فتبقى اللحظة نفسها بلا أي انزياح.
    const parsed = new Date(data.eventDate);
    if (Number.isNaN(parsed.getTime())) {
      setSubmitError("التاريخ والوقت غير صالحين");
      return;
    }
    const payload = {
      ...data,
      description: data.description || "",
      eventDate: parsed.toISOString(),
    };

    if (isEditing && eventId) {
      updateEvent.mutate(
        { id: eventId, data: payload },
        {
          onSuccess: () => setLocation(`/events/${eventId}`),
          onError: (err) => setSubmitError(err instanceof Error ? err.message : "حدث خطأ غير متوقع"),
        }
      );
    } else {
      createEvent.mutate(
        { data: payload },
        {
          onSuccess: (res) => setLocation(`/events/${res.id}`),
          onError: (err) => {
            const msg = err instanceof Error ? err.message : "حدث خطأ غير متوقع";
            // [ع-5] قاعدة البيانات ترسل EVENTS_LIMIT_REACHED:<الحد>،
            // فتُبنى الرسالة بالحد الفعلي بدل نص ثابت كان يقول "دعوة واحدة"
            // بينما الحد الحقيقي ثلاث دعوات.
            const limitMatch = msg.match(/EVENTS_LIMIT_REACHED:(\d+)/);
            if (limitMatch) {
              const limit = Number(limitMatch[1]) || me?.eventsLimit || 1;
              setSubmitError(
                `لقد وصلت إلى الحد الأقصى لباقتك الحالية (${limit} ${limit === 1 ? "دعوة" : "دعوات"}). ` +
                `احذف إحدى دعواتك لإنشاء دعوة جديدة، أو قم بالترقية إلى الباقة الماسية.`
              );
            } else {
              setSubmitError(msg);
            }
          },
        }
      );
    }
  };

  if (isEditing && isLoadingEvent) {
    return (
      <AppLayout>
        <div className="flex justify-center py-32"><Loader2 className="w-8 h-8 animate-spin text-gold" /></div>
      </AppLayout>
    );
  }

  const selectedCategory = form.watch("category");

  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto p-6 md:p-10">
        <div className="mb-8">
          <Link href="/events" className="text-gray-600 hover:text-gray-900 inline-flex items-center gap-1 text-sm font-medium mb-4">
            <ChevronRight className="w-4 h-4" /> عودة للدعوات
          </Link>
          <h1 className="text-3xl font-bold text-gray-900">{isEditing ? 'تعديل الدعوة' : 'إنشاء دعوة جديدة'}</h1>
          
          <div className="flex items-center mt-6">
            <div className={`h-2 flex-1 rounded-r-full ${step >= 1 ? 'bg-gold' : 'bg-gray-200'}`} />
            <div className="w-1" />
            <div className={`h-2 flex-1 ${step >= 2 ? 'bg-gold' : 'bg-gray-200'}`} />
            <div className="w-1" />
            <div className={`h-2 flex-1 rounded-l-full ${step >= 3 ? 'bg-gold' : 'bg-gray-200'}`} />
          </div>
          <div className="flex justify-between mt-2 text-sm text-gray-600 font-medium px-2">
            <span>التفاصيل</span>
            <span>القالب</span>
            <span>الوسائط</span>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 md:p-8">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              
              {/* Step 1: Details */}
              <div className={step === 1 ? "block" : "hidden"}>
                <h2 className="text-xl font-bold mb-6 text-gray-900">تفاصيل المناسبة</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <FormField
                    control={form.control}
                    name="title"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>عنوان المناسبة</FormLabel>
                        <FormControl><Input placeholder="مثال: حفل زفاف أحمد وسارة" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="category"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>نوع المناسبة</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger dir="rtl"><SelectValue placeholder="اختر النوع" /></SelectTrigger>
                          </FormControl>
                          <SelectContent dir="rtl">
                            <SelectItem value="wedding">زفاف</SelectItem>
                            <SelectItem value="engagement">خطوبة</SelectItem>
                            <SelectItem value="graduation">تخرج</SelectItem>
                            <SelectItem value="birthday">ميلاد</SelectItem>
                            <SelectItem value="meeting">اجتماع</SelectItem>
                            <SelectItem value="general">عام</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="eventDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>التاريخ والوقت</FormLabel>
                        <FormControl><Input type="datetime-local" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="location"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>موقع المناسبة (قاعة، رابط خرائط)</FormLabel>
                        <FormControl><Input placeholder="الرياض، قاعة الماسية" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="description"
                    render={({ field }) => (
                      <FormItem className="col-span-1 md:col-span-2">
                        <FormLabel>وصف أو رسالة الدعوة</FormLabel>
                        <FormControl>
                          <Textarea 
                            placeholder="نتشرف بدعوتكم لحضور..." 
                            className="h-24 resize-none"
                            {...field} 
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="contactPhone"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>رقم التواصل للاستفسارات (اختياري)</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="0501234567"
                            dir="ltr"
                            type="tel"
                            inputMode="tel"
                            autoComplete="tel"
                            className="text-right"
                            {...field}
                            value={field.value ?? ""}
                          />
                        </FormControl>
                        <p className="text-xs text-gray-500">
                          يظهر للمدعو داخل صفحة الدعوة مع زر اتصال أو واتساب.
                        </p>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="contactMethod"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>طريقة التواصل المعروضة للمدعو</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value ?? "both"}>
                          <FormControl>
                            <SelectTrigger dir="rtl">
                              <SelectValue placeholder="اختر الطريقة" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent dir="rtl">
                            <SelectItem value="both">اتصال وواتساب</SelectItem>
                            <SelectItem value="call">اتصال فقط</SelectItem>
                            <SelectItem value="whatsapp">واتساب فقط</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="mt-8 flex justify-end">
                  <Button type="button" onClick={() => form.trigger(['title', 'category', 'eventDate', 'location']).then(valid => valid && setStep(2))} className="bg-ink hover:bg-ink-soft text-gold px-8">
                    التالي
                  </Button>
                </div>
              </div>

              {/* Step 2: Templates */}
              <div className={step === 2 ? "block" : "hidden"}>
                <h2 className="text-xl font-bold mb-6 text-gray-900">اختر قالباً للدعوة</h2>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {templates?.filter(t => t.category === selectedCategory || t.category === 'general').map(template => (
                    <div 
                      key={template.id} 
                      onClick={() => form.setValue("templateId", template.id)}
                      className={`cursor-pointer rounded-xl overflow-hidden border-2 transition-all ${
                        form.watch("templateId") === template.id ? "border-gold ring-2 ring-gold/20" : "border-transparent hover:border-gray-200"
                      }`}
                    >
                      <img src={template.previewImage} alt={template.name} className="w-full aspect-[3/4] object-cover bg-gray-100" />
                      <div className="p-3 bg-gray-50 text-center font-medium text-sm text-gray-900 border-t border-gray-100">
                        {template.name}
                      </div>
                    </div>
                  ))}
                  {templates?.filter(t => t.category === selectedCategory || t.category === 'general').length === 0 && (
                    <div className="col-span-full py-10 text-center text-gray-600">لا توجد قوالب متاحة لهذا النوع حالياً</div>
                  )}
                </div>
                <div className="mt-8 flex justify-between">
                  <Button type="button" variant="outline" onClick={() => setStep(1)}>السابق</Button>
                  <Button type="button" onClick={() => setStep(3)} className="bg-ink hover:bg-ink-soft text-gold px-8">
                    التالي
                  </Button>
                </div>
              </div>

              {/* Step 3: Media */}
              <div className={step === 3 ? "block" : "hidden"}>
                <h2 className="text-xl font-bold mb-6 text-gray-900">الوسائط والصوتيات</h2>
                <div className="space-y-8">
                  
                  <div>
                    <h3 className="text-sm font-semibold mb-3">صورة الغلاف (اختياري)</h3>
                    <div className="border-2 border-dashed border-gray-200 rounded-xl p-8 text-center hover:bg-gray-50 transition-colors">
                      {form.watch("coverImage") ? (
                        <div className="flex flex-col items-center">
                          <img src={form.watch("coverImage")} className="h-32 object-contain rounded-md mb-4" alt="Cover preview" />
                          <Button type="button" variant="outline" size="sm" onClick={() => form.setValue("coverImage", undefined)}>حذف الصورة</Button>
                        </div>
                      ) : (
                        <label className="cursor-pointer flex flex-col items-center">
                          <UploadCloud className="w-8 h-8 text-gray-400 mb-2" />
                          <span className="text-sm font-medium text-gray-600">اختر صورة الغلاف</span>
                          <input type="file" className="hidden" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(e) => handleFileUpload(e, 'coverImage')} disabled={isUploading} />
                        </label>
                      )}
                    </div>
                  </div>

                  <div>
                    <h3 className="text-sm font-semibold mb-3">رسالة صوتية (اختياري)</h3>
                    {form.watch("audioFile") ? (
                      <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-3">
                        <div className="flex items-center gap-3">
                          {audioLoadError ? (
                            <div className="flex-1 flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                              <span className="text-sm text-amber-700">✓ تم رفع الملف الصوتي بنجاح — سيُشغَّل في صفحة الدعوة</span>
                              <a
                                href={form.watch("audioFile")}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-blue-600 underline shrink-0"
                              >
                                اختبار الرابط
                              </a>
                            </div>
                          ) : (
                            <audio
                              src={form.watch("audioFile")}
                              controls
                              className="h-10 flex-1 min-w-0"
                              onError={() => setAudioLoadError(true)}
                              onLoadedData={() => setAudioLoadError(false)}
                            />
                          )}
                          <Button
                            type="button"
                            variant="ghost"
                            className="text-red-600 shrink-0 px-2"
                            onClick={() => { form.setValue("audioFile", undefined); setAudioLoadError(false); }}
                          >
                            حذف
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="border border-gray-200 rounded-xl p-6 text-center">
                          <label className="cursor-pointer flex flex-col items-center">
                            <UploadCloud className="w-6 h-6 text-gray-400 mb-2" />
                            <span className="text-sm font-medium text-gray-600">رفع ملف صوتي (MP3)</span>
                            <input type="file" className="hidden" accept="audio/mpeg,audio/mp4,audio/wav,audio/ogg,audio/webm,audio/aac,.m4a" onChange={(e) => handleFileUpload(e, 'audioFile')} disabled={isUploading} />
                          </label>
                        </div>
                        
                        <div className="border border-gray-200 rounded-xl p-6 text-center flex flex-col items-center justify-center">
                          {audioBlob ? (
                            <div className="flex flex-col items-center gap-2 w-full">
                              <span className="text-sm text-emerald-600 font-medium">تم تسجيل المقطع</span>
                              <div className="flex gap-2 w-full">
                                <Button type="button" size="sm" variant="outline" className="flex-1" onClick={() => setAudioBlob(null)}>حذف</Button>
                                <Button type="button" size="sm" className="flex-1 bg-ink text-gold-light" onClick={handleAudioBlobUpload} disabled={isUploading}>استخدام</Button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex flex-col items-center">
                              <Button 
                                type="button" 
                                variant={isRecording ? "destructive" : "outline"}
                                className={`rounded-full w-12 h-12 p-0 ${isRecording ? 'animate-pulse' : ''}`}
                                onClick={isRecording ? stopRecording : startRecording}
                                disabled={isFinalizingRecording || !canRecordAudio}
                                title={canRecordAudio ? undefined
                                  : "التسجيل غير مدعوم في هذا المتصفح — ارفع ملفاً صوتياً بدلاً منه"}
                              >
                                {isFinalizingRecording ? <Loader2 className="w-5 h-5 animate-spin" /> : isRecording ? <Square className="w-5 h-5 fill-current" /> : <Mic className="w-5 h-5" />}
                              </Button>
                              <span className="text-sm font-medium text-gray-600 mt-2">
                                {!canRecordAudio ? 'التسجيل غير مدعوم هنا'
                                  : isFinalizingRecording ? 'جارٍ معالجة التسجيل…'
                                  : isRecording ? 'إيقاف التسجيل' : 'تسجيل بصوتك'}
                              </span>
                              {!canRecordAudio && (
                                <span className="text-xs text-gray-600 mt-1 text-center max-w-[13rem]">
                                  متصفحك لا يدعم التسجيل (Safari قبل iOS 14.3 مثلاً).
                                  استخدم زر رفع ملف صوتي بدلاً منه.
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {submitError && (
                  <div className="mt-6 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700 text-right">
                    ⚠️ {submitError}
                  </div>
                )}

                <div className="mt-4 flex justify-between">
                  <Button type="button" variant="outline" onClick={() => setStep(2)}>السابق</Button>
                  <Button
                    type="submit"
                    disabled={createEvent.isPending || updateEvent.isPending || isUploading || isRecording || isFinalizingRecording}
                    className="bg-gold hover:bg-gold/90 text-black px-8 font-bold"
                  >
                    {(createEvent.isPending || updateEvent.isPending) && <Loader2 className="w-4 h-4 ml-2 animate-spin" />}
                    {isUploading ? "جارٍ الرفع…" : isRecording || isFinalizingRecording ? "أكمل التسجيل أولاً" : "حفظ ونشر الدعوة"}
                  </Button>
                </div>
              </div>

            </form>
          </Form>
        </div>
      </div>
    </AppLayout>
  );
}
