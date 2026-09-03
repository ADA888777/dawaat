#!/usr/bin/env python3
"""فحص الموقع في متصفح حقيقي: تدفق كامل من الدخول حتى الرد على الدعوة."""
import subprocess, sys, time
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:5000"
PG = "postgresql://postgres@/postgres?host=/tmp&port=5433"
SHOTS = "/tmp/shots"
subprocess.run(["mkdir", "-p", SHOTS])

def sql(q):
    return subprocess.run(["psql", PG, "-t", "-A", "-c", q],
                          capture_output=True, text=True).stdout.strip()

results, errors = [], []

def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(f"  {'✅' if ok else '❌'} {name}" + (f"  → {detail}" if detail else ""))

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path="/tmp/chromium",
        args=["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"])
    ctx = browser.new_context(viewport={"width": 1280, "height": 900}, locale="ar-SA")
    page = ctx.new_page()

    # نلتقط أخطاء الطرفية وأخطاء الشبكة — أي خطأ هنا عيب حقيقي
    page.on("console", lambda m: errors.append(f"console.{m.type}: {m.text}")
            if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))

    def goto(path, wait=1400):
        page.goto(BASE + path, wait_until="domcontentloaded")
        page.wait_for_timeout(wait)

    def shot(name):
        page.screenshot(path=f"{SHOTS}/{name}.png", full_page=True)

    print("\n══════ 1. الصفحة الرئيسية (زائر) ══════")
    goto("/")
    body = page.inner_text("body")
    check("الصفحة تُحمَّل", len(body) > 100, f"{len(body)} حرف")
    check("المحتوى بالعربية", "دعوات" in body)
    check("اتجاه RTL مضبوط", page.get_attribute("html", "dir") == "rtl"
          or page.evaluate("getComputedStyle(document.body).direction") == "rtl")
    # نبحث عن ألوان اللوحة في أي عنصر معروض بدل خلفية body وحدها
    palette = page.evaluate("""() => {
      const want = ['rgb(155, 116, 69)','rgb(185, 150, 104)','rgb(144, 107, 64)',
                    'rgb(41, 37, 31)','rgb(250, 247, 241)','rgb(242, 234, 223)'];
      const old  = ['rgb(212, 175, 55)','rgb(18, 18, 18)','rgb(26, 26, 26)'];
      let hitNew = new Set(), hitOld = new Set();
      for (const el of document.querySelectorAll('*')) {
        const st = getComputedStyle(el);
        for (const v of [st.color, st.backgroundColor, st.borderTopColor]) {
          if (want.includes(v)) hitNew.add(v);
          if (old.includes(v))  hitOld.add(v);
        }
      }
      return {n: [...hitNew], o: [...hitOld]};
    }""")
    check("ألوان اللوحة الجديدة مطبَّقة", len(palette["n"]) >= 2,
          f"{len(palette['n'])} لون جديد")
    check("لا أثر للألوان القديمة", len(palette["o"]) == 0,
          ", ".join(palette["o"]) if palette["o"] else "نظيف")
    shot("01-home")

    print("\n══════ 2. تسجيل الدخول ══════")
    goto("/sign-in")
    check("صفحة الدخول ظاهرة", page.locator("input[type=email]").count() > 0)
    shot("02-signin")

    # كلمة مرور خاطئة أولاً
    page.fill("input[type=email]", "user@dawat.sa")
    page.fill("input[type=password]", "WrongPassword")
    page.click("button[type=submit]")
    page.wait_for_timeout(2500)
    txt = page.inner_text("body")
    check("رسالة خطأ عربية صحيحة", "غير صحيحة" in txt,
          [l for l in txt.split("\n") if "غير صحيحة" in l][:1])
    shot("03-wrong-password")

    # الدخول الصحيح
    page.fill("input[type=password]", "User#2026")
    page.click("button[type=submit]")
    page.wait_for_timeout(3500)
    check("الدخول ينقل إلى لوحة المستخدم", "/dashboard" in page.url, page.url)
    shot("04-dashboard")

    print("\n══════ 3. لوحة المستخدم ══════")
    body = page.inner_text("body")
    check("اسم المستخدم يظهر", "سعود" in body)
    check("المناسبة تظهر", "زواج سعود" in body)

    print("\n══════ 4. قائمة المناسبات والتفاصيل ══════")
    goto("/events")
    body = page.inner_text("body")
    check("قائمة المناسبات تعمل", "زواج سعود" in body)
    shot("05-events")

    ev_id = sql("select id from public.events where title like 'زواج%' limit 1")
    goto(f"/events/{ev_id}")
    body = page.inner_text("body")
    check("صفحة تفاصيل المناسبة", "زواج سعود" in body)
    check("المدعوون معروضون", "خالد العتيبي" in body or "نورة" in body)
    shot("06-event-detail")

    print("\n══════ 5. نموذج إنشاء مناسبة ══════")
    goto("/events/new")
    check("النموذج يُحمَّل", page.locator("input, textarea").count() > 2,
          f"{page.locator('input, textarea').count()} حقل")
    shot("07-new-event")

    print("\n══════ 6. صفحة الاشتراك ══════")
    goto("/subscription")
    check("صفحة الاشتراك تعمل", len(page.inner_text("body")) > 200)
    shot("08-subscription")

    print("\n══════ 7. منع المستخدم العادي من لوحة الإدارة ══════")
    goto("/admin", wait=2500)
    check("المستخدم العادي يُبعَد عن /admin", "/admin" not in page.url, page.url)

    print("\n══════ 8. صفحة الدعوة العامة (زائر) ══════")
    slug = sql("select share_slug from public.events where title like 'زواج%' limit 1")
    tok = sql(f"""select g.invite_token from public.guests g
                  join public.events e on e.id=g.event_id
                  where e.share_slug='{slug}' limit 1""")
    guest = ctx.browser.new_context(viewport={"width": 420, "height": 900}, locale="ar-SA")
    gp = guest.new_page()
    gp.on("pageerror", lambda e: errors.append(f"invite pageerror: {e}"))

    gp.goto(f"{BASE}/invite/{slug}", wait_until="domcontentloaded")
    gp.wait_for_timeout(2500)
    body = gp.inner_text("body")
    check("الدعوة تفتح بلا تسجيل دخول", "زواج سعود" in body)
    check("مكان المناسبة ظاهر", "الماسة" in body or "جدة" in body)
    gp.screenshot(path=f"{SHOTS}/09-invite-public.png", full_page=True)

    print("\n══════ 9. الدعوة بالرمز الشخصي ══════")
    before = sql(f"select attendance_status from public.guests where invite_token='{tok}'")
    gp.goto(f"{BASE}/invite/{slug}?t={tok}", wait_until="domcontentloaded")
    gp.wait_for_timeout(2500)
    body = gp.inner_text("body")
    check("اسم المدعو يظهر من الرمز", "خالد" in body or "نورة" in body)
    check("الجوال غير ظاهر في الصفحة", "0501234567" not in body)
    check("الجوال غير ظاهر في الرابط", "phone" not in gp.url)
    gp.screenshot(path=f"{SHOTS}/10-invite-token.png", full_page=True)

    # الرد بضغطة واحدة
    btns = gp.locator("button")
    clicked = False
    for i in range(btns.count()):
        t = btns.nth(i).inner_text()
        if "سأحضر" in t or "أحضر" in t or "قبول" in t:
            btns.nth(i).click(); clicked = True; break
    gp.wait_for_timeout(2500)
    after = sql(f"select attendance_status from public.guests where invite_token='{tok}'")
    check("الرد بضغطة واحدة يُسجَّل", clicked and after != before, f"{before} ← {after}")
    gp.screenshot(path=f"{SHOTS}/11-rsvp-done.png", full_page=True)
    guest.close()

    print("\n══════ 10. لوحة الإدارة (أدمن) ══════")
    admin = ctx.browser.new_context(viewport={"width": 1280, "height": 900}, locale="ar-SA")
    ap = admin.new_page()
    ap.on("pageerror", lambda e: errors.append(f"admin pageerror: {e}"))
    ap.goto(f"{BASE}/sign-in", wait_until="domcontentloaded")
    ap.wait_for_timeout(1200)
    ap.fill("input[type=email]", "admin@dawat.sa")
    ap.fill("input[type=password]", "Admin#2026")
    ap.click("button[type=submit]")
    ap.wait_for_timeout(6000)
    check("الأدمن يُوجَّه إلى /admin تلقائياً", "/admin" in ap.url, ap.url)
    ap.wait_for_timeout(2000)
    body = ap.inner_text("body")
    check("لوحة الإدارة تعرض القوالب", "ليلة العمر" in body or "القوالب" in body)
    # نستهدف التبويب بدوره لا بنصه: النص وحده يلتقط وصف الصفحة أيضاً
    tabs = ap.get_by_role("tab")
    for i in range(tabs.count()):
        name = tabs.nth(i).inner_text().strip()
        tabs.nth(i).click(); ap.wait_for_timeout(2200)
        panel = ap.get_by_role("tabpanel").first.inner_text()
        expect = {"المستخدمين": "admin@dawat.sa", "المناسبات": "زواج سعود",
                  "القوالب": "ليلة العمر"}.get(name)
        check(f"تبويب {name} يعرض بياناته", bool(expect and expect in panel),
              f"{len(panel)} حرف")
    ap.screenshot(path=f"{SHOTS}/12-admin.png", full_page=True)
    admin.close()

    print("\n══════ 11. عرض الجوال ══════")
    mob = ctx.browser.new_context(viewport={"width": 390, "height": 844},
                                  is_mobile=True, has_touch=True, locale="ar-SA")
    mp = mob.new_page()
    mp.goto(f"{BASE}/invite/{slug}", wait_until="domcontentloaded")
    mp.wait_for_timeout(2000)
    overflow = mp.evaluate("document.documentElement.scrollWidth > window.innerWidth + 2")
    check("لا يوجد تجاوز أفقي على الجوال", not overflow)
    mp.screenshot(path=f"{SHOTS}/13-mobile-invite.png", full_page=True)
    mob.close()

    browser.close()

print("\n══════ أخطاء الطرفية ══════")
real = [e for e in errors if "favicon" not in e.lower()
        and "403" not in e]  # 403 = خطوط Google محجوبة في بيئة الفحص فقط
if real:
    for e in real[:10]:
        print(f"  ⚠️ {e[:140]}")
else:
    print("  ✅ لا أخطاء JavaScript في أي صفحة")

ok = sum(1 for _, o, _ in results if o)
bad = [n for n, o, _ in results if not o]
print("\n" + "═" * 54)
print(f"  نجح {ok} من {len(results)} | أخطاء الطرفية: {len(real)}")
if bad:
    print("  الفاشل: " + " / ".join(bad))
print("═" * 54)
sys.exit(1 if bad or real else 0)
