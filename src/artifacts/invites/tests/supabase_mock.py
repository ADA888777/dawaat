#!/usr/bin/env python3
"""
خادم يحاكي واجهات Supabase (Auth + PostgREST + Storage) فوق Postgres محلي.

الغرض: تشغيل الواجهة الأمامية الحقيقية بلا أي تعديل عليها، ومقابل قاعدة
بيانات حقيقية تُطبَّق فيها سياسات RLS فعلياً — فيكون الفحص فحصاً حقيقياً
لا محاكاة سطحية.

للاختبار المحلي فقط. لا يُستخدم في أي بيئة إنتاج.
"""
import json, re, base64, hmac, hashlib, urllib.parse, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import psycopg2, psycopg2.extras

DSN = "host=/tmp port=5433 user=postgres dbname=postgres"
SECRET = b"local-test-secret"
ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.anon.local"
# مفتاح الإدارة: يتجاوز RLS تماماً كما في Supabase الحقيقي
SERVICE_KEY = "eyJhbGciOiJIUzI1NiJ9.service.local"

def b64(d): return base64.urlsafe_b64encode(d).rstrip(b"=").decode()

def make_token(uid):
    head = b64(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    body = b64(json.dumps({"sub": uid, "role": "authenticated", "exp": 9999999999}).encode())
    sig = b64(hmac.new(SECRET, f"{head}.{body}".encode(), hashlib.sha256).digest())
    return f"{head}.{body}.{sig}"

def read_token(auth_header):
    """يستخرج معرّف المستخدم من التوكن، أو None للزائر."""
    if not auth_header or not auth_header.startswith("Bearer "):
        return None
    tok = auth_header[7:]
    if tok == ANON_KEY or tok.count(".") != 2:
        return None
    try:
        _, body, _ = tok.split(".")
        body += "=" * (-len(body) % 4)
        return json.loads(base64.urlsafe_b64decode(body)).get("sub")
    except Exception:
        return None

# ترجمة معاملات PostgREST إلى SQL
OPS = {"eq": "=", "neq": "<>", "gt": ">", "gte": ">=", "lt": "<", "lte": "<="}

def build_filters(qs, params):
    """يحوّل ?col=eq.value إلى شرط WHERE مع تمرير القيم كمعاملات."""
    where = []
    for key, vals in qs.items():
        if key in ("select", "order", "limit", "offset", "on_conflict", "columns"):
            continue
        for v in vals:
            m = re.match(r"^(\w+)\.(.*)$", v, re.S)
            if not m:
                continue
            op, val = m.group(1), m.group(2)
            if op in OPS:
                where.append(f'"{key}" {OPS[op]} %s')
                params.append(None if val == "null" else val)
            elif op == "is":
                where.append(f'"{key}" IS ' + ("NULL" if val == "null" else "NOT NULL"))
            elif op == "in":
                items = val.strip("()").split(",")
                where.append(f'"{key}" = ANY(%s)')
                params.append(items)
    return where

def build_select(qs):
    """يبسّط select: الأعمدة المباشرة فقط، والعلاقات المضمّنة تُستبدل بـ *."""
    sel = qs.get("select", ["*"])[0]
    if "(" in sel or sel == "*":
        return "*"
    return ", ".join(f'"{c.strip()}"' for c in sel.split(",") if c.strip())

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a): pass  # لا نلوّث المخرجات

    def _send(self, code, payload=None, extra=None):
        body = b"" if payload is None else json.dumps(payload, default=str).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS")
        self.send_header("Access-Control-Expose-Headers", "content-range")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if body:
            self.wfile.write(body)

    def do_OPTIONS(self): self._send(200, {})

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if not n: return None
        try: return json.loads(self.rfile.read(n))
        except Exception: return None

    def _conn(self):
        """اتصال يضبط دور الجلسة ومعرّف المستخدم — هنا تُفعَّل RLS فعلاً."""
        auth = self.headers.get("Authorization") or ""
        c = psycopg2.connect(DSN)
        cur = c.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        # service_role يتجاوز RLS بالكامل (كما في Supabase)
        if auth.endswith(SERVICE_KEY) or (self.headers.get("apikey") or "") == SERVICE_KEY:
            cur.execute("set role postgres")
            return c, cur, None
        uid = read_token(auth)
        if uid:
            cur.execute("set role authenticated")
            cur.execute("select set_config('request.jwt.claim.sub', %s, false)", (uid,))
        else:
            cur.execute("set role anon")
        return c, cur, uid

    # ---------------- المسارات ----------------
    def do_GET(self):
        path, _, q = self.path.partition("?")
        qs = urllib.parse.parse_qs(q, keep_blank_values=True)

        # واجهات التخزين (مبسّطة: تكفي لفحص السياسات والحدود)
        if path == "/storage/v1/bucket":
            c = psycopg2.connect(DSN)
            cur = c.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            cur.execute("select id, name, public, file_size_limit, allowed_mime_types from storage.buckets")
            rows = cur.fetchall(); c.close()
            return self._send(200, rows)

        if path.startswith("/storage/v1/object/public/"):
            rest = path[len("/storage/v1/object/public/"):]
            bucket, _, name = rest.partition("/")
            c = psycopg2.connect(DSN); cur = c.cursor()
            cur.execute("select 1 from storage.objects where bucket_id=%s and name=%s", (bucket, name))
            found = cur.fetchone(); c.close()
            if not found: return self._send(404, {"message": "not found"})
            self.send_response(200); self.send_header("Content-Type", "image/png")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Content-Length", "3"); self.end_headers()
            self.wfile.write(b"png"); return

        if path == "/auth/v1/health":
            return self._send(200, {"name": "GoTrue", "version": "local"})

        if path == "/auth/v1/user":
            uid = read_token(self.headers.get("Authorization"))
            if not uid: return self._send(401, {"message": "Unauthorized"})
            c, cur, _ = self._conn()
            cur.execute("set role postgres")
            cur.execute("select id, email from auth.users where id=%s", (uid,))
            u = cur.fetchone(); c.close()
            return self._send(200, {"id": str(u["id"]), "email": u["email"],
                                    "aud": "authenticated", "role": "authenticated",
                                    "app_metadata": {}, "user_metadata": {}})

        if path.startswith("/rest/v1/"):
            return self._rest_get(path[len("/rest/v1/"):], qs)

        return self._send(404, {"message": "not found"})

    def _rest_get(self, table, qs):
        c, cur, _ = self._conn()
        params = []
        where = build_filters(qs, params)
        sql = f'select {build_select(qs)} from public."{table}"'
        if where: sql += " where " + " and ".join(where)
        if "order" in qs:
            col, _, dirn = qs["order"][0].partition(".")
            sql += f' order by "{col}" ' + ("desc" if dirn.startswith("desc") else "asc")
        if "limit" in qs: sql += f' limit {int(qs["limit"][0])}'
        try:
            cur.execute(sql, params)
            rows = cur.fetchall()
        except Exception as e:
            c.rollback(); c.close()
            return self._send(400, {"message": str(e).strip()})

        # دعم count=exact و head=true المستخدمين في إحصائيات الإدارة
        prefer = self.headers.get("Prefer", "")
        extra = {}
        if "count=exact" in prefer:
            extra["content-range"] = f"0-{max(len(rows)-1,0)}/{len(rows)}"
        c.close()

        accept = self.headers.get("Accept", "")
        if "vnd.pgrst.object" in accept:
            if len(rows) != 1:
                return self._send(406, {"message": f"expected 1 row, got {len(rows)}"})
            return self._send(200, rows[0], extra)
        return self._send(200, rows, extra)

    def do_POST(self):
        path, _, q = self.path.partition("?")
        qs = urllib.parse.parse_qs(q, keep_blank_values=True)
        body = self._body()

        # تسجيل الدخول
        if path == "/auth/v1/token":
            email = (body or {}).get("email", "").strip().lower()
            pw = (body or {}).get("password", "")
            c = psycopg2.connect(DSN)
            cur = c.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            cur.execute("""select id, email, encrypted_password, email_confirmed_at
                             from auth.users where lower(email)=%s""", (email,))
            u = cur.fetchone(); c.close()
            if not u or not u["encrypted_password"]:
                return self._send(400, {"error": "invalid_grant",
                                        "error_description": "Invalid login credentials"})
            c = psycopg2.connect(DSN); cur = c.cursor()
            cur.execute("select %s = crypt(%s, %s)",
                        (u["encrypted_password"], pw, u["encrypted_password"]))
            ok = cur.fetchone()[0]; c.close()
            if not ok:
                return self._send(400, {"error": "invalid_grant",
                                        "error_description": "Invalid login credentials"})
            if not u["email_confirmed_at"]:
                return self._send(400, {"error": "invalid_grant",
                                        "error_description": "Email not confirmed"})
            uid = str(u["id"])
            return self._send(200, {
                "access_token": make_token(uid), "refresh_token": "r-" + uid,
                "token_type": "bearer", "expires_in": 3600,
                "expires_at": 9999999999,
                "user": {"id": uid, "email": u["email"], "aud": "authenticated",
                         "role": "authenticated", "app_metadata": {}, "user_metadata": {}}})

        # التسجيل: ينشئ المستخدم فيُطلق التريجر إنشاء صف profiles
        # Admin API: إنشاء مستخدم (يحاكي auth.admin.createUser)
        if path == "/auth/v1/admin/users":
            email = (body or {}).get("email", "").strip().lower()
            pw = (body or {}).get("password", "x")
            c = psycopg2.connect(DSN)
            cur = c.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            try:
                cur.execute("""insert into auth.users
                                 (email, encrypted_password, email_confirmed_at)
                               values (%s, crypt(%s, gen_salt('bf')), now())
                               returning id, email""", (email, pw))
                u = cur.fetchone(); c.commit()
            except Exception as e:
                c.rollback(); c.close()
                return self._send(400, {"msg": str(e).strip()})
            c.close()
            return self._send(200, {"id": str(u["id"]), "email": u["email"],
                                    "aud": "authenticated", "role": "authenticated",
                                    "app_metadata": {}, "user_metadata": {}})

        if path == "/auth/v1/signup":
            email = (body or {}).get("email", "").strip().lower()
            pw = (body or {}).get("password", "")
            meta = (body or {}).get("data") or (body or {}).get("options", {}).get("data") or {}
            c = psycopg2.connect(DSN)
            cur = c.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            cur.execute("select 1 from auth.users where lower(email)=%s", (email,))
            if cur.fetchone():
                c.close()
                return self._send(400, {"error": "user_already_exists",
                                        "msg": "User already registered"})
            try:
                cur.execute("""insert into auth.users
                                 (email, encrypted_password, email_confirmed_at, raw_user_meta_data)
                               values (%s, crypt(%s, gen_salt('bf')), now(), %s)
                               returning id, email""",
                            (email, pw, json.dumps(meta)))
                u = cur.fetchone(); c.commit()
            except Exception as e:
                c.rollback(); c.close()
                return self._send(400, {"msg": str(e).strip()})
            c.close()
            uid = str(u["id"])
            return self._send(200, {
                "access_token": make_token(uid), "refresh_token": "r-" + uid,
                "token_type": "bearer", "expires_in": 3600, "expires_at": 9999999999,
                "user": {"id": uid, "email": u["email"], "aud": "authenticated",
                         "role": "authenticated", "app_metadata": {}, "user_metadata": meta}})

        if path == "/auth/v1/logout":
            return self._send(204, None)

        if path == "/auth/v1/recover":
            return self._send(200, {})

        if path.startswith("/storage/v1/object/"):
            rest = path[len("/storage/v1/object/"):]
            bucket, _, name = rest.partition("/")
            c, cur, uid = self._conn()
            try:
                cur.execute("insert into storage.objects (bucket_id, name, owner) values (%s,%s,%s)",
                            (bucket, name, uid))
                c.commit()
            except Exception as e:
                c.rollback(); c.close()
                return self._send(403, {"message": str(e).strip()[:120],
                                        "statusCode": "403", "error": "Unauthorized"})
            c.close()
            return self._send(200, {"Key": f"{bucket}/{name}"})

        if path.startswith("/rest/v1/rpc/"):
            return self._rpc(path[len("/rest/v1/rpc/"):], body or {})

        if path.startswith("/rest/v1/"):
            return self._rest_insert(path[len("/rest/v1/"):], qs, body)

        return self._send(404, {"message": "not found"})

    def _rpc(self, fn, args):
        c, cur, _ = self._conn()
        names = list(args.keys())
        placeholders = ", ".join(f"{n} => %s" for n in names)
        try:
            cur.execute(f'select * from public."{fn}"({placeholders})',
                        [args[n] for n in names])
            rows = cur.fetchall(); c.commit()
        except Exception as e:
            c.rollback(); c.close()
            return self._send(400, {"message": str(e).strip()})
        c.close()
        if rows and len(rows[0]) == 1 and fn in ("submit_rsvp", "submit_rsvp_by_token",
                                                  "upgrade_my_subscription"):
            return self._send(200, None)
        return self._send(200, rows)

    def _rest_insert(self, table, qs, body):
        c, cur, _ = self._conn()
        rows = body if isinstance(body, list) else [body]
        rows = [r for r in rows if r]
        if not rows:
            c.close(); return self._send(201, [])
        cols = list(rows[0].keys())
        vals_sql = ", ".join(["(" + ", ".join(["%s"] * len(cols)) + ")"] * len(rows))
        params = [r.get(cl) for r in rows for cl in cols]
        sql = (f'insert into public."{table}" (' + ", ".join(f'"{cl}"' for cl in cols) +
               f") values {vals_sql}")
        prefer = self.headers.get("Prefer", "")
        if "resolution=ignore-duplicates" in prefer or "on_conflict" in qs:
            sql += " on conflict do nothing"
        if "return=representation" in prefer:
            sql += " returning *"
        try:
            cur.execute(sql, params)
            out = cur.fetchall() if "returning" in sql else []
            c.commit()
        except Exception as e:
            c.rollback(); c.close()
            msg = str(e).strip()
            code = "23505" if "duplicate key" in msg else None
            return self._send(400, {"message": msg, "code": code})
        c.close()
        accept = self.headers.get("Accept", "")
        if "vnd.pgrst.object" in accept:
            return self._send(201, out[0] if out else {})
        return self._send(201, out)

    def do_PATCH(self):
        path, _, q = self.path.partition("?")
        qs = urllib.parse.parse_qs(q, keep_blank_values=True)
        body = self._body() or {}
        table = path[len("/rest/v1/"):]
        c, cur, _ = self._conn()
        params = list(body.values())
        sets = ", ".join(f'"{k}" = %s' for k in body)
        where = build_filters(qs, params)
        sql = f'update public."{table}" set {sets}'
        if where: sql += " where " + " and ".join(where)
        if "return=representation" in self.headers.get("Prefer", ""):
            sql += " returning *"
        try:
            cur.execute(sql, params)
            out = cur.fetchall() if "returning" in sql else []
            c.commit()
        except Exception as e:
            c.rollback(); c.close(); return self._send(400, {"message": str(e).strip()})
        c.close()
        if "vnd.pgrst.object" in self.headers.get("Accept", ""):
            return self._send(200, out[0] if out else {})
        return self._send(200, out)

    def do_DELETE(self):
        path, _, q = self.path.partition("?")
        if path.startswith("/auth/v1/admin/users/"):
            uid = path.rsplit("/", 1)[-1]
            c = psycopg2.connect(DSN); cur = c.cursor()
            cur.execute("delete from auth.users where id = %s", (uid,))
            c.commit(); c.close()
            return self._send(200, {})
        qs = urllib.parse.parse_qs(q, keep_blank_values=True)
        table = path[len("/rest/v1/"):]
        c, cur, _ = self._conn()
        params = []
        where = build_filters(qs, params)
        sql = f'delete from public."{table}"'
        if where: sql += " where " + " and ".join(where)
        try:
            cur.execute(sql, params); c.commit()
        except Exception as e:
            c.rollback(); c.close(); return self._send(400, {"message": str(e).strip()})
        c.close()
        return self._send(204, None)

if __name__ == "__main__":
    srv = ThreadingHTTPServer(("127.0.0.1", 54321), Handler)
    print("خادم المحاكاة يعمل على http://127.0.0.1:54321")
    srv.serve_forever()
