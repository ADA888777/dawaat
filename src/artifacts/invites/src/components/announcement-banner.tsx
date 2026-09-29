import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import {
  Calendar,
  Crown,
  Gift,
  Megaphone,
  PartyPopper,
  Percent,
  Sparkles,
  Star,
  type LucideIcon,
} from "lucide-react";
import {
  useGetAppSettings,
  useListAnnouncements,
  visibleAnnouncements,
  type Announcement,
  type AnnouncementIcon,
} from "@/lib/api";

/** أيقونات الإعلانات — تُستخدم أيضاً في معاينة لوحة الأدمن */
export const ANNOUNCEMENT_ICON_COMPONENTS: Record<AnnouncementIcon, LucideIcon> = {
  megaphone: Megaphone,
  sparkles: Sparkles,
  gift: Gift,
  crown: Crown,
  calendar: Calendar,
  percent: Percent,
  star: Star,
  party: PartyPopper,
};

interface AnnouncementBannerProps {
  /** home: الصفحة الرئيسية العامة — dashboard: لوحة العميل */
  place: "home" | "dashboard";
  className?: string;
}

/**
 * شريط الإعلانات: بطاقة أنيقة بألوان العلامة (كريمي/ذهبي/حبري) لا نص متحرك.
 *
 * - أيقونة أو صورة + عنوان + وصف مختصر + زر اختياري.
 * - إعلان واحد ← ثابت بلا نقاط. أكثر من إعلان ← انتقال تلقائي كل مدة يحددها
 *   الأدمن (5 ثوانٍ افتراضاً) بحركة Fade + Slide، مع نقاط أسفل البطاقة.
 * - لا إعلانات نشطة ← لا يُرسم شيء إطلاقاً (بلا مساحة فارغة).
 * - يتوقف الانتقال عند تمرير المؤشر أو التركيز بلوحة المفاتيح أو إخفاء التبويب،
 *   ويثبت على الإعلان الأول لمن يفضّل تقليل الحركة.
 * - الشرائح كلها في خلية شبكة واحدة، فارتفاع البطاقة = أطول شريحة ولا يقفز
 *   المحتوى تحتها عند الانتقال.
 */
