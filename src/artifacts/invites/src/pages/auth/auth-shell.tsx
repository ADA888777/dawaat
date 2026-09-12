import { type ReactNode } from "react";
import { Link } from "wouter";

/* نفس طبقات الحرير المستخدمة في قسم البطل بالواجهة العامة،
   حتى تبقى صفحات الدخول ضمن نفس اللغة البصرية الفاتحة. */
const SILK =
  "radial-gradient(120% 90% at 15% 20%, rgba(233,214,187,0.85) 0%, rgba(233,214,187,0) 60%)," +
  "radial-gradient(90% 80% at 85% 90%, rgba(214,186,148,0.75) 0%, rgba(214,186,148,0) 58%)," +
  "linear-gradient(135deg,#FDF9F5 0%,#F7F1EA 50%,#EFE3D2 100%)";

export function AuthShell({ title, subtitle, children }: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <div
      className="relative flex min-h-[100dvh] flex-col items-center justify-center overflow-hidden px-4 py-12"
      style={{ backgroundImage: SILK, backgroundSize: "cover", backgroundPosition: "center" }}
    >
      <Link
        href="/"
        className="relative z-10 mb-8 flex items-center gap-2.5 text-gold"
      >
        <span className="text-[34px] font-bold tracking-[0.06em]">دعوات</span>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          className="h-9 w-9"
          aria-hidden="true"
        >
          <path d="M4 8.5 12 3l8 5.5V20a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V8.5Z" strokeLinejoin="round" />
          <path d="M4 9l8 5 8-5" strokeLinecap="round" />
        </svg>
      </Link>

      <div className="relative z-10 w-full max-w-md rounded-2xl border border-line bg-cream-2 p-8 shadow-[0_18px_50px_rgba(42,38,34,0.12)]">
        <div className="mb-8 text-center">
          <h1 className="mb-1 text-2xl font-bold text-ink">{title}</h1>
          <p className="text-sm text-gray-600">{subtitle}</p>
        </div>
        {children}
      </div>
    </div>
  );
}
