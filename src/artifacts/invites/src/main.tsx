import { createRoot } from 'react-dom/client';

import App from './App';
import { isConfigured } from './lib/supabase';

import './index.css';

/**
 * لو لم يُضبط مفتاح Supabase بعد، نعرض إرشاداً واضحاً بدل صفحة بيضاء
 * أو خطأ في الطرفية لا يراه أحد.
 */
function SetupNeeded() {
  return (
    <div
      dir="rtl"
      style={{
        minHeight: '100vh', display: 'grid', placeItems: 'center',
        background: '#29251F', color: '#FAF7F1', padding: 24,
        fontFamily: 'Cairo, system-ui, sans-serif', textAlign: 'center',
      }}
    >
      <div style={{ maxWidth: 520 }}>
        <h1 style={{ color: '#B99668', fontSize: 28, marginBottom: 12 }}>
          خطوة أخيرة قبل التشغيل
        </h1>
        <p style={{ lineHeight: 1.9, color: '#D5CCBE' }}>
          افتح الملف <code style={{ color: '#B99668' }}>config.js</code> داخل مجلد
          الموقع، والصق مفتاح <strong>anon public</strong> من لوحة Supabase في
          السطر المخصص له، ثم احفظ الملف وحدّث هذه الصفحة.
        </p>
        <p style={{ marginTop: 16, fontSize: 14, color: '#B3AA9E' }}>
          Supabase ← Settings ← API ← Project API keys ← anon public
        </p>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  isConfigured ? <App /> : <SetupNeeded />,
);
