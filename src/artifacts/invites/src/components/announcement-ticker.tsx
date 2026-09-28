import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Megaphone } from "lucide-react";
import { useGetAppSettings, useListAnnouncements, type Announcement } from "@/lib/api";

interface AnnouncementTickerProps {
  /** top: داخل واجهة المستخدم (في التدفق، يلتصق بالأعلى) — bottom: واجهة الموقع (ثابت أسفل الشاشة) */
  position: "top" | "bottom";
}

/** الحد الأدنى لعدد النسخ حتى لا يظهر فراغ أثناء الدوران */
const MIN_COPIES = 2;

/**
 * شريط الإعلانات المتحرك.
 *
 * - يقرأ الإعلانات النشطة (سياسة RLS تُخفي المعطّل عن غير الأدمن، فنرشّح هنا
 *   أيضاً كي لا يرى الأدمن نفسه إعلاناً عطّله).
 * - الحركة CSS خالصة: نكرّر المحتوى عدة نسخ ونحرّك المسار بمقدار نسخة واحدة
 *   بالضبط، فيبدو الدوران متصلاً بلا قفزة. المدة = عرض النسخة ÷ السرعة،
 *   فالسرعة (بكسل/ثانية) ثابتة مهما كان طول النص أو عرض الشاشة.
 * - يتوقف عند التمرير بالمؤشر، ويثبت للمستخدمين الذين يفضّلون تقليل الحركة.
 * - في الأسفل يكون ثابتاً ويحجز مساحته من الصفحة (padding-bottom على body)
 *   حتى لا يغطي أي محتوى؛ وفي الأعلى يكون داخل التدفق فلا يغطي شيئاً.
 */
export function AnnouncementTicker({ position }: AnnouncementTickerProps) {
  const { data: settings } = useGetAppSettings();
  const { data: announcements } = useListAnnouncements();

  const enabled =
    (settings?.tickerEnabled ?? true) && (settings?.featureFlags?.announcements_bar ?? true);
  const speed = Math.min(300, Math.max(10, settings?.tickerSpeed ?? 60));
  const items = (announcements ?? []).filter((a) => a.active && a.text.trim() !== "");
  const visible = enabled && items.length > 0;

  const barRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const copyRef = useRef<HTMLDivElement>(null);
  const [copies, setCopies] = useState(MIN_COPIES);
  const [shift, setShift] = useState(0);

  // قياس عرض نسخة واحدة وعرض الإطار ← عدد النسخ ومقدار الإزاحة
  useLayoutEffect(() => {
    if (!visible) return;
    const viewport = viewportRef.current;
    const copy = copyRef.current;
    if (!viewport || !copy) return;

    const measure = () => {
      const copyWidth = copy.getBoundingClientRect().width;
      const viewWidth = viewport.getBoundingClientRect().width;
      if (copyWidth <= 0 || viewWidth <= 0) return;
      setShift(copyWidth);
      setCopies(Math.max(MIN_COPIES, Math.ceil(viewWidth / copyWidth) + 1));
    };
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    observer.observe(copy);
    return () => observer.disconnect();
  }, [visible, items.map((a) => a.id + a.text).join("|")]);

  // حجز مساحة أسفل الصفحة للشريط الثابت حتى لا يغطي المحتوى
  useEffect(() => {
    if (position !== "bottom") return;
    const root = document.documentElement;
    if (!visible) {
      root.style.removeProperty("--ticker-bottom");
      return;
    }
    const bar = barRef.current;
    const apply = () =>
      root.style.setProperty("--ticker-bottom", (bar?.offsetHeight ?? 0) + "px");
    apply();
    const observer = bar ? new ResizeObserver(apply) : null;
    if (bar && observer) observer.observe(bar);
    return () => {
      observer?.disconnect();
      root.style.removeProperty("--ticker-bottom");
    };
  }, [position, visible]);

  if (!visible) return null;

  const duration = shift > 0 ? shift / speed : 0;

  const renderItems = (copyIndex: number) =>
    items.map((a) => (
      <TickerItem key={copyIndex + "-" + a.id} item={a} ariaHidden={copyIndex > 0} />
    ));

  return (
    <div
      ref={barRef}
      role="region"
      aria-label="الإعلانات"
      dir="rtl"
      data-testid="announcement-ticker"
      data-position={position}
      className={
        "ticker-bar w-full border-line bg-ink text-gold-light " +
        (position === "bottom"
          ? "fixed inset-x-0 bottom-0 z-40 border-t"
          : "sticky top-0 z-[5] border-b")
      }
    >
      <div className="flex items-center">
        <span className="flex shrink-0 items-center gap-1 border-l border-gold/30 bg-ink-soft px-3 py-2 text-xs font-bold text-gold">
          <Megaphone className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">إعلان</span>
        </span>
        <div ref={viewportRef} className="ticker-viewport relative flex-1 overflow-hidden py-2">
          <div
            className="ticker-track flex w-max items-center"
            style={{
              // @ts-expect-error متغيرات CSS مخصّصة
              "--ticker-shift": shift + "px",
              "--ticker-duration": duration + "s",
            }}
          >
            {/* النسخة الأولى هي المقاسة؛ البقية تكرار لسدّ الفراغ */}
            <div ref={copyRef} className="flex shrink-0 items-center">
              {renderItems(0)}
            </div>
            {Array.from({ length: copies - 1 }, (_, i) => (
              <div key={i + 1} className="flex shrink-0 items-center">
                {renderItems(i + 1)}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function TickerItem({ item, ariaHidden }: { item: Announcement; ariaHidden: boolean }) {
  const content = (
    <>
      <span className="whitespace-nowrap text-sm font-medium">{item.text}</span>
      <span className="mx-6 text-gold/60" aria-hidden="true">✦</span>
    </>
  );
  const isHttp = /^https?:\/\//i.test(item.link);
  const isInternal = item.link.startsWith("/");
  if (item.link && (isHttp || isInternal)) {
    return (
      <a
        href={item.link}
        target={isHttp ? "_blank" : undefined}
        rel={isHttp ? "noopener noreferrer" : undefined}
        aria-hidden={ariaHidden || undefined}
        tabIndex={ariaHidden ? -1 : undefined}
        className="flex items-center hover:text-white hover:underline"
      >
        {content}
      </a>
    );
  }
  return (
    <span aria-hidden={ariaHidden || undefined} className="flex items-center">
      {content}
    </span>
  );
}
