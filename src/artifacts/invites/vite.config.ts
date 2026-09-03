import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

import runtimeErrorOverlay from '@replit/vite-plugin-runtime-error-modal';

/**
 * PORT و BASE_PATH كانا مطلوبين إجبارياً ويُسقطان البناء إن غابا.
 * هذا افتراض خاص ببيئة Replit، وكان يمنع البناء على أي استضافة أخرى
 * (Cloudflare و Vercel و Netlify وحتى البناء المحلي).
 * الآن لهما قيم افتراضية منطقية، ويبقى تجاوزهما ممكناً عند الحاجة.
 */
const port = Number(process.env.PORT ?? 5173);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`قيمة PORT غير صالحة: "${process.env.PORT}"`);
}

// الجذر "/" هو الصحيح للنشر على نطاق مستقل.
// اضبط BASE_PATH فقط إذا نُشر الموقع داخل مسار فرعي.
const basePath = process.env.BASE_PATH ?? '/';

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== 'production' &&
    process.env.REPL_ID !== undefined
      ? [
          await import('@replit/vite-plugin-cartographer').then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, '..'),
            }),
          ),
          await import('@replit/vite-plugin-dev-banner').then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      '@assets': path.resolve(
        import.meta.dirname,
        '..',
        '..',
        'attached_assets',
      ),
    },
    dedupe: ['react', 'react-dom'],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/public'),
    emptyOutDir: true,
    // تقسيم الحزم متروك لـ Rollup تلقائياً.
    //
    // كانت هنا دالة manualChunks تفصل react و radix و lucide إلى حزم
    // منفصلة، فتُنفَّذ بعضها قبل تهيئة React فتنهار الصفحة كلها بخطأ:
    // Cannot set properties of undefined (setting 'Children')
    // ولا يظهر هذا في وضع التطوير لأنه لا يقسّم الحزم إطلاقاً.
    //
    // التقسيم المفيد يأتي أصلاً من التحميل الكسول للمسارات في App.tsx،
    // وهو ما يمنع تحميل لوحة الإدارة على من يفتح رابط دعوة.
  },

  server: {
    port,
    strictPort: true,
    host: '0.0.0.0',
    allowedHosts: true,
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: '0.0.0.0',
    allowedHosts: true,
  },
});
