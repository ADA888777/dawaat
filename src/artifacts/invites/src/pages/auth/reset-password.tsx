import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthShell } from "./auth-shell";

/**
 * صفحة تعيين كلمة مرور جديدة.
 *
 * عندما يضغط المستخدم رابط البريد يصل إلى:
 *   /reset-password#access_token=xxx&type=recovery
 *
 * يقرأ Supabase (detectSessionInUrl:true) الـ hash تلقائياً ويطلق
 * حدث PASSWORD_RECOVERY عبر onAuthStateChange.
 *
 * تحقق أولي: إذا لم يكن في الـ hash أي token نعتبر الرابط غير صالح فوراً
 * دون الانتظار 5 ثوانٍ.
 */
export default function ResetPasswordPage() {
  const [, setLocation] = useLocation();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // حالة الجلسة: "waiting" → "ready" | "invalid"
  const [sessionState, setSessionState] = useState<"waiting" | "ready" | "invalid">(
    "waiting"
  );

  useEffect(() => {
    // التحقق الفوري: هل يوجد recovery token في الـ URL hash؟
    const hash = window.location.hash;
    const hasToken =
      hash.includes("access_token=") || hash.includes("type=recovery");

    if (!hasToken) {
      // لا يوجد token → الرابط مفتوح مباشرة أو منتهٍ
      setSessionState("invalid");
      return;
    }

    // يوجد token → ننتظر حدث PASSWORD_RECOVERY من Supabase
    // مهلة 8 ثوانٍ للأجهزة البطيئة
    const timeout = setTimeout(() => {
      setSessionState((s) => (s === "waiting" ? "invalid" : s));
    }, 8000);

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" && session) {
        clearTimeout(timeout);
        setSessionState("ready");
      }
    });

    return () => {
      clearTimeout(timeout);
      subscription.unsubscribe();
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < 6) {
      setError("كلمة المرور يجب أن تكون 6 أحرف على الأقل");
      return;
    }
    if (password !== confirm) {
      setError("كلمتا المرور غير متطابقتين");
      return;
    }

    setIsLoading(true);
    const { error: authError } = await supabase.auth.updateUser({ password });
    setIsLoading(false);

    if (authError) {
      setError("تعذر تحديث كلمة المرور. حاول فتح رابط البريد مجدداً أو اطلب رابطاً جديداً.");
      return;
    }

    // تسجيل الخروج من جلسة الاسترداد ثم التوجيه لتسجيل الدخول
    await supabase.auth.signOut();
    setLocation("/sign-in");
  };

  // ── حالة الانتظار ──
  if (sessionState === "waiting") {
    return (
      <AuthShell title="جارٍ التحقق…" subtitle="يُرجى الانتظار لحظة">
        <div className="flex justify-center py-8">
          <Loader2 className="w-8 h-8 animate-spin text-gold" />
        </div>
      </AuthShell>
    );
  }

  // ── رابط منتهٍ أو مفتوح بدون بريد ──
  if (sessionState === "invalid") {
    return (
      <AuthShell title="الرابط غير صالح" subtitle="انتهت صلاحية رابط إعادة التعيين">
        <div className="text-center space-y-5">
          <p className="text-gray-600 text-sm leading-relaxed">
            رابط إعادة التعيين انتهت صلاحيته أو تم استخدامه بالفعل.
            اطلب رابطاً جديداً من صفحة استعادة كلمة المرور.
          </p>
          <Button
            onClick={() => setLocation("/forgot-password")}
            className="w-full h-11 bg-ink text-gold-light hover:bg-ink-soft font-bold"
          >
            طلب رابط جديد
          </Button>
        </div>
      </AuthShell>
    );
  }

  // ── الجلسة جاهزة (PASSWORD_RECOVERY event): الفورم ──
  return (
    <AuthShell title="كلمة مرور جديدة" subtitle="اختر كلمة مرور قوية لحسابك">
      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <Label className="mb-2 block text-sm font-semibold">كلمة المرور الجديدة</Label>
          <Input
            type="password"
            dir="ltr"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="bg-gray-50 border-gray-200 h-11"
          />
        </div>
        <div>
          <Label className="mb-2 block text-sm font-semibold">تأكيد كلمة المرور</Label>
          <Input
            type="password"
            dir="ltr"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="bg-gray-50 border-gray-200 h-11"
          />
        </div>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-md p-3">
            {error}
          </p>
        )}

        <Button
          type="submit"
          disabled={isLoading}
          className="w-full h-11 bg-ink text-gold-light hover:bg-ink-soft font-bold"
        >
          {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : "تحديث كلمة المرور"}
        </Button>
      </form>
    </AuthShell>
  );
}
