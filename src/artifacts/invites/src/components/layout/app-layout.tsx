import { ReactNode, useState } from "react";
import { Link, useLocation } from "wouter";
import { useGetMe } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Home, Calendar, CreditCard, Shield, LogOut, Menu, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface AppLayoutProps {
  children: ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const [location] = useLocation();
  const { signOut } = useAuth();
  const { data: user, isLoading } = useGetMe();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const navigation =
    user?.role === "admin"
      ? [{ name: "لوحة التحكم", href: "/admin", icon: Shield }]
      : [
          { name: "الرئيسية", href: "/dashboard", icon: Home },
          { name: "دعواتي", href: "/events", icon: Calendar },
          { name: "الباقة", href: "/subscription", icon: CreditCard },
        ];

  const handleSignOut = async () => {
    await signOut();
    window.location.href = import.meta.env.BASE_URL;
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col md:flex-row font-sans">
      {/* Mobile Header */}
      <div className="md:hidden bg-ink text-white p-4 flex items-center justify-between z-20">
        <span className="text-2xl font-serif text-gold font-bold">دعوات</span>
        <button onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}>
          {isMobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </div>

      {/* Sidebar */}
      <div
        className={`${
          isMobileMenuOpen ? "translate-x-0" : "translate-x-full md:translate-x-0"
        } fixed md:static inset-y-0 right-0 w-64 bg-ink text-gray-300 transition-transform duration-200 ease-in-out z-10 flex flex-col`}
      >
        <div className="p-6 hidden md:block">
          <h1 className="text-4xl font-serif text-gold font-bold tracking-wider">دعوات</h1>
        </div>

        <div className="px-6 pb-6 pt-20 md:pt-0">
          {isLoading ? (
            <div className="flex items-center gap-3 mb-8">
              <Loader2 className="h-5 w-5 animate-spin text-gold" />
            </div>
          ) : (
            <div className="mb-8">
              <p className="text-sm text-gray-400">مرحباً بك،</p>
              <p className="font-semibold text-white truncate text-lg">{user?.name}</p>
            </div>
          )}
        </div>

        <nav className="flex-1 px-4 space-y-1">
          {navigation.map((item) => {
            const isActive = location === item.href || location.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.name}
                href={item.href}
                className={`flex items-center gap-3 px-4 py-3 rounded-md transition-colors ${
                  isActive
                    ? "bg-gold/10 text-gold font-medium"
                    : "hover:bg-white/5 hover:text-white"
                }`}
                onClick={() => setIsMobileMenuOpen(false)}
              >
                <item.icon className={`h-5 w-5 ${isActive ? "text-gold" : ""}`} />
                {item.name}
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-white/10">
          <button
            onClick={handleSignOut}
            className="flex w-full items-center gap-3 px-4 py-3 rounded-md text-gray-400 hover:bg-white/5 hover:text-white transition-colors"
          >
            <LogOut className="h-5 w-5" />
            تسجيل الخروج
          </button>
        </div>
      </div>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        <div className="flex-1 overflow-y-auto">
          {children}
        </div>
      </main>

      {/* Mobile Overlay */}
      {isMobileMenuOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-0 md:hidden"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}
    </div>
  );
}
