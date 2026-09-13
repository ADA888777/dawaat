import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthShell } from "./auth-shell";

export default function SignInPage() {
  const [, setLocation] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
    setIsLoading(false);
    if (authError) {
      setError(
        authError.message.includes("Invalid login credentials")
          ? "البريد الإلكتروني أو كلمة المرور غير صحيحة"
          : authError.message.includes("Email not confirmed")
            ? "يرجى تأكيد بريدك الإلكتروني أولاً عبر الرابط المرسل إليك"
            : "تعذر تسجيل الدخول، حاول مرة أخرى",
      );
      return;
    }
    setLocation("/");
  };

  return (
    <AuthShell title="مرحباً بك" subtitle="سجل الدخول للوصول إلى حسابك">
      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <Label className="mb-2 block text-sm font-semibold">البريد الإلكتروني</Label>
          <Input type="email" dir="ltr" inputMode="email" autoComplete="email" required value={email}
            onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com"
            className="bg-gray-50 border-gray-200 h-11" />
        </div>
        <div>
          <div className="flex justify-between items-center mb-2">
            <Label className="text-sm font-semibold">كلمة المرور</Label>
            <Link href="/forgot-password" className="text-xs text-gold-deep hover:underline font-medium">
              نسيت كلمة المرور؟
            </Link>
          </div>
          <Input type="password" dir="ltr" autoComplete="current-password" required value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="bg-gray-50 border-gray-200 h-11" />
        </div>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-md p-3">{error}</p>
        )}

        <Button type="submit" disabled={isLoading}
          className="w-full h-11 bg-ink text-gold-light hover:bg-ink-soft font-bold">
          {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : "تسجيل الدخول"}
        </Button>
      </form>

      <p className="text-center text-sm text-gray-500 mt-6">
        ليس لديك حساب؟{" "}
        <Link href="/sign-up" className="text-gold-deep font-bold hover:underline">أنشئ حساباً</Link>
      </p>
    </AuthShell>
  );
}
