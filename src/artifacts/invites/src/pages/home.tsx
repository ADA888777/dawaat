import { useState } from "react";
import { Link } from "wouter";
import {
  Users,
  CheckCircle2,
  Share2,
  Sparkles,
  Award,
  Clock,
  Smartphone,
  ShieldCheck,
  User,
  Menu,
  X,
} from "lucide-react";
import { useListTemplates, type EventCategory } from "@/lib/api";
import { Footer } from "@/components/footer";

/* =====================================================================
   الواجهة العامة — تصميم فاتح كريمي/ذهبي.
   كل الألوان مأخوذة من رموز العلامة في index.css (gold / ink / cream…)
   حتى يبقى مصدر اللون واحداً ولا تتكرر قيم hex هنا.
   ===================================================================== */

const FEATURES = [
  { Icon: Users, title: "إدارة الحضور", text: "تابع قائمة الحضور وتفاصيل الردود بسهولة" },
  { Icon: CheckCircle2, title: "تأكيد الدعوات", text: "ميزة تأكيد الحضور بضغطة واحدة" },
  { Icon: Share2, title: "مشاركة سهلة", text: "شارك دعوتك عبر الواتساب ووسائل التواصل" },
  { Icon: Sparkles, title: "تصاميم فاخرة", text: "تصاميم عصرية راقية تناسب ذوقك" },
];

const TRUST = [
  { Icon: Award, title: "جودة عالية", text: "تصاميم احترافية بجودة فائقة" },
  { Icon: Clock, title: "سريع وسهل", text: "أنشئ دعوتك بخطوات بسيطة وفي دقائق" },
  { Icon: Smartphone, title: "متوافق مع الجوال", text: "تجربة مثالية على جميع الأجهزة" },
  { Icon: ShieldCheck, title: "خصوصية وأمان", text: "نحافظ على بياناتك بأعلى معايير الأمان" },
];

const CATEGORIES: { key: EventCategory; title: string; fallback: string }[] = [
  { key: "wedding", title: "دعوات زفاف", fallback: "linear-gradient(150deg,#F3E9DC,#E6D5BF 55%,#D8C3A6)" },
  { key: "engagement", title: "دعوات خطوبة", fallback: "linear-gradient(150deg,#EFE2D2,#DFCBB1 55%,#C9AE8C)" },
  { key: "graduation", title: "دعوات تخرج", fallback: "linear-gradient(150deg,#4A4038,#2C2621 55%,#1C1815)" },
];

const MENU = [
  { href: "/", label: "الرئيسية" },
  { href: "/sign-up", label: "إنشاء حساب" },
  { href: "/sign-in", label: "تسجيل الدخول" },
  { href: "/help", label: "مركز المساعدة" },
];

/* خلفية البطل: طبقات تدرّج تحاكي الحرير الذهبي بلا الحاجة لملف صورة،
   فلا يظهر مستطيل فارغ إن تأخر تحميل أي أصل خارجي. */
const HERO_SILK =
  "radial-gradient(120% 95% at 12% 26%, rgba(233,214,187,0.95) 0%, rgba(233,214,187,0) 62%)," +
  "radial-gradient(95% 85% at 4% 88%, rgba(214,186,148,0.9) 0%, rgba(214,186,148,0) 58%)," +
  "radial-gradient(70% 60% at 30% 10%, rgba(253,249,245,0.85) 0%, rgba(253,249,245,0) 60%)," +
  "linear-gradient(135deg,#FDF9F5 0%,#F3E7D6 45%,#E4CFB1 100%)";

/* حجاب يرفع وضوح النص على جهة النص (اليمين في RTL) */
const HERO_VEIL =
  "linear-gradient(270deg, rgba(250,244,236,0.96) 0%, rgba(250,244,236,0.90) 42%," +
  " rgba(250,244,236,0.55) 62%, rgba(250,244,236,0.12) 80%, rgba(250,244,236,0) 100%)";

