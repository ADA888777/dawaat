import { type ReactNode } from "react";
import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import { Footer } from "@/components/footer";

/** غلاف موحد للصفحات الثابتة (السياسات والمساعدة) بهوية الموقع السوداء/الذهبية. */
export function StaticPage({ title, subtitle, children }: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-ink text-white flex flex-col">
      <header className="w-full px-4 md:px-8 py-6 flex justify-between items-center border-b border-white/10">
        <Link href="/" className="text-3xl font-serif text-gold-light font-bold">دعوات</Link>
        <Link href="/" className="flex items-center gap-2 text-gray-300 hover:text-white transition-colors text-sm">
          العودة للرئيسية
          <ArrowRight className="w-4 h-4" />
        </Link>
      </header>

      <main className="flex-1 w-full max-w-4xl mx-auto px-4 md:px-8 py-16">
        <h1 className="text-4xl md:text-5xl font-bold font-serif text-gold-light mb-3">{title}</h1>
        {subtitle && <p className="text-gray-400 mb-12 leading-relaxed">{subtitle}</p>}
        {children}
      </main>

      <Footer />
    </div>
  );
}
