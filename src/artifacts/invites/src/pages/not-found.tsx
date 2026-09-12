import { Link } from "wouter";
import { AlertCircle } from "lucide-react";

export default function NotFound() {
  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-cream px-4">
      <div className="w-full max-w-md rounded-2xl border border-line bg-cream-2 p-8 text-center shadow-[0_18px_50px_rgba(42,38,34,0.10)]">
        <AlertCircle className="mx-auto mb-4 h-10 w-10 text-gold" strokeWidth={1.6} />
        <h1 className="mb-2 text-2xl font-bold text-ink">الصفحة غير موجودة</h1>
        <p className="mb-6 text-sm leading-relaxed text-gray-600">
          الرابط الذي فتحته غير صحيح أو لم يعد متاحاً.
        </p>
        <Link
          href="/"
          className="inline-flex items-center justify-center rounded-full border border-gold bg-ink px-8 py-3 text-[15px] font-bold text-gold-light transition-colors hover:bg-ink-soft"
        >
          العودة للرئيسية
        </Link>
      </div>
    </div>
  );
}
