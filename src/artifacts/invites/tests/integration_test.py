#!/usr/bin/env python3
"""اختبار تكامل: كل مسار في التطبيق مقابل قاعدة بيانات حقيقية بسياسات RLS فعلية."""
import json, urllib.request, urllib.error, subprocess, sys

M = "http://127.0.0.1:54321"
PG = "postgresql://postgres@/postgres?host=/tmp&port=5433"
passed, failed = [], []

def sql(q):
    return subprocess.run(["psql", PG, "-t", "-A", "-c", q],
                          capture_output=True, text=True).stdout.strip()

def req(method, path, body=None, token=None, headers=None):
    h = {"Content-Type": "application/json", "apikey": "anon"}
    if token: h["Authorization"] = f"Bearer {token}"
    if headers: h.update(headers)
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(M + path, data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(r, timeout=15) as resp:
            raw = resp.read()
            return resp.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read()
        return e.code, (json.loads(raw) if raw else None)

def check(name, cond, detail=""):
    (passed if cond else failed).append(name)
    print(f"  {'✅' if cond else '❌'} {name}" + (f"  → {detail}" if detail else ""))

def login(email, pw):
    st, d = req("POST", "/auth/v1/token?grant_type=password",
                {"email": email, "password": pw})
    return (d or {}).get("access_token"), st, d

print("\n══════ 1. المصادقة ══════")
utok, st, _ = login("user@dawat.sa", "User#2026")
check("دخول المستخدم بكلمة صحيحة", st == 200 and utok)
atok, st, _ = login("admin@dawat.sa", "Admin#2026")
check("دخول الأدمن", st == 200 and atok)
st, d = login("user@dawat.sa", "WrongPass")[1:]
check("رفض كلمة المرور الخاطئة", st == 400 and "Invalid login credentials" in str(d),
      (d or {}).get("error_description", ""))
st, d = login("ghost@nowhere.sa", "x")[1:]
check("رفض بريد غير موجود", st == 400)

print("\n══════ 2. عزل البيانات (RLS) ══════")
st, evs = req("GET", "/rest/v1/events_with_counts?select=*", token=utok)
check("المستخدم يرى مناسبته", st == 200 and len(evs) == 1,
      f"{evs[0]['title']} — {evs[0]['guests_count']} مدعوين" if evs else "")
st, prof = req("GET", "/rest/v1/profiles?select=*", token=utok)
check("المستخدم يرى ملفه فقط", st == 200 and len(prof) == 1)
st, prof = req("GET", "/rest/v1/profiles?select=*", token=atok)
check("الأدمن يرى كل المستخدمين", st == 200 and len(prof) == 2, f"{len(prof)} مستخدم")
st, anon_ev = req("GET", "/rest/v1/events?select=*")
check("الزائر محجوب عن المناسبات", st == 200 and len(anon_ev) == 0)
st, anon_g = req("GET", "/rest/v1/guests?select=*")
check("الزائر محجوب عن المدعوين", st == 200 and len(anon_g) == 0)

print("\n══════ 3. منع رفع الصلاحية ══════")
uid = sql("select id from public.profiles where role='user'")
st, d = req("PATCH", f"/rest/v1/profiles?id=eq.{uid}", {"role": "admin"}, token=utok)
still = sql(f"select role from public.profiles where id='{uid}'")
check("المستخدم لا يستطيع ترقية نفسه", still == "user", f"الدور بقي {still}")
st, d = req("PATCH", f"/rest/v1/profiles?id=eq.{uid}", {"plan": "paid"}, token=utok)
plan = sql(f"select plan from public.profiles where id='{uid}'")
check("المستخدم لا يمنح نفسه باقة مدفوعة", plan == "free", f"الباقة بقيت {plan}")

print("\n══════ 4. صفحة الدعوة العامة ══════")
slug = sql("select share_slug from public.events limit 1")
check("طول share_slug صحيح (18 خانة)", len(slug) == 18, slug)
st, inv = req("POST", "/rest/v1/rpc/get_public_invitation", {"p_slug": slug})
check("الزائر يفتح الدعوة بلا تسجيل", st == 200 and inv,
      f"{inv[0]['title']} — {inv[0]['location']}" if inv else "")
check("الدعوة لا تكشف بيانات المالك", inv and "user_id" not in inv[0])
st, bad = req("POST", "/rest/v1/rpc/get_public_invitation", {"p_slug": "zzzzzzzzzzzzzzzzzz"})
check("رابط خاطئ لا يرجع شيئاً", st == 200 and not bad)

print("\n══════ 5. الرد بالرمز الشخصي ══════")
tok_g = sql("select invite_token from public.guests order by id limit 1")
st, g = req("POST", "/rest/v1/rpc/get_guest_by_token", {"p_token": tok_g})
check("قراءة اسم المدعو من الرمز", st == 200 and g, g[0]["name"] if g else "")
check("الرمز لا يكشف رقم الجوال", g and "phone" not in g[0])
st, _ = req("POST", "/rest/v1/rpc/submit_rsvp_by_token",
            {"p_token": tok_g, "p_status": "attending"})
now = sql(f"select attendance_status from public.guests where invite_token='{tok_g}'")
check("تسجيل الرد بالرمز", now == "attending", f"الحالة {now}")
st, d = req("POST", "/rest/v1/rpc/submit_rsvp_by_token",
            {"p_token": "00000000-0000-0000-0000-000000000000", "p_status": "attending"})
check("رفض رمز غير صالح", st == 400)

print("\n══════ 6. تحصين الرد العام ══════")
st, d = req("POST", "/rest/v1/rpc/submit_rsvp",
            {"p_slug": slug, "p_name": "محمد", "p_phone": "0512345678", "p_status": "attending"})
check("رد صحيح يُقبل", st == 200)
st, d = req("POST", "/rest/v1/rpc/submit_rsvp",
            {"p_slug": slug, "p_name": "س", "p_phone": "ليس-رقم", "p_status": "attending"})
check("رفض جوال غير صالح", st == 400, (d or {}).get("message", "")[:40])
st, d = req("POST", "/rest/v1/rpc/submit_rsvp",
            {"p_slug": slug, "p_name": "ا" * 200, "p_phone": "0512345679", "p_status": "attending"})
check("رفض اسم مفرط الطول", st == 400)
before = sql(f"select count(*) from public.guests")
req("POST", "/rest/v1/rpc/submit_rsvp",
    {"p_slug": slug, "p_name": "محمد", "p_phone": "0512345678", "p_status": "declined"})
after = sql("select count(*) from public.guests")
final = sql("select attendance_status from public.guests where phone='0512345678'")
check("الرد المكرر يحدّث ولا يكرّر", before == after and final == "declined",
      f"{before}→{after} صف، الحالة {final}")

print("\n══════ 7. دورة حياة المناسبة والمدعوين ══════")
st, ev = req("POST", "/rest/v1/events",
             {"user_id": uid, "title": "حفل تخرج", "category": "graduation",
              "event_date": "2026-12-01T18:00:00Z", "location": "الرياض", "description": ""},
             token=utok, headers={"Prefer": "return=representation"})
check("إنشاء مناسبة", st == 201 and ev, ev[0]["title"] if ev else "")
new_id = ev[0]["id"] if ev else None
check("slug يُولَّد تلقائياً في قاعدة البيانات", ev and len(ev[0]["share_slug"]) == 18)
st, _ = req("POST", "/rest/v1/guests",
            {"event_id": new_id, "name": "عبدالله", "phone": "0533333333"}, token=utok)
check("إضافة مدعو", st == 201)
st, d = req("POST", "/rest/v1/guests",
            {"event_id": new_id, "name": "مكرر", "phone": "0533333333"}, token=utok)
check("رفض تكرار الجوال في نفس المناسبة", st == 400 and (d or {}).get("code") == "23505")
st, _ = req("PATCH", f"/rest/v1/events?id=eq.{new_id}", {"title": "حفل تخرج 2026"}, token=utok)
check("تعديل المناسبة", sql(f"select title from public.events where id={new_id}") == "حفل تخرج 2026")

print("\n══════ 8. حد الباقة المجانية ══════")
for i in range(2):
    req("POST", "/rest/v1/events",
        {"user_id": uid, "title": f"مناسبة {i}", "category": "general",
         "event_date": "2026-12-01T18:00:00Z", "location": "جدة", "description": ""}, token=utok)
cnt = int(sql(f"select count(*) from public.events where user_id='{uid}'"))
st, d = req("POST", "/rest/v1/events",
            {"user_id": uid, "title": "زائدة", "category": "general",
             "event_date": "2026-12-01T18:00:00Z", "location": "جدة", "description": ""}, token=utok)
check("منع تجاوز حد الباقة", st == 400 and "EVENTS_LIMIT_REACHED" in str(d),
      f"توقف عند {cnt} مناسبات")
check("رمز الخطأ يحمل الحد الفعلي", "EVENTS_LIMIT_REACHED:3" in str(d))

print("\n══════ 9. حذف متتالٍ ══════")
gcount = sql(f"select count(*) from public.guests where event_id={new_id}")
req("DELETE", f"/rest/v1/events?id=eq.{new_id}", token=utok)
left = sql(f"select count(*) from public.guests where event_id={new_id}")
check("حذف المناسبة يحذف مدعويها", left == "0", f"{gcount} مدعو حُذفوا معها")

print("\n" + "═" * 52)
print(f"  نجح {len(passed)} | فشل {len(failed)}")
if failed:
    print("  الفاشل: " + " / ".join(failed))
print("═" * 52)
sys.exit(1 if failed else 0)