function Ornament() {
  return (
    <div
      className="my-6 mx-auto flex w-full max-w-[400px] items-center gap-3.5 md:mx-0"
      aria-hidden="true"
    >
      <i className="h-px flex-1 bg-[linear-gradient(90deg,transparent,var(--gold))]" />
      <svg viewBox="0 0 28 14" fill="currentColor" className="h-5 w-11 shrink-0 text-gold-deep">
        <path d="M14 1c2.6 0 4.6 2 4.6 4.6S16.6 10.2 14 10.2 9.4 8.2 9.4 5.6 11.4 1 14 1Zm0 1.6a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z" />
        <path d="M9 5.6C6.6 3.8 3.6 3.2.4 3.6c2.4 1.4 5 2.6 8.6 2ZM19 5.6c2.4-1.8 5.4-2.4 8.6-2-2.4 1.4-5 2.6-8.6 2Z" />
      </svg>
      <i className="h-px flex-1 bg-[linear-gradient(270deg,transparent,var(--gold))]" />
    </div>
  );
}

function SiteHeader() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-line bg-cream-2">
      <nav className="mx-auto flex max-w-[1120px] items-center justify-between gap-4 px-5 py-3.5 md:px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="text-[22px] font-bold tracking-[0.06em] text-gold md:text-[26px]">دعوات</span>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            className="h-7 w-7 text-gold md:h-[34px] md:w-[34px]"
            aria-hidden="true"
          >
            <path d="M4 8.5 12 3l8 5.5V20a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V8.5Z" strokeLinejoin="round" />
            <path d="M4 9l8 5 8-5" strokeLinecap="round" />
          </svg>
        </Link>

        <div className="flex items-center gap-2 md:gap-3.5">
          <Link
            href="/sign-in"
            className="inline-flex items-center gap-2 whitespace-nowrap rounded-[10px] bg-ink px-3.5 py-2 text-[14px] font-semibold text-cream-2 transition-colors hover:bg-ink-soft md:px-5 md:py-2.5 md:text-[15px]"
          >
            <User className="h-[17px] w-[17px]" strokeWidth={1.8} />
            تسجيل الدخول
          </Link>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label="القائمة"
            aria-expanded={open}
            className="rounded-lg p-2 text-ink transition-colors hover:bg-beige"
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </nav>

      {open && (
        <div className="border-t border-line bg-cream-2">
          <div className="mx-auto flex max-w-[1120px] flex-col px-5 py-2 md:px-6">
            {MENU.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className="rounded-lg px-2 py-2.5 text-[15px] text-ink transition-colors hover:bg-beige hover:text-gold-deep"
              >
                {item.label}
              </Link>
            ))}
          </div>
        </div>
      )}
    </header>
  );
}

