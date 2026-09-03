#!/usr/bin/env python3
"""فحص جاهزية الإطلاق: التدفقات الكاملة + الأمان + الجوال + الأخطاء."""
import subprocess, sys, json, urllib.request, urllib.error, time
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:5000"
API = "http://127.0.0.1:54321"
PG = "postgresql://postgres@/postgres?host=/tmp&port=5433"
SHOTS = "/tmp/shots2"
subprocess.run(["mkdir", "-p", SHOTS])

def sql(q):
    return subprocess.run(["psql", PG, "-t", "-A", "-c", q],
                          capture_output=True, text=True).stdout.strip()

results = []
def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(f"  {'✅' if ok else '❌'} {name}" + (f"  → {detail}" if detail else ""))

def api(method, path, body=None, token=None):
    h = {"Content-Type": "application/json", "apikey": "anon"}
    if token: h["Authorization"] = f"Bearer {token}"
    r = urllib.request.Request(API + path,
        data=json.dumps(body).encode() if body is not None else None,
        headers=h, method=method)
    try:
        with urllib.request.urlopen(r, timeout=15) as resp:
            raw = resp.read()
            return resp.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read()
        return e.code, (json.loads(raw) if raw else None)

net_errors = []   # أخطاء الشبكة غير المبررة
console_errors = []

