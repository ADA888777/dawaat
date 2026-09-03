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
    <footer className="border-t border-white/10 bg-ink-soft">
      <div className="max-w-7xl mx-auto px-4 md:px-8 py-14">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-10">
          <div className="space-y-3">
            <div className="text-3xl font-serif text-gold-light font-bold">دعوات</div>
            <p className="text-gray-400 text-sm leading-relaxed max-w-xs">
              منصة دعوات إلكترونية فاخرة لمناسباتكم الاستثنائية — تصميم، إدارة حضور، وتأكيد دعوات في مكان واحد.
            </p>
          </div>
          {linkGroups.map((group) => (
            <div key={group.title}>
              <h3 className="text-white font-bold mb-4">{group.title}</h3>
              <ul className="space-y-2.5">
                {group.links.map((link) => (
                  <li key={link.href + link.label}>
                    <Link
                      href={link.href}
                      className="text-gray-400 hover:text-gold-light text-sm transition-colors"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="border-t border-white/10 mt-12 pt-6 flex flex-col md:flex-row items-center justify-between gap-3 text-sm text-gray-400">
          <p>جميع الحقوق محفوظة لمنصة دعوات &copy; {new Date().getFullYear()}</p>
          <div className="flex gap-6">
            <Link href="/terms" className="hover:text-gold-light transition-colors">الشروط</Link>
            <Link href="/privacy" className="hover:text-gold-light transition-colors">الخصوصية</Link>
            <Link href="/help" className="hover:text-gold-light transition-colors">المساعدة</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
