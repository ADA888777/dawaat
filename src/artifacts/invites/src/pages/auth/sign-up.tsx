import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Loader2, MailCheck } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthShell } from "./auth-shell";

export default function SignUpPage() {
  const [, setLocation] = useLocation();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [needsConfirmation, setNeedsConfirmation] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 6) {
      setError("كلمة المرور يجب أن تكون 6 أحرف على الأقل");
      return;
    }
    setIsLoading(true);
    const { data, error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: name.trim() },
        emailRedirectTo: window.location.origin + import.meta.env.BASE_URL,
      },
    });
    setIsLoading(false);
    if (authError) {
      setError(
        authError.message.includes("already registered")
          ? "هذا البريد الإلكتروني مسجل مسبقاً"
          : "تعذر إنشاء الحساب، حاول مرة أخرى",
      );
      return;
    }
    if (data.session) {
      setLocation("/");
    } else {
      setNeedsConfirmation(true);
    }
  };

  if (needsConfirmation) {
    return (
      <AuthShell title="تحقق من بريدك" subtitle="خطوة واحدة متبقية">
        <div className="text-center space-y-4">
          <div className="w-16 h-16 bg-emerald-50 rounded-full flex items-center justify-center mx-auto text-emerald-600">
            <MailCheck className="w-8 h-8" />
          </div>
          <p className="text-gray-600 leading-relaxed">
            أرسلنا رابط تأكيد إلى <span className="font-bold" dir="ltr">{email}</span>.
            افتح الرسالة واضغط على الرابط لتفعيل حسابك.
          </p>
          <Link href="/sign-in" className="text-gold-deep font-bold hover:underline block">
            العودة لتسجيل الدخول
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="إنشاء حساب" subtitle="ابدأ بتصميم دعواتك الآن">
      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <Label className="mb-2 block text-sm font-semibold">الاسم الكامل</Label>
          <Input required value={name} onChange={(e) => setName(e.target.value)}
            placeholder="مثال: أحمد العلي" className="bg-gray-50 border-gray-200 h-11" />
        </div>
        <div>
          <Label className="mb-2 block text-sm font-semibold">البريد الإلكتروني</Label>
          <Input type="email" dir="ltr" required value={email}
            onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com"
            className="bg-gray-50 border-gray-200 h-11" />
        </div>
        <div>
          <Label className="mb-2 block text-sm font-semibold">كلمة المرور</Label>
          <Input type="password" dir="ltr" required value={password}
            onChange={(e) => setPassword(e.target.value)} placeholder="6 أحرف على الأقل"
            className="bg-gray-50 border-gray-200 h-11" />
        </div>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-md p-3">{error}</p>
        )}

        <Button type="submit" disabled={isLoading}
          className="w-full h-11 bg-ink text-gold-light hover:bg-ink-soft font-bold">
          {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : "إنشاء الحساب"}
        </Button>
      </form>

      <p className="text-center text-sm text-gray-500 mt-6">
        لديك حساب بالفعل؟{" "}
        <Link href="/sign-in" className="text-gold-deep font-bold hover:underline">سجل الدخول</Link>
      </p>
    </AuthShell>
  );
}