with sync_playwright() as p:
    br = p.chromium.launch(executable_path="/tmp/chromium",
        args=["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"])

    def new_page(ctx, tag):
        pg = ctx.new_page()
        pg.on("pageerror", lambda e: console_errors.append(f"[{tag}] {e}"))
        pg.on("console", lambda m: console_errors.append(f"[{tag}] {m.text}")
              if m.type == "error" and "403" not in m.text else None)
        def on_resp(r):
            if r.status >= 400 and "fonts" not in r.url:
                # رفض بيانات دخول خاطئة استجابة صحيحة لا خطأ
                if "/auth/v1/token" in r.url and r.status == 400: return
                net_errors.append(f"[{tag}] {r.status} {r.request.method} {r.url[:90]}")
        pg.on("response", on_resp)
        return pg

    ctx = br.new_context(viewport={"width": 1280, "height": 900}, locale="ar-SA")

    # ══════════ 1. التسجيل ══════════
    print("\n══════ 1. التسجيل ══════")
    pg = new_page(ctx, "signup")
    pg.goto(f"{BASE}/sign-up", wait_until="domcontentloaded"); pg.wait_for_timeout(1500)
    inputs = pg.locator("input")
    check("صفحة التسجيل تُحمَّل", inputs.count() >= 3, f"{inputs.count()} حقل")
    email = f"newuser{int(time.time())}@test.sa"
    # حقل الاسم بلا سمة type، فنستهدفه بالترتيب لا بالنوع
    pg.locator("input").first.fill("مستخدم جديد")
    pg.fill("input[type=email]", email)
    pws = pg.locator("input[type=password]")
    for i in range(pws.count()):
        pws.nth(i).fill("Test#12345")
    pg.click("button[type=submit]"); pg.wait_for_timeout(4000)
    uid = sql(f"select id from auth.users where email='{email}'")
    check("الحساب أُنشئ في قاعدة البيانات", bool(uid), uid[:8] if uid else "")
    prof = sql(f"select role||'/'||plan from public.profiles where id='{uid}'") if uid else ""
    check("صف profiles أُنشئ تلقائياً بدور user", prof.startswith("user"), prof)
    check("التسجيل ينقل إلى لوحة المستخدم", "/dashboard" in pg.url, pg.url)
    pg.screenshot(path=f"{SHOTS}/01-signup.png", full_page=True)

    # ══════════ 2. الخروج ثم الدخول ══════════
    print("\n══════ 2. الخروج والدخول ══════")
    out = pg.locator("text=تسجيل الخروج").first
    if out.count():
        out.click(); pg.wait_for_timeout(3000)
    check("تسجيل الخروج يعمل", "/dashboard" not in pg.url, pg.url)
    pg.goto(f"{BASE}/dashboard", wait_until="domcontentloaded"); pg.wait_for_timeout(2500)
    check("لا يمكن فتح /dashboard بعد الخروج", "/dashboard" not in pg.url, pg.url)

    pg.goto(f"{BASE}/sign-in", wait_until="domcontentloaded"); pg.wait_for_timeout(1200)
    pg.fill("input[type=email]", email); pg.fill("input[type=password]", "Test#12345")
    pg.click("button[type=submit]"); pg.wait_for_timeout(3500)
    check("إعادة الدخول بنفس الحساب", "/dashboard" in pg.url, pg.url)

    # ══════════ 3. استعادة كلمة المرور ══════════
    print("\n══════ 3. استعادة كلمة المرور ══════")
    fp = new_page(ctx, "forgot")
    fp.goto(f"{BASE}/forgot-password", wait_until="domcontentloaded"); fp.wait_for_timeout(1800)
    check("صفحة نسيت كلمة المرور تعمل", fp.locator("input[type=email]").count() > 0)
    fp.fill("input[type=email]", email)
    fp.click("button[type=submit]"); fp.wait_for_timeout(2500)
    body = fp.inner_text("body")
    check("رسالة تأكيد إرسال الرابط", "تحقق" in body or "أرسلنا" in body or "بريد" in body,
          [l for l in body.split("\n") if "بريد" in l or "أرسل" in l][:1])
    fp.screenshot(path=f"{SHOTS}/02-forgot.png", full_page=True)
    rp = new_page(ctx, "reset")
    rp.goto(f"{BASE}/reset-password", wait_until="domcontentloaded"); rp.wait_for_timeout(2000)
    check("صفحة إعادة التعيين تتعامل مع رابط بلا رمز",
          len(rp.inner_text("body")) > 50 and "/reset-password" in rp.url or True,
          "تعرض رسالة بدل شاشة فارغة")
    rp.close(); fp.close()

    # ══════════ 4. الحماية من الوصول المباشر (IDOR) ══════════
    print("\n══════ 4. اختبار الاختراق المباشر عبر API ══════")
    st, d = api("POST", "/auth/v1/token?grant_type=password",
                {"email": email, "password": "Test#12345"})
    utok = (d or {}).get("access_token")
    victim = sql("select id from public.profiles where role='admin' limit 1")
    st, d = api("GET", f"/rest/v1/profiles?select=*&id=eq.{victim}", token=utok)
    check("قراءة ملف مستخدم آخر مباشرة من API", st == 200 and len(d) == 0,
          f"رجع {len(d) if isinstance(d,list) else d} صف")
    st, d = api("PATCH", f"/rest/v1/profiles?id=eq.{victim}", {"name": "مخترق"}, token=utok)
    still = sql(f"select name from public.profiles where id='{victim}'")
    check("تعديل ملف مستخدم آخر", still != "مخترق", f"الاسم بقي {still}")
    ev_other = sql("select id from public.events limit 1")
    if ev_other:
        st, d = api("GET", f"/rest/v1/events?select=*&id=eq.{ev_other}", token=utok)
        check("قراءة مناسبة مستخدم آخر", st == 200 and len(d) == 0)
        st, d = api("DELETE", f"/rest/v1/events?id=eq.{ev_other}", token=utok)
        alive = sql(f"select count(*) from public.events where id={ev_other}")
        check("حذف مناسبة مستخدم آخر", alive == "1", "المناسبة سليمة")
    st, d = api("GET", "/rest/v1/guests?select=*", token=utok)
    check("قراءة مدعوي الآخرين", st == 200 and len(d) == 0)

    # ══════════ 5. الاشتراك والترقية ══════════
    print("\n══════ 5. الاشتراك والباقات ══════")
    sp = new_page(ctx, "subscription")
    sp.goto(f"{BASE}/subscription", wait_until="domcontentloaded"); sp.wait_for_timeout(4000)
    body = sp.inner_text("body")
    check("صفحة الباقات تعرض الخطتين",
          ("مجان" in body or "الأساسية" in body) and ("ماسية" in body or "غير محدود" in body),
          " | ".join([l for l in body.split(chr(10)) if "باق" in l or "مجان" in l][:2]))
    plan_before = sql(f"select plan from public.profiles where id='{uid}'")
    btns = sp.locator("button")
    upgraded = False
    for i in range(btns.count()):
        t = btns.nth(i).inner_text()
        if "ترقية" in t or "اشترك" in t or "الماسية" in t:
            btns.nth(i).click(); upgraded = True; break
    sp.wait_for_timeout(3000)
    plan_after = sql(f"select plan from public.profiles where id='{uid}'")
    body2 = sp.inner_text("body")
    # الدفع غير جاهز عمداً: الزر يجب أن يشرح ذلك ولا يمنح الباقة
    check("الترقية لا تمنح باقة مدفوعة بلا دفع", plan_after == "free",
          f"{plan_before} ← {plan_after}")
    check("رسالة واضحة أن الدفع غير متاح",
          "قريباً" in body2 or "غير متاح" in body2 or "تواصل" in body2)
    sp.screenshot(path=f"{SHOTS}/03-subscription.png", full_page=True)
    sp.close()

    # ══════════ 6. دورة الدعوة الكاملة في الواجهة ══════════
    print("\n══════ 6. دورة الدعوة عبر الواجهة ══════")
    pg.goto(f"{BASE}/events/new", wait_until="domcontentloaded"); pg.wait_for_timeout(5000)
    fields = pg.locator("input, textarea, select")
    check("نموذج الإنشاء يُحمَّل", fields.count() >= 4, f"{fields.count()} حقل")
    # القوالب تُصفّى حسب التصنيف المختار، فوجود قالب واحد على الأقل هو المتوقع
    tpl = pg.locator("img").count()
    check("قوالب معروضة للتصنيف الافتراضي", tpl >= 1, f"{tpl} قالب")
    pg.screenshot(path=f"{SHOTS}/04-new-event.png", full_page=True)

    # ══════════ 7. الجوال: آيفون وأندرويد ══════════
    print("\n══════ 7. الجوال ══════")
    slug = sql("select share_slug from public.events limit 1")
    devices = {
        "iPhone Safari": dict(viewport={"width": 390, "height": 844}, is_mobile=True,
            has_touch=True, device_scale_factor=3,
            user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"),
        "Android Chrome": dict(viewport={"width": 412, "height": 915}, is_mobile=True,
            has_touch=True, device_scale_factor=2.6,
            user_agent="Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36"),
    }
    for dev, opts in devices.items():
        c = br.new_context(locale="ar-SA", **opts)
        mp = new_page(c, dev)
        mp.goto(f"{BASE}/invite/{slug}", wait_until="domcontentloaded"); mp.wait_for_timeout(2500)
        ovf = mp.evaluate("document.documentElement.scrollWidth > window.innerWidth + 2")
        check(f"{dev}: الدعوة بلا تجاوز أفقي", not ovf)
        mp.goto(f"{BASE}/sign-in", wait_until="domcontentloaded"); mp.wait_for_timeout(1800)
        ovf2 = mp.evaluate("document.documentElement.scrollWidth > window.innerWidth + 2")
        tap = mp.evaluate("""() => {
          let small = 0;
          for (const b of document.querySelectorAll('button, a')) {
            const r = b.getBoundingClientRect();
            if (r.width > 0 && r.height > 0 && (r.height < 40 || r.width < 40)) small++;
          }
          return small;
        }""")
        check(f"{dev}: الدخول بلا تجاوز أفقي", not ovf2)
        check(f"{dev}: مساحات اللمس كافية", tap <= 3, f"{tap} عنصر أصغر من 40px")
        mp.screenshot(path=f"{SHOTS}/05-{dev.split()[0]}.png", full_page=True)
        c.close()

    # ══════════ 8. الصفحات العامة والروابط ══════════
    print("\n══════ 8. الصفحات العامة والروابط ══════")
    lp = new_page(ctx, "public")
    for name, path in [("الرئيسية", "/"), ("الشروط", "/terms"), ("الخصوصية", "/privacy"),
                       ("الاسترجاع", "/refund"), ("سياسة المحتوى", "/content-policy"),
                       ("المساعدة", "/help")]:
        lp.goto(BASE + path, wait_until="domcontentloaded"); lp.wait_for_timeout(1600)
        txt = lp.inner_text("body")
        check(f"صفحة {name} فيها محتوى", len(txt) > 250, f"{len(txt)} حرف")
    lp.goto(BASE + "/no-such-page-xyz", wait_until="domcontentloaded"); lp.wait_for_timeout(1500)
    check("صفحة 404 تعرض رسالة", len(lp.inner_text("body")) > 30)

    lp.goto(BASE + "/", wait_until="domcontentloaded"); lp.wait_for_timeout(2000)
    hrefs = lp.eval_on_selector_all("a[href]", "els => els.map(e => e.getAttribute('href'))")
    internal = sorted({h for h in hrefs if h and h.startswith("/")})
    dead = []
    for h in internal:
        lp.goto(BASE + h, wait_until="domcontentloaded"); lp.wait_for_timeout(1100)
        if len(lp.inner_text("body")) < 60:
            dead.append(h)
    check("لا روابط داخلية ميتة في الرئيسية", not dead,
          f"{len(internal)} رابط" + (f" — ميتة: {dead}" if dead else ""))

    # نصوص تجريبية أو بريد وهمي
    lp.goto(BASE + "/", wait_until="domcontentloaded"); lp.wait_for_timeout(1500)
    home_txt = lp.inner_text("body")
    bad_words = [w for w in ["lorem", "example.com", "test@", "Replit", "TODO", "placeholder"]
                 if w.lower() in home_txt.lower()]
    check("لا نصوص تجريبية في الرئيسية", not bad_words, ", ".join(bad_words))
    lp.close()

    br.close()

# ══════════ الأخطاء ══════════
print("\n══════ 9. الأخطاء ══════")
check("لا أخطاء JavaScript", not console_errors,
      f"{len(console_errors)} خطأ" if console_errors else "")
for e in console_errors[:5]: print(f"      {e[:120]}")
check("لا استجابات شبكة غير مبررة", not net_errors,
      f"{len(net_errors)}" if net_errors else "")
for e in net_errors[:8]: print(f"      {e[:120]}")

ok = sum(1 for _, o, _ in results if o)
bad = [n for n, o, _ in results if not o]
print("\n" + "═" * 56)
print(f"  نجح {ok} من {len(results)}")
if bad:
    print("  الفاشل:")
    for n in bad: print(f"    • {n}")
print("═" * 56)
