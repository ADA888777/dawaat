import { useEffect, useState } from "react";
import { toDataURL } from "qrcode";

/**
 * يولّد صورة QR للرابط داخل المتصفح.
 *
 * لماذا لا نستخدم خدمة QR خارجية (مثل api.qrserver.com)؟
 * لأن ذلك يرسل رابط كل دعوة إلى نطاق طرف ثالث، ويجعل صفحة
 * الدعوة تعتمد على توفر موقع لا نتحكم فيه.
 */
export function useQrDataUrl(value: string, pixelSize = 512) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setDataUrl(null);
    setError(false);
    if (!value) return;

    toDataURL(value, {
      errorCorrectionLevel: "M",
      margin: 2,
      width: pixelSize,
      color: { dark: "#0f0f13ff", light: "#ffffffff" },
    })
      .then((url: string) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });

    return () => {
      cancelled = true;
    };
  }, [value, pixelSize]);

  return { dataUrl, error };
}

interface QrCodeProps {
  /** الرابط المرمّز داخل الـ QR */
  value: string;
  /** الحجم المعروض بالبكسل */
  size?: number;
  className?: string;
  alt?: string;
}

/**
 * مربع QR جاهز للمسح. إن فشل التوليد لا يُعرض شيء،
 * وتبقى مسؤولية إظهار الرابط نصاً على المكوّن الأب حتى لا يخسر
 * المدعو طريقة الوصول للدعوة.
 */
export function QrCode({ value, size = 176, className, alt = "رمز QR لرابط الدعوة" }: QrCodeProps) {
  const { dataUrl, error } = useQrDataUrl(value, Math.max(256, size * 2));

  if (error) return null;

  if (!dataUrl) {
    return (
      <div
        className={`animate-pulse rounded-xl bg-white/20 ${className ?? ""}`}
        style={{ width: size, height: size }}
        aria-hidden="true"
      />
    );
  }

  return (
    <img
      src={dataUrl}
      alt={alt}
      width={size}
      height={size}
      className={`rounded-xl bg-white ${className ?? ""}`}
    />
  );
}
