import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Calendar, Users, Star, ArrowLeft } from "lucide-react";
import { useListTemplates } from "@/lib/api";
import { Footer } from "@/components/footer";

export default function Home() {
  const { data: templates } = useListTemplates();

  return (
    <div className="min-h-screen bg-ink text-white">
      {/* Header */}
      <header className="absolute top-0 w-full p-6 flex justify-between items-center z-10">
        <div className="text-3xl font-serif text-gold-light font-bold">دعوات</div>
        <div className="flex gap-4">
          <Link href="/sign-in" className="text-gray-300 hover:text-white px-4 py-2 transition-colors">
            تسجيل الدخول
          </Link>
          <Link href="/sign-up" className="bg-gold text-black px-6 py-2 rounded-md font-medium hover:bg-gold/90 transition-colors">
            ابدأ الآن
          </Link>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative pt-40 pb-20 px-4 md:px-8 max-w-7xl mx-auto flex flex-col items-center text-center">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-gold/10 via-ink to-ink -z-10" />
        
        <h1 className="text-5xl md:text-7xl font-bold mb-6 leading-tight">
          دعوات إلكترونية تليق <br className="hidden md:block" />
          <span className="text-gold-light font-serif mt-2 block">بمناسباتكم الاستثنائية</span>
        </h1>
        
        <p className="text-xl text-gray-400 mb-10 max-w-2xl leading-relaxed">
          نصمم لك واجهة رقمية تعكس فخامة مناسبتك. دعوات زفاف، خطوبة، وتخرج، مع نظام متكامل لإدارة الحضور وتأكيد الدعوات.
        </p>

        <Link href="/sign-up" className="bg-gold text-black text-lg px-8 py-4 rounded-md font-medium hover:bg-gold/90 transition-colors flex items-center gap-2">
          اصنع دعوتك الآن
          <ArrowLeft className="w-5 h-5" />
        </Link>
      </section>

      {/* Features */}
      <section className="py-24 bg-ink-soft">
        <div className="max-w-7xl mx-auto px-4 md:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold mb-4 text-gold-light">كيف نعمل</h2>
            <p className="text-gray-400 max-w-2xl mx-auto">نقدم لك تجربة متكاملة من التصميم حتى استقبال الضيوف</p>
          </div>

          <div className="grid md:grid-cols-3 gap-12 text-center">
            <div className="space-y-4">
              <div className="w-16 h-16 rounded-full bg-gold/10 flex items-center justify-center mx-auto text-gold-light">
                <Star className="w-8 h-8" />
              </div>
              <h3 className="text-xl font-bold">تصاميم حصرية</h3>
              <p className="text-gray-400">قوالب مصممة بعناية فائقة لتعكس رقي وفخامة مناسبتك</p>
            </div>
            <div className="space-y-4">
              <div className="w-16 h-16 rounded-full bg-gold/10 flex items-center justify-center mx-auto text-gold-light">
                <Calendar className="w-8 h-8" />
              </div>
              <h3 className="text-xl font-bold">إدارة سهلة</h3>
              <p className="text-gray-400">لوحة تحكم بسيطة لإضافة التفاصيل وتحديثها في أي وقت</p>
            </div>
            <div className="space-y-4">
              <div className="w-16 h-16 rounded-full bg-gold/10 flex items-center justify-center mx-auto text-gold-light">
                <Users className="w-8 h-8" />
              </div>
              <h3 className="text-xl font-bold">متابعة الحضور</h3>
              <p className="text-gray-400">تأكيد إلكتروني فوري وإحصائيات دقيقة لعدد الضيوف</p>
            </div>
          </div>
        </div>
      </section>

      {/* Templates Showcase */}
      <section className="py-24 max-w-7xl mx-auto px-4 md:px-8">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold mb-4 text-gold-light">تصفح القوالب</h2>
          <p className="text-gray-400 max-w-2xl mx-auto">تشكيلة مختارة من أجمل القوالب الجاهزة للاستخدام</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {(templates || []).slice(0, 6).map((template) => (
            <div key={template.id} className="group relative overflow-hidden rounded-xl bg-ink-soft border border-white/5">
              <div className="aspect-[3/4] relative">
                <img 
                  src={template.previewImage} 
                  alt={template.name}
                  className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent flex items-end p-6">
                  <div>
                    <span className="text-gold-light text-sm font-medium mb-1 block">
                      {template.category === 'wedding' ? 'زفاف' : 
                       template.category === 'engagement' ? 'خطوبة' :
                       template.category === 'graduation' ? 'تخرج' :
                       template.category === 'birthday' ? 'ميلاد' :
                       template.category === 'meeting' ? 'اجتماع' : 'عام'}
                    </span>
                    <h3 className="text-xl font-bold text-white">{template.name}</h3>
                  </div>
                </div>
              </div>
            </div>
          ))}
          {(!templates || templates.length === 0) && (
            <div className="col-span-full text-center py-20 text-gray-400">
              جارِ تحميل القوالب...
            </div>
          )}
        </div>
      </section>

      <Footer />
    </div>
  );
}
