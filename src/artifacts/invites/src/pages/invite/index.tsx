import { useState } from "react";
import { useParams } from "wouter";
import {
  getGetPublicInvitationQueryKey,
  useGetPublicInvitation,
  useSubmitRsvp,
  useGetGuestByToken,
  useSubmitRsvpByToken,
} from "@/lib/api";
import { Loader2, Music, MapPin, Calendar as CalendarIcon, Check, PartyPopper, X, Phone, MessageCircle } from "lucide-react";
import { format } from "date-fns";
import { ar } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { appUrl } from "@/lib/supabase";
import { QrCode } from "@/components/qr-code";
import { buildPublicInviteUrl, toDialNumber, toWhatsAppNumber } from "@/lib/invite";

/** أصل الروابط الصحيح — نفس المستخدم في لوحة صاحب الدعوة */
const APP_ORIGIN = appUrl.replace(/\/$/, "");

export default function PublicInvite() {
  const { slug } = useParams();

  // [ح-2] الرابط يحمل رمزاً شخصياً عشوائياً فقط (?t=uuid).
  // سابقاً كان يحمل ?phone= و ?name= بنص صريح، فكان تمرير الرسالة
  // يكشف رقم المدعو ويسمح لأي شخص بالرد بالنيابة عنه.
  const params = new URLSearchParams(window.location.search);
  const inviteToken = params.get("t");

  const { data: invite, isLoading, isError } = useGetPublicInvitation(slug!, { query: { enabled: !!slug, queryKey: getGetPublicInvitationQueryKey(slug!) } });
  const { data: tokenGuest, isLoading: isLoadingGuest } = useGetGuestByToken(inviteToken);
  const submitRsvp = useSubmitRsvp();
  const submitByToken = useSubmitRsvpByToken();

  // المدعو مُعرَّف فقط إذا نجح تحويل الرمز إلى صف حقيقي في قاعدة البيانات
  const isPreidentified = !!inviteToken && !!tokenGuest;

  const [name, setName]   = useState("");
  const [phone, setPhone] = useState("");
  const [status, setStatus] = useState<'attending' | 'maybe' | 'declined'>('attending');
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [audioError, setAudioError] = useState(false);

  const [formError, setFormError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!name.trim() || !phone.trim()) return;
    submitRsvp.mutate({ slug: slug!, data: { name, phone, attendanceStatus: status } }, {
      onSuccess: () => setIsSubmitted(true),
      onError: (err) =>
        setFormError(err instanceof Error ? err.message : "تعذر تسجيل ردك، حاول مجدداً"),
    });
  };

  // [ح-2] المدعو المُعرَّف: الرد بالرمز وحده — بلا اسم ولا جوال في الطلب
  const handleQuickRsvp = (s: 'attending' | 'declined') => {
    if (!inviteToken) return;
    setFormError(null);
    submitByToken.mutate(
      { token: inviteToken, attendanceStatus: s },
      {
        onSuccess: () => setIsSubmitted(true),
        onError: (err) =>
          setFormError(err instanceof Error ? err.message : "تعذر تسجيل ردك، حاول مجدداً"),
      }
    );
  };

  const isSending = submitRsvp.isPending || submitByToken.isPending;

  if (isLoading || (!!inviteToken && isLoadingGuest)) {
    return (
      <div className="min-h-screen bg-ink flex items-center justify-center">
        <Loader2 className="w-10 h-10 animate-spin text-gold-light" />
      </div>
    );
  }

  if (isError || !invite) {
    return (
      <div className="min-h-screen bg-ink flex items-center justify-center text-white">
        <div className="text-center space-y-4">
          <h1 className="text-3xl font-serif text-gold-light">الدعوة غير متاحة</h1>
          <p className="text-gray-400">عذراً، لا يمكن العثور على هذه الدعوة أو ربما تم حذفها.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-ink text-white flex flex-col font-serif relative overflow-hidden">
      {/* Background Decor */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-gold/10 via-ink to-ink -z-10" />
      {/* [ن-6] نقشة محلية بدل صورة من نطاق خارجي — لا تعتمد صفحة الدعوة
          على توفر طرف ثالث، ولا يصل أي طلب من المدعوين إلى خارج نطاقنا */}
      <div
        className="absolute top-0 left-0 w-full h-full opacity-[0.07] mix-blend-overlay pointer-events-none"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, var(--gold) 1px, transparent 0)",
          backgroundSize: "28px 28px",
        }}
      />

      <main className="flex-1 flex flex-col md:flex-row max-w-6xl w-full mx-auto shadow-2xl relative z-10 md:my-10 bg-ink-soft border border-white/5 md:rounded-2xl overflow-hidden">
        
        {/* Visual / Image Side */}
        <div className="w-full md:w-1/2 relative min-h-[40vh] md:min-h-full">
          {invite.coverImage ? (
            <img 
              src={invite.coverImage} 
              alt={invite.title}
              className="absolute inset-0 w-full h-full object-cover"
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center bg-gold/10">
              <span className="text-gold-light text-4xl font-bold opacity-30 tracking-widest">دعوات</span>
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-ink-soft via-ink-soft/40 to-transparent md:bg-gradient-to-r" />
          
          <div className="absolute bottom-8 left-8 right-8 text-center md:text-right">
            <span className="text-gold-light text-sm font-sans tracking-widest uppercase mb-2 block">
              {invite.category === 'wedding' ? 'حفل زفاف' : 
               invite.category === 'engagement' ? 'حفل خطوبة' :
               invite.category === 'graduation' ? 'حفل تخرج' :
               invite.category === 'birthday' ? 'حفل ميلاد' :
               invite.category === 'meeting' ? 'اجتماع' : 'دعوة خاصة'}
            </span>
            <h1 className="text-4xl md:text-5xl font-bold leading-tight mb-4">{invite.title}</h1>
          </div>
        </div>

        {/* Content Side */}
        <div className="w-full md:w-1/2 p-8 md:p-12 lg:p-16 flex flex-col overflow-y-auto">
          
          <div className="space-y-8 flex-1">
            {invite.description && (
              <div className="text-center font-sans">
                <p className="text-lg text-gray-300 leading-relaxed whitespace-pre-line border-y border-white/10 py-8">
                  {invite.description}
                </p>
              </div>
            )}

            <div className="space-y-6 bg-black/40 p-6 rounded-xl border border-white/5 font-sans">
              <div className="flex items-center gap-4 text-gray-300">
                <div className="w-12 h-12 rounded-full bg-gold/10 flex items-center justify-center text-gold-light shrink-0">
                  <CalendarIcon className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-sm text-gray-400 mb-1">الزمان</p>
                  <p className="font-medium text-lg">{format(new Date(invite.eventDate), 'EEEE، dd MMMM yyyy', { locale: ar })}</p>
                  <p className="text-gold-light">{format(new Date(invite.eventDate), 'hh:mm a', { locale: ar })}</p>
                </div>
              </div>

              <div className="flex items-center gap-4 text-gray-300">
                <div className="w-12 h-12 rounded-full bg-gold/10 flex items-center justify-center text-gold-light shrink-0">
                  <MapPin className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-sm text-gray-400 mb-1">المكان</p>
                  <p className="font-medium text-lg">{invite.location}</p>
                </div>
              </div>
            </div>

            {invite.audioFile && (
              <div className="bg-gold/5 p-4 rounded-xl border border-gold/20 flex items-center gap-4 font-sans">
                <Music className="w-5 h-5 text-gold-light shrink-0" />
                {audioError ? (
                  <a
                    href={invite.audioFile}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-gold-light underline"
                  >
                    استمع إلى الرسالة الصوتية ↗
                  </a>
                ) : (
                  <audio
                    src={invite.audioFile}
                    controls
                    /* iOS Safari لا يحمّل الصوت قبل لمسة المستخدم؛
                       preload=metadata يجعل المدة تظهر دون تنزيل الملف كاملاً،
                       و playsInline يمنع فتح المشغّل بملء الشاشة على iPhone */
                    preload="metadata"
                    playsInline
                    className="w-full h-10 opacity-80"
                    onError={() => setAudioError(true)}
                    onLoadedData={() => setAudioError(false)}
                  />
                )}
              </div>
            )}

            {/* رقم التواصل للاستفسارات — يحدده صاحب الدعوة ويحدد وسيلته */}
            {invite.contactPhone && (
              <div className="space-y-3 rounded-xl border border-gold/20 bg-gold/5 p-5 font-sans">
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gold/10 text-gold-light">
                    <Phone className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="mb-1 text-sm text-gray-400">للاستفسارات</p>
                    <p className="text-lg font-medium text-white" dir="ltr">
                      {toDialNumber(invite.contactPhone)}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {(invite.contactMethod === "call" || invite.contactMethod === "both") && (
                    <a href={"tel:" + toDialNumber(invite.contactPhone)} className="flex-1">
                      <Button
                        variant="outline"
                        className="w-full border-gold/40 bg-transparent text-gold-light hover:bg-gold/10"
                      >
                        <Phone className="ml-2 h-4 w-4" /> اتصال
                      </Button>
                    </a>
                  )}
                  {(invite.contactMethod === "whatsapp" || invite.contactMethod === "both") && (
                    <a
                      href={"https://wa.me/" + toWhatsAppNumber(invite.contactPhone)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1"
                    >
                      <Button className="w-full bg-green-600 text-white hover:bg-green-700">
                        <MessageCircle className="ml-2 h-4 w-4" /> واتساب
                      </Button>
                    </a>
                  )}
                </div>
              </div>
            )}

            {/* QR لرابط الدعوة — يمسحه المدعو فتُفتح الدعوة مباشرة */}
            <div className="flex flex-col items-center gap-3 rounded-xl border border-white/10 bg-black/30 p-5 font-sans">
              <p className="text-center text-sm text-gray-400">
                امسح الرمز لفتح الدعوة على جهاز آخر أو لمشاركتها
              </p>
              <QrCode
                value={buildPublicInviteUrl(APP_ORIGIN, invite.shareSlug || slug || "")}
                size={168}
                className="p-2"
              />
              <p className="break-all text-center text-[11px] text-gray-500" dir="ltr">
                {buildPublicInviteUrl(APP_ORIGIN, invite.shareSlug || slug || "")}
              </p>
            </div>

            <div className="pt-8 border-t border-white/10">
              {isSubmitted ? (
                <div className="text-center bg-emerald-900/20 border border-emerald-500/30 rounded-xl p-8">
                  <div className="w-16 h-16 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-4 text-emerald-400">
                    <Check className="w-8 h-8" />
                  </div>
                  <h3 className="text-xl font-bold text-white mb-2 font-sans">شكراً لردك!</h3>
                  <p className="text-gray-400 font-sans">تم تسجيل ردك بنجاح. ننتظر رؤيتك في المناسبة.</p>
                </div>
              ) : isPreidentified ? (
                /* ── الضيف المُعرَّف: ضغطة واحدة بدون نموذج ── */
                <div className="font-sans text-center space-y-6">
                  <div>
                    <h2 className="text-2xl font-bold text-gold-light font-serif mb-1">مرحباً {tokenGuest?.name}</h2>
                    <p className="text-gray-400 text-sm">هل ستشرفنا بحضورك؟</p>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <button
                      onClick={() => handleQuickRsvp('attending')}
                      disabled={isSending}
                      className="flex flex-col items-center justify-center gap-2 bg-emerald-900/30 hover:bg-emerald-900/50 border border-emerald-500/40 rounded-2xl p-6 transition-colors disabled:opacity-50"
                    >
                      <PartyPopper className="w-8 h-8 text-emerald-400" />
                      <span className="font-bold text-emerald-300 text-lg">بكل سرور</span>
                      <span className="text-emerald-300 text-xs">سأحضر</span>
                    </button>
                    <button
                      onClick={() => handleQuickRsvp('declined')}
                      disabled={isSending}
                      className="flex flex-col items-center justify-center gap-2 bg-red-900/20 hover:bg-red-900/40 border border-red-500/30 rounded-2xl p-6 transition-colors disabled:opacity-50"
                    >
                      <X className="w-8 h-8 text-red-400" />
                      <span className="font-bold text-red-300 text-lg">أعتذر</span>
                      <span className="text-red-300 text-xs">لن أتمكن من الحضور</span>
                    </button>
                  </div>
                  {isSending && (
                    <div className="flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-gold-light" /></div>
                  )}
                  {formError && (
                    <p role="alert" className="text-red-400 text-sm">{formError}</p>
                  )}
                </div>
              ) : (
                /* ── الضيف العام: النموذج الكامل ── */
                <div className="font-sans">
                  <h2 className="text-2xl font-bold text-center mb-6 text-gold-light font-serif">تأكيد الحضور</h2>
                  <form onSubmit={handleSubmit} className="space-y-6">
                    <div className="space-y-4">
                      <div>
                        <Label className="text-gray-300 mb-2 block">الاسم الكريم</Label>
                        <Input 
                          value={name} 
                          onChange={e => setName(e.target.value)} 
                          className="bg-black/50 border-white/10 text-white focus:border-gold h-12"
                          placeholder="الاسم الثلاثي"
                          required
                        />
                      </div>
                      <div>
                        <Label className="text-gray-300 mb-2 block">رقم الجوال</Label>
                        <Input 
                          value={phone} 
                          onChange={e => setPhone(e.target.value)} 
                          className="bg-black/50 border-white/10 text-white focus:border-gold h-12 text-right"
                          placeholder="05XXXXXXXX"
                          dir="ltr"
                          required
                        />
                      </div>
                    </div>

                    <div className="bg-black/30 p-4 rounded-xl border border-white/5">
                      <Label className="text-gray-300 mb-4 block">هل ستشرفنا بحضورك؟</Label>
                      <RadioGroup value={status} onValueChange={(v: any) => setStatus(v)} className="flex flex-col gap-3">
                        <div className="flex items-center space-x-2 space-x-reverse">
                          <RadioGroupItem value="attending" id="attending" className="border-gold text-gold-light" />
                          <Label htmlFor="attending" className="text-gray-300 cursor-pointer">بكل سرور، سأحضر</Label>
                        </div>
                        <div className="flex items-center space-x-2 space-x-reverse">
                          <RadioGroupItem value="maybe" id="maybe" className="border-gold text-gold-light" />
                          <Label htmlFor="maybe" className="text-gray-300 cursor-pointer">ربما (غير مؤكد)</Label>
                        </div>
                        <div className="flex items-center space-x-2 space-x-reverse">
                          <RadioGroupItem value="declined" id="declined" className="border-gold text-gold-light" />
                          <Label htmlFor="declined" className="text-gray-300 cursor-pointer">أعتذر عن الحضور</Label>
                        </div>
                      </RadioGroup>
                    </div>

                    <Button 
                      type="submit" 
                      disabled={isSending}
                      className="w-full h-14 bg-gold text-black hover:bg-gold/90 font-bold text-lg"
                    >
                      {isSending ? <Loader2 className="w-6 h-6 animate-spin" /> : 'تأكيد الرد'}
                    </Button>

                    {formError && (
                      <p role="alert" className="text-red-400 text-sm text-center">{formError}</p>
                    )}
                  </form>
                </div>
              )}
            </div>
          </div>
          
          <div className="mt-12 text-center text-xs text-gray-400 font-sans border-t border-white/5 pt-6">
            صُنع بحب عبر منصة <span className="text-gold-light font-serif">دعوات</span>
          </div>

        </div>
      </main>
    </div>
  );
}
