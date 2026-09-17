import { Ghost, Mail, MessageCircle, type LucideIcon } from "lucide-react";
import { useGetAppSettings } from "@/lib/api";
import { toWhatsAppNumber } from "@/lib/invite";

interface ContactItem {
  key: string;
  label: string;
  value: string;
  href: string;
  icon: LucideIcon;
  external: boolean;
}

interface SidebarContactProps {
  /** يُستدعى عند الضغط لإغلاق القائمة الجانبية على الجوال */
  onNavigate?: () => void;
}

/**
 * قسم «تواصل معنا» في القائمة الجانبية.
 * البيانات تُقرأ من إعدادات النظام (app_settings) ولا تُكتب داخل الكود،
 * فأي تعديل من لوحة الأدمن ينعكس عند جميع العملاء.
 * أي حقل فارغ يُخفي سطره، ولو فرغت كلها اختفى القسم بالكامل.
 */
export function SidebarContact({ onNavigate }: SidebarContactProps) {
  const { data: settings } = useGetAppSettings();

  const email = (settings?.supportEmail ?? "").trim();
  // الواتساب يرجع لرقم خدمة العملاء إن تُرك فارغاً
  const whatsappRaw = (settings?.supportWhatsapp || settings?.supportPhone || "").trim();
  const whatsappNumber = whatsappRaw ? toWhatsAppNumber(whatsappRaw) : "";
  const snapchat = (settings?.supportSnapchat ?? "").trim().replace(/^@/, "");

  const items: ContactItem[] = [];

  if (email) {
    items.push({
      key: "email",
      label: "البريد الإلكتروني",
      value: email,
      // mailto يفتح تطبيق البريد على الجوال والكمبيوتر مع تعبئة المستلم
      href: `mailto:${email}`,
      icon: Mail,
      external: false,
    });
  }

  if (whatsappNumber) {
    items.push({
      key: "whatsapp",
      label: "واتساب",
      value: whatsappRaw,
      // wa.me يفتح المحادثة مباشرة في التطبيق أو على الويب
      href: `https://wa.me/${whatsappNumber}`,
      icon: MessageCircle,
      external: true,
    });
  }

  if (snapchat) {
    items.push({
      key: "snapchat",
      label: "سناب شات",
      value: snapchat,
      // رابط add يفتح الحساب مباشرة في تطبيق سناب شات
      href: `https://www.snapchat.com/add/${encodeURIComponent(snapchat)}`,
      icon: Ghost,
      external: true,
    });
  }

  if (items.length === 0) return null;

  return (
    <div className="px-4 pt-4 mt-2 border-t border-white/10">
      <p className="px-4 pb-2 text-xs font-semibold tracking-wide text-gray-500">تواصل معنا</p>
      <ul className="space-y-1">
        {items.map((item) => (
          <li key={item.key}>
            <a
              href={item.href}
              target={item.external ? "_blank" : undefined}
              rel={item.external ? "noopener noreferrer" : undefined}
              onClick={onNavigate}
              className="flex items-center gap-3 px-4 py-2.5 rounded-md text-gray-400 hover:bg-white/5 hover:text-white transition-colors"
            >
              <item.icon className="h-5 w-5 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm leading-tight">{item.label}</span>
                <span className="block text-xs text-gray-500 truncate" dir="ltr">
                  {item.value}
                </span>
              </span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