export default function Home() {
  const { data: templates } = useListTemplates();

  const imageFor = (category: EventCategory) =>
    (templates || []).find((t) => t.category === category)?.previewImage;

  return (
    <div className="min-h-screen bg-cream text-ink">
      <SiteHeader />

      <main>
        {/* ═══ البطل ═══ */}
        <section
          className="relative flex min-h-[clamp(480px,68vh,720px)] items-center overflow-hidden py-14 md:py-20"
          style={{ backgroundImage: HERO_SILK, backgroundSize: "cover", backgroundPosition: "center" }}
        >
          <div className="pointer-events-none absolute inset-0" style={{ backgroundImage: HERO_VEIL }} />

          <div className="relative z-10 mx-auto w-full max-w-[1120px] px-5 md:px-6">
            <div className="text-center md:max-w-[560px] md:text-right">
              <h1 className="text-[clamp(28px,4.4vw,50px)] font-bold leading-[1.42] [text-shadow:0_1px_2px_rgba(255,255,255,0.55)]">
                دعوات إلكترونية تليق
                <span className="block text-gold-deep">بمناسباتكم الاستثنائية</span>
              </h1>

              <Ornament />

              <p className="mx-auto max-w-[44ch] text-[16px] leading-[2] text-gray-700 md:mx-0 md:text-[17px]">
                نصمم لك واجهة رقمية تعكس فخامة مناسبتك. دعوات زفاف، خطوبة، وتخرج، مع نظام متكامل
                لإدارة الحضور وتأكيد الدعوات.
              </p>

              <Link
                href="/sign-up"
                className="mt-8 inline-flex w-full items-center justify-center rounded-full border border-gold bg-ink px-14 py-4 text-[18px] font-bold text-gold-light shadow-[0_12px_30px_rgba(42,38,34,0.22)] transition-all hover:-translate-y-0.5 hover:bg-ink-soft sm:w-auto md:text-[19px]"
              >
                ابدأ الآن
              </Link>
            </div>
          </div>
        </section>

        {/* ═══ شريط المزايا ═══ */}
        <section className="pt-11">
          <div className="mx-auto max-w-[1120px] px-5 md:px-6">
            <div className="rounded-[20px] border border-line bg-cream-2 px-3 py-7">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
                {FEATURES.map(({ Icon, title, text }) => (
                  <div
                    key={title}
                    className="border-line px-5 py-4 text-center max-sm:border-b max-sm:last:border-b-0 sm:max-lg:[&:nth-child(-n+2)]:border-b lg:border-l lg:last:border-l-0"
                  >
                    <Icon className="mx-auto mb-3 h-[34px] w-[34px] text-gold" strokeWidth={1.6} />
                    <h3 className="text-[16px] font-bold">{title}</h3>
                    <p className="mt-1 text-[13.5px] leading-[1.8] text-gray-600">{text}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ═══ التصنيفات ═══ */}
        <section className="py-14">
          <div className="mx-auto max-w-[1120px] px-5 md:px-6">
            <h2 className="mb-8 text-center text-[clamp(21px,2.7vw,27px)] font-bold">
              لكل مناسبة تصميم يليق بها
            </h2>

            <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
              {CATEGORIES.map((cat) => {
                const img = imageFor(cat.key);
                return (
                  <Link
                    key={cat.key}
                    href="/sign-up"
                    className="group relative flex aspect-[4/3.35] items-end justify-center overflow-hidden rounded-[14px] bg-cover bg-center pb-6"
                    style={{
                      backgroundImage: img ? "url(" + img + "), " + cat.fallback : cat.fallback,
                    }}
                  >
                    <span className="absolute inset-0 bg-[linear-gradient(to_top,rgba(20,16,13,0.72)_0%,rgba(20,16,13,0.28)_45%,transparent_75%)]" />
                    <span className="relative z-10 text-center">
                      <span className="mb-3 block text-[19px] font-bold text-white">{cat.title}</span>
                      <span className="inline-block rounded-full border border-white/75 px-5 py-1.5 text-[13px] text-white transition-colors group-hover:bg-white/20">
                        استعرض التصاميم
                      </span>
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>
        </section>

        {/* ═══ شريط الثقة ═══ */}
        <section className="pb-16">
          <div className="mx-auto max-w-[1120px] px-5 md:px-6">
            <div className="rounded-[20px] border border-line bg-cream-2 px-3 py-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
                {TRUST.map(({ Icon, title, text }) => (
                  <div
                    key={title}
                    className="border-line px-5 py-3 text-center max-sm:border-b max-sm:last:border-b-0 sm:max-lg:[&:nth-child(-n+2)]:border-b lg:border-l lg:last:border-l-0"
                  >
                    <Icon className="mx-auto mb-2 h-[27px] w-[27px] text-gold" strokeWidth={1.6} />
                    <h4 className="text-[14.5px] font-bold">{title}</h4>
                    <p className="mt-0.5 text-[12.5px] leading-[1.75] text-gray-600">{text}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
