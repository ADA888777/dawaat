import { useState } from "react";
import { Link } from "wouter";
import { Loader2, MailCheck } from "lucide-react";
import { supabase, appUrl } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthShell } from "./auth-shell";

// دائماً نستخدم رابط الإنتاج الثابت حتى لا يتأثر redirectTo بعنوان بيئة التطوير
const APP_URL =
  appUrl.replace(/\/$/, "");

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSent, setIsSent] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setApiError(null);
    setIsLoading(true);

    const base = (import.meta.env.BASE_URL as string).replace(/\/$/, "");
    const redirectTo = `${APP_URL}${base}/reset-password`;

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo,
    });

    setIsLoading(false);

    if (error) {
      // rate limit → نعرض رسالة واضحة بدلاً من صمت
      if (error.status === 429 || error.message?.toLowerCase().includes("rate")) {
        setApiError(
          "تم إرسال طلب مؤخراً. انتظر دقيقة واحدة على الأقل قبل المحاولة مجدداً."
        );
      } else {
        setApiError(error.message);
      }
      return;
    }

    setIsSent(true);
  };

  return (
    <AuthShell title="استعادة كلمة المرور" subtitle="سنرسل لك رابط إعادة التعيين">
      {isSent ? (
        <div className="text-center space-y-4">
          <div className="w-16 h-16 bg-emerald-50 rounded-full flex items-center justify-center mx-auto text-emerald-600">
            <MailCheck className="w-8 h-8" />
          </div>
          <p className="text-gray-600 leading-relaxed">
            إذا كان البريد{" "}
            <span className="font-bold" dir="ltr">
              {email}
            </span>{" "}
            مسجلاً لدينا، فستصلك رسالة تحتوي على رابط إعادة تعيين كلمة المرور.
            تأكد من مجلد الرسائل غير المرغوب فيها (Spam).
          </p>
          <Link href="/sign-in" className="text-gold-deep font-bold hover:underline block">
            العودة لتسجيل الدخول
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <Label className="mb-2 block text-sm font-semibold">البريد الإلكتروني</Label>
            <Input
              type="email"
              dir="ltr"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
              className="bg-gray-50 border-gray-200 h-11"
            />
          </div>

          {apiError && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-md p-3">
              {apiError}
            </p>
          )}

          <Button
            type="submit"
            disabled={isLoading}
            className="w-full h-11 bg-ink text-gold-light hover:bg-ink-soft font-bold"
          >
            {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : "إرسال الرابط"}
          </Button>
          <p className="text-center text-sm text-gray-500">
            <Link href="/sign-in" className="text-gold-deep font-bold hover:underline">
              العودة لتسجيل الدخول
            </Link>
          </p>
        </form>
      )}
    </AuthShell>
  );
}
