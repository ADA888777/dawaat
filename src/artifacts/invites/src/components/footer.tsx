import { Link } from "wouter";

const linkGroups = [
  {
    title: "المنصة",
    links: [
      { href: "/", label: "الرئيسية" },
      { href: "/sign-up", label: "إنشاء حساب" },
      { href: "/sign-in", label: "تسجيل الدخول" },
    ],
  },
  {
    title: "السياسات",
    links: [
      { href: "/terms", label: "شروط الاستخدام" },
      { href: "/privacy", label: "سياسة الخصوصية" },
      { href: "/refund", label: "الاسترداد والإلغاء" },
      { href: "/content-policy", label: "سياسة المحتوى" },
    ],
  },
  {
    title: "المساعدة",
    links: [
      { href: "/help", label: "مركز المساعدة" },
      { href: "/help#faq", label: "الأسئلة الشائعة" },
    ],
  },
];

export function Footer() {
  return (
    <footer className="bg-ink text-gray-300">
      <div className="mx-auto max-w-[1120px] px-5 pt-14 md:px-6">
        <div className="grid grid-cols-1 gap-10 border-b border-white/10 pb-10 sm:grid-cols-2 lg:grid-cols-[1.6fr_1fr_1fr_1fr]">
          <div className="sm:col-span-2 lg:col-span-1">
            <span className="text-[28px] font-bold tracking-[0.06em] text-gold-light">دعوات</span>
            <p className="mt-3.5 max-w-[38ch] text-sm leading-[1.95] text-gray-400">
              منصة دعوات إلكترونية فاخرة لمناسباتكم الاستثنائية — تصميم، إدارة حضور، وتأكيد دعوات
              في مكان واحد.
            </p>
          </div>

          {linkGroups.map((group) => (
            <div key={group.title}>
              <h3 className="mb-4 text-[15px] font-bold text-gold-light">{group.title}</h3>
              <ul className="flex flex-col gap-2.5">
                {group.links.map((link) => (
                  <li key={link.href + link.label}>
                    <Link
                      href={link.href}
                      className="text-sm text-gray-400 transition-colors hover:text-gold-light"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="flex flex-col items-center justify-between gap-4 py-5 text-[13px] text-gray-500 md:flex-row">
          <p>جميع الحقوق محفوظة لمنصة دعوات &copy; {new Date().getFullYear()}</p>
          <nav className="flex gap-5">
            <Link href="/terms" className="transition-colors hover:text-gold-light">الشروط</Link>
            <Link href="/privacy" className="transition-colors hover:text-gold-light">الخصوصية</Link>
            <Link href="/help" className="transition-colors hover:text-gold-light">المساعدة</Link>
          </nav>
        </div>
      </div>
    </footer>
  );
}
