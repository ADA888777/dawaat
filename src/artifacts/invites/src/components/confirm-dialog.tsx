import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/**
 * [ن-1] حوار تأكيد بديل عن confirm() الأصلي.
 *
 * confirm() يوقف خيط الواجهة، ولا يمكن تنسيقه أو ترجمته أو ضبط اتجاهه،
 * ويظهر بمظهر المتصفح لا بمظهر التطبيق. هذا المكوّن يعطي نفس الوظيفة
 * مع دعم RTL وحالة تحميل أثناء تنفيذ العملية.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "تأكيد",
  cancelLabel = "إلغاء",
  destructive = false,
  isPending = false,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  isPending?: boolean;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent dir="rtl" className="text-right">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && (
            <AlertDialogDescription>{description}</AlertDialogDescription>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-row-reverse gap-2 sm:flex-row-reverse">
          <AlertDialogAction
            onClick={(e) => {
              // نمنع الإغلاق التلقائي ليبقى الحوار ظاهراً أثناء التنفيذ
              e.preventDefault();
              onConfirm();
            }}
            disabled={isPending}
            className={
              destructive
                ? "bg-red-600 text-white hover:bg-red-700 focus:ring-red-600"
                : undefined
            }
          >
            {isPending ? "جارٍ التنفيذ..." : confirmLabel}
          </AlertDialogAction>
          <AlertDialogCancel disabled={isPending}>{cancelLabel}</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