export function AnnouncementBanner({ place, className = "" }: AnnouncementBannerProps) {
  const { data: settings } = useGetAppSettings();
  const { data: announcements } = useListAnnouncements();

  const enabled =
    (settings?.tickerEnabled ?? true) && (settings?.featureFlags?.announcements_bar ?? true);
  const items = useMemo(
    () => (enabled ? visibleAnnouncements(announcements, place) : []),
    [enabled, announcements, place],
  );

  const intervalMs = Math.min(60, Math.max(2, settings?.announcementInterval ?? 5)) * 1000;
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const reduceMotion = useReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);

  // الفهرس يبقى داخل الحدود إذا تغيّرت قائمة الإعلانات أثناء العرض
  useEffect(() => {
    setIndex((prev) => (items.length === 0 ? 0 : prev % items.length));
  }, [items.length]);

  useEffect(() => {
    if (items.length < 2 || paused || reduceMotion) return;
    const id = window.setInterval(
      () => setIndex((prev) => (prev + 1) % items.length),
      intervalMs,
    );
    return () => window.clearInterval(id);
  }, [items.length, paused, reduceMotion, intervalMs]);

  // لا نستهلك مؤقتاً والتبويب مخفي
  useEffect(() => {
    const onVisibility = () => setPaused(document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  if (items.length === 0) return null;

  const current = items[Math.min(index, items.length - 1)];

  return (
    <div
      ref={rootRef}
      className={"w-full " + className}
      data-testid="announcement-banner"
      data-place={place}
      data-count={items.length}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      <section
        aria-label="إعلانات"
        aria-roledescription="شريط إعلانات"
        className="relative overflow-hidden rounded-2xl border border-line bg-gradient-to-l from-cream-2 via-white to-cream-2 shadow-sm"
      >
        {/* خط ذهبي رفيع على حافة البداية يربطها بهوية الموقع — يُخفى فوق الصورة الإعلانية الكاملة */}
        {current.layout !== "banner" && (
          <span aria-hidden="true" className="absolute inset-y-0 right-0 w-1 bg-gold" />
        )}

        <div className="grid">
          {items.map((item, i) => (
            <AnnouncementSlide
              key={item.id}
              item={item}
              active={i === index}
              reduceMotion={reduceMotion}
              total={items.length}
              position={i + 1}
            />
          ))}
        </div>

        {items.length > 1 && (
          <div className="flex items-center justify-center gap-1.5 pb-3" role="tablist" aria-label="الإعلانات">
            {items.map((item, i) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={i === index}
                aria-label={"الإعلان " + (i + 1) + " من " + items.length}
                onClick={() => setIndex(i)}
                data-testid={"announcement-dot-" + i}
                className={
                  "h-2 rounded-full transition-all " +
                  (i === index ? "w-5 bg-gold" : "w-2 bg-line hover:bg-gold/50")
                }
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function AnnouncementSlide({
  item,
  active,
  reduceMotion,
  total,
  position,
}: {
  item: Announcement;
  active: boolean;
  reduceMotion: boolean;
  total: number;
  position: number;
}) {
  const Icon = ANNOUNCEMENT_ICON_COMPONENTS[item.icon] ?? Megaphone;
  const hasButton = item.buttonUrl.trim() !== "" && item.buttonText.trim() !== "";
  const isInternal = item.buttonUrl.startsWith("/");
  const isExternal = /^https?:\/\//i.test(item.buttonUrl);

  // الخارج يختفي سريعاً والداخل يظهر بعده بقليل، فلا يتراكب نصّان أثناء الانتقال
  const motion = reduceMotion
    ? ""
    : "transition-all ease-out " + (active ? "duration-500 delay-150 " : "duration-200 ");
  const visibility = active
    ? "pointer-events-auto opacity-100 translate-y-0"
    : "pointer-events-none opacity-0 " + (reduceMotion ? "" : "translate-y-2");

  // صورة إعلانية كاملة (تصميم جاهز): الصورة هي الإعلان، وتُضغط كلها إن وُجد رابط
  if (item.layout === "banner" && item.imageUrl.trim() !== "") {
    const picture = (
      <img
        src={item.imageUrl}
        alt={item.title}
        loading="lazy"
        className="block h-auto max-h-[400px] w-full object-cover"
      />
    );
    const hasLink = isInternal || isExternal;
    return (
      <div
        style={{ gridArea: "1 / 1" }}
        aria-hidden={!active}
        inert={!active}
        data-layout="banner"
        className={motion + visibility}
      >
        {hasLink ? (
          isInternal ? (
            <Link href={item.buttonUrl} aria-label={item.title} className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold">
              {picture}
            </Link>
          ) : (
            <a
              href={item.buttonUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={item.title}
              className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
            >
              {picture}
            </a>
          )
        ) : (
          picture
        )}
        <span className="sr-only">{"إعلان " + position + " من " + total}</span>
      </div>
    );
  }

  return (
    <div
      // كل الشرائح في نفس خلية الشبكة: ارتفاع ثابت بلا قفز
      style={{ gridArea: "1 / 1" }}
      aria-hidden={!active}
      inert={!active}
      data-layout="card"
      className={
        "flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:gap-4 sm:px-5 " +
        motion +
        visibility
      }
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-gold/30 bg-gold/10 sm:h-12 sm:w-12">
        {item.imageUrl ? (
          <img src={item.imageUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <Icon className="h-5 w-5 text-gold-deep sm:h-6 sm:w-6" strokeWidth={1.8} />
        )}
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-bold leading-snug text-gray-900 sm:text-base">
          {item.title}
        </p>
        {item.description.trim() !== "" && (
          <p className="mt-0.5 line-clamp-2 text-[13px] leading-relaxed text-gray-600">
            {item.description}
          </p>
        )}
      </div>

      {hasButton && (
        isInternal ? (
          <Link
            href={item.buttonUrl}
            className="inline-flex w-full shrink-0 items-center justify-center rounded-full bg-ink px-5 py-2 text-[13px] font-bold text-gold-light transition-colors hover:bg-ink-soft sm:w-auto"
          >
            {item.buttonText}
          </Link>
        ) : isExternal ? (
          <a
            href={item.buttonUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex w-full shrink-0 items-center justify-center rounded-full bg-ink px-5 py-2 text-[13px] font-bold text-gold-light transition-colors hover:bg-ink-soft sm:w-auto"
          >
            {item.buttonText}
          </a>
        ) : null
      )}

      <span className="sr-only">{"إعلان " + position + " من " + total}</span>
    </div>
  );
}

/** يحترم تفضيل النظام بتقليل الحركة، ويتابع تغيّره أثناء التصفح */
function useReducedMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduce(query.matches);
    const onChange = (event: MediaQueryListEvent) => setReduce(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return reduce;
}
