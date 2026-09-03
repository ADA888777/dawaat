import { type ReactNode } from "react";
import { Link } from "wouter";

export function AuthShell({ title, subtitle, children }: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-[100dvh] bg-ink flex flex-col items-center justify-center px-4 py-12 relative overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-gold/10 via-ink to-ink" />
      <Link href="/" className="relative z-10 text-4xl font-bold text-gold-light font-serif mb-8 tracking-wider">
        دعوات
      </Link>
      <div className="relative z-10 w-full max-w-md bg-white rounded-2xl shadow-2xl border border-white/10 p-8">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-900 mb-1">{title}</h1>
          <p className="text-sm text-gray-400">{subtitle}</p>
        </div>
        {children}
      </div>
    </div>
  );
}
