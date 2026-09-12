import { useEffect } from "react";
import { Link } from "wouter";
import { CalendarPlus, Users, Share2, BellRing, Crown, LifeBuoy } from "lucide-react";
import { StaticPage } from "@/components/static-page";
import { useAuth } from "@/lib/auth";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

const steps = [
  {
    icon: CalendarPlus,
    title: "أنشئ مناسبتك",
    body: "سجّل حسابك ثم اختر «مناسبة جديدة»، حدد نوعها وقالبها وأدخل التفاصيل: العنوان، التاريخ، الوقت، والموقع. يمكنك إضافة صورة غلاف ومقطع صوتي.",
  },
  {
    icon: Users,
    title: "أضف ضيوفك",
    body: "أضف الضيوف يدوياً واحداً تلو الآخر، أو استوردهم دفعة واحدة من جهات الاتصال في جوالك أو من ملف.",
  },
  {
    icon: Share2,
    title: "شارك رابط الدعوة",
    body: "لكل مناسبة رابط عام فريد وآمن. أرسله لضيوفك عبر واتساب أو الرسائل، وسيتمكنون من عرض الدعوة وتأكيد حضورهم دون تسجيل دخول.",
  },
  {
    icon: BellRing,
    title: "تابع الحضور",
    body: "تظهر ردود الضيوف فور تأكيدها في لوحة التحكم مع إحصائيات دقيقة: عدد الحاضرين، المعتذرين، وغير المتأكدين، إضافة إلى تنبيهات قبيل موعد المناسبة.",
  },
];

const faqs = [
  {
    q: "هل يحتاج ضيوفي إلى حساب لتأكيد الحضور؟",
    a: "لا. صفحة الدعوة عامة، ويكفي أن يفتح الضيف الرابط ويدخل اسمه ورقم جواله لتأكيد حضوره أو اعتذاره.",
  },
  {
    q: "كم عدد المناسبات التي يمكنني إنشاؤها؟",
    a: "الخطة المجانية تتيح إنشاء حتى 3 مناسبات. للترقية إلى الخطة المدفوعة (مناسبات غير محدودة) توجه إلى صفحة الاشتراك من لوحة التحكم.",
  },
  {
    q: "هل يمكنني تعديل الدعوة بعد إرسال الرابط؟",
    a: "نعم. أي تعديل على تفاصيل المناسبة يظهر مباشرة لكل من يفتح رابط الدعوة، دون الحاجة لإرسال رابط جديد.",
  },
  {
    q: "ماذا لو أكد الضيف حضوره ثم غيّر رأيه؟",
    a: "يمكنه فتح رابط الدعوة مرة أخرى وإدخال نفس رقم الجوال، وسيتم تحديث رده السابق بدلاً من إضافة رد مكرر.",
  },
  {
    q: "هل قائمة ضيوفي مرئية للآخرين؟",
    a: "لا. قائمة الضيوف وإحصائيات الحضور مرئية لك وحدك. صفحة الدعوة العامة تعرض تفاصيل المناسبة فقط.",
  },
  {
    q: "ما أنواع الملفات المدعومة للصور والصوت؟",
    a: "تدعم المنصة صيغ الصور الشائعة (JPG, PNG, WebP) والمقاطع الصوتية (MP3, WAV, M4A وغيرها).",
  },
  {
    q: "كيف أحذف حسابي وبياناتي؟",
    a: "يمكنك حذف مناسباتك وضيوفك في أي وقت من لوحة التحكم. ولحذف الحساب نهائياً تواصل معنا وسنقوم بذلك خلال مدة وجيزة.",
  },
];

export default function HelpPage() {
  const { user } = useAuth();

  // دعم الوصول المباشر إلى قسم الأسئلة الشائعة عبر ‎/help#faq
  useEffect(() => {
    if (window.location.hash === "#faq") {
      document.getElementById("faq")?.scrollIntoView({ behavior: "smooth" });
    }
  }, []);

  return (
    <StaticPage
      title="مركز المساعدة"
      subtitle="كل ما تحتاج معرفته لإنشاء دعوتك وإدارة ضيوفك خطوة بخطوة."
    >
      {/* دليل الاستخدام */}
      <section className="mb-16">
        <h2 className="text-2xl font-bold font-serif text-ink mb-8">كيف تستخدم المنصة؟</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {steps.map((step, i) => (
            <div key={step.title} className="bg-cream-2 border border-line rounded-xl p-6 space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-full bg-beige flex items-center justify-center text-gold-deep shrink-0">
                  <step.icon className="w-5 h-5" />
                </div>
                <h3 className="text-lg font-bold text-ink">
                  <span className="text-gold-deep ml-1">{i + 1}.</span> {step.title}
                </h3>
              </div>
              <p className="text-gray-600 leading-relaxed">{step.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* الأسئلة الشائعة */}
      <section id="faq" className="mb-16 scroll-mt-24">
        <h2 className="text-2xl font-bold font-serif text-ink mb-8">الأسئلة الشائعة</h2>
        <Accordion type="single" collapsible className="bg-cream-2 border border-line rounded-xl px-6">
          {faqs.map((faq, i) => (
            <AccordionItem key={faq.q} value={`faq-${i}`} className="border-line">
              <AccordionTrigger className="text-right text-ink hover:text-gold-deep hover:no-underline">
                {faq.q}
              </AccordionTrigger>
              <AccordionContent className="text-gray-600 leading-relaxed">
                {faq.a}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </section>

      {/* الترقية والدعم */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-cream-2 border border-gold/40 rounded-xl p-6 space-y-3">
          <div className="w-11 h-11 rounded-full bg-beige flex items-center justify-center text-gold-deep">
            <Crown className="w-5 h-5" />
          </div>
          <h3 className="text-lg font-bold text-ink">تحتاج مناسبات أكثر؟</h3>
          <p className="text-gray-600 leading-relaxed">
            رقِّ حسابك إلى الخطة المدفوعة من صفحة الاشتراك في لوحة التحكم واستمتع بعدد غير محدود من المناسبات.
          </p>
          <Link href={user ? "/subscription" : "/sign-up"} className="inline-block text-gold-deep font-bold hover:underline">
            {user ? "عرض خطط الاشتراك" : "أنشئ حساباً للبدء"}
          </Link>
        </div>
        <div className="bg-cream-2 border border-line rounded-xl p-6 space-y-3">
          <div className="w-11 h-11 rounded-full bg-beige flex items-center justify-center text-gold-deep">
            <LifeBuoy className="w-5 h-5" />
          </div>
          <h3 className="text-lg font-bold text-ink">لم تجد إجابتك؟</h3>
          <p className="text-gray-600 leading-relaxed">
            راسلنا على البريد الإلكتروني وسنرد عليك في أقرب وقت:
          </p>
          <a href="mailto:support@daawat.app" dir="ltr" className="inline-block text-gold-deep font-bold hover:underline">
            support@daawat.app
          </a>
        </div>
      </section>
    </StaticPage>
  );
}
