import { type ReactNode } from "react";
import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import { Footer } from "@/components/footer";

/** غلاف موحد للصفحات الثابتة (السياسات والمساعدة) بهوية الموقع الكريمية/الذهبية. */
export function StaticPage({ title, subtitle, children }: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-cream text-ink">
      <header className="sticky top-0 z-50 w-full border-b border-line bg-cream-2">
        <div className="mx-auto flex max-w-[1120px] items-center justify-between px-5 py-3.5 md:px-6">
          <Link href="/" className="flex items-center gap-2.5 text-gold">
            <span className="text-[22px] font-bold tracking-[0.06em] md:text-[26px]">دعوات</span>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              className="h-7 w-7 md:h-8 md:w-8"
              aria-hidden="true"
            >
              <path d="M4 8.5 12 3l8 5.5V20a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V8.5Z" strokeLinejoin="round" />
              <path d="M4 9l8 5 8-5" strokeLinecap="round" />
            </svg>
          </Link>

          <Link
            href="/"
            className="flex items-center gap-2 text-sm text-gray-600 transition-colors hover:text-gold-deep"
          >
            العودة للرئيسية
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-4xl flex-1 px-5 py-14 md:px-8">
        <h1 className="mb-3 text-[clamp(28px,4vw,44px)] font-bold text-gold-deep">{title}</h1>
        {subtitle && <p className="mb-10 leading-relaxed text-gray-600">{subtitle}</p>}
        {children}
      </main>

      <Footer />
    </div>
  );
}
