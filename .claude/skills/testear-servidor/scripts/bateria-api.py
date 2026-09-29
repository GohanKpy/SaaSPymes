#!/usr/bin/env python3
"""Bateria intensiva de la API del servidor de pruebas (via tunel publico).

Crea su propio negocio y usuarios de QA (no toca los datos de los negocios
reales de la copia) y recorre todos los modulos de la API de punta a punta.
"""
import base64
import datetime as dt
import http.cookiejar
import json
import os
import sys
import threading
import time
import urllib.error
import urllib.request
import uuid

# Destino y credenciales por variables de entorno (ver SKILL.md); nada fijo.
API = os.environ.get("QA_API", "https://api.inicia.com.py/api/v1").rstrip("/")
WEB = os.environ.get("QA_WEB", "https://client.inicia.com.py").rstrip("/")
PADMIN_EMAIL = os.environ["QA_PADMIN_EMAIL"]
PADMIN_PASS = os.environ["QA_PADMIN_PASS"]
TS = time.strftime("%m%d%H%M")
# Resultados FUERA del repo: llevan la clave del dueno QA creado en la corrida.
SP = os.environ.get("QA_SALIDA") or os.path.expanduser("~/.cache/pymes-qa")
os.makedirs(SP, exist_ok=True)
# Id de un cliente de OTRO negocio para la prueba de aislamiento (404 opaco);
# sin QA_AJENO se usa un id inexistente, que solo prueba el 404.
AJENO = os.environ.get("QA_AJENO") or str(uuid.uuid4())
PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
TZ = dt.timezone(dt.timedelta(hours=-3))  # America/Asuncion (UTC-3 fijo)
# Cloudflare (Browser Integrity Check) bloquea "Python-urllib" con el error 1010:
# la bateria se identifica como navegador, dejando claro que es QA.
UA = "Mozilla/5.0 (compatible; QA-Bateria-PyMEs/1.0)"

RES = []
MOD = "?"
CTX = {}


def modulo(m):
    global MOD
    MOD = m
    print(f"\n=== {m} ===", flush=True)


def rec(nombre, ok, detalle=""):
    RES.append({"modulo": MOD, "prueba": nombre, "ok": bool(ok), "detalle": str(detalle)[:600]})
    print(("  OK    " if ok else "  FALLA ") + nombre + ("" if ok else f"  -> {str(detalle)[:400]}"), flush=True)
    return ok


class Cli:
    def __init__(self):
        self.cj = http.cookiejar.CookieJar()
        self.op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.cj))
        self.tok = None

    def call(self, method, path, body=None, raw=False, timeout=90, auth=True):
        url = path if path.startswith("http") else API + path
        data = json.dumps(body).encode() if body is not None else None
        h = {"accept": "application/json", "user-agent": UA, "x-requested-with": "panel"}
        if data is not None:
            h["content-type"] = "application/json"
        if auth and self.tok:
            h["authorization"] = "Bearer " + self.tok
        req = urllib.request.Request(url, data=data, method=method, headers=h)
        try:
            with self.op.open(req, timeout=timeout) as r:
                b = r.read()
                ct = r.headers.get("content-type", "")
                if raw:
                    return r.status, b, ct
                return r.status, (json.loads(b) if b and "json" in ct else b.decode(errors="replace")), ct
        except urllib.error.HTTPError as e:
            b = e.read()
            ct = e.headers.get("content-type", "")
            try:
                j = json.loads(b)
            except Exception:
                j = b.decode(errors="replace")[:300]
            return e.code, j, ct
        except Exception as e:  # red / timeout
            return 0, f"{type(e).__name__}: {e}", ""


def es_cloudflare(b):
    return isinstance(b, dict) and ("cloudflare" in str(b.get("type", "")) or "error_code" in b)


def chk(nombre, r, esperado=(200, 201, 204), cond=None):
    st, b, _ = r
    if es_cloudflare(b):  # un bloqueo del borde NUNCA cuenta como respuesta de la app
        rec(nombre, False, f"BLOQUEO CLOUDFLARE HTTP {st}: {b.get('title')}")
        return None
    ok = st in esperado
    if ok and cond:
        try:
            ok = bool(cond(b))
        except Exception as e:
            ok = False
            b = f"condicion fallo ({e}): {b}"
    rec(nombre, ok, "" if ok else f"HTTP {st}: {b}")
    return b if ok else None


def login(cli, email, pwd, scope):
    st, b, _ = cli.call("POST", "/auth/login", {"email": email, "password": pwd, "scope": scope}, auth=False)
    if st == 200 and isinstance(b, dict) and b.get("access_token"):
        cli.tok = b["access_token"]
        return b
    return None


def siguiente_dia_habil(dias=2):
    d = dt.datetime.now(TZ).date() + dt.timedelta(days=dias)
    while d.weekday() >= 5:  # sabado/domingo
        d += dt.timedelta(days=1)
    return d


def uid(b):
    return b.get("id") if isinstance(b, dict) else None


# ============================================================ PLATAFORMA
modulo("Portal admin: acceso y catalogo de planes")
P = Cli()
rec("login admin de plataforma (QA)", login(P, PADMIN_EMAIL, PADMIN_PASS, "platform"))
chk("GET /platform/me", P.call("GET", "/platform/me"), cond=lambda b: b["email"] == PADMIN_EMAIL)
feats = chk("GET /platform/features", P.call("GET", "/platform/features"), cond=lambda b: len(b) > 0) or []
codes = [f["code"] for f in feats]
chk("GET /platform/plans", P.call("GET", "/platform/plans"), cond=lambda b: len(b) >= 3)
plan = chk("POST /platform/plans (plan QA con todas las funciones)", P.call("POST", "/platform/plans", {
    "code": f"qa-srv-{TS}", "name": "QA servidor", "monthly_price": "0", "max_users": 10, "max_branches": 3,
    "feature_codes": codes}))
def funciones_plan(code):
    st, b, _ = P.call("GET", "/platform/plans")
    p = next((x for x in b if x["code"] == code), None) if st == 200 else None
    return len(p["planFeatures"]) if p else -1


if plan:
    rec("el plan nace con todas sus funciones", funciones_plan(f"qa-srv-{TS}") == len(codes), funciones_plan(f"qa-srv-{TS}"))
    chk("PATCH /platform/plans/:id (solo el nombre)", P.call("PATCH", f"/platform/plans/{uid(plan)}", {"name": "QA servidor (pruebas)"}))
    n = funciones_plan(f"qa-srv-{TS}")
    rec("BUG-EDICION-PARCIAL: renombrar el plan conserva sus funciones", n == len(codes), f"quedaron {n} de {len(codes)} funciones")
    chk("PATCH plan restaurando funciones y limites", P.call("PATCH", f"/platform/plans/{uid(plan)}", {"feature_codes": codes, "max_users": 10, "max_branches": 3}))
    rec("plan restaurado con todas las funciones", funciones_plan(f"qa-srv-{TS}") == len(codes))

modulo("Portal admin: negocios (tenants)")
ten = chk("POST /platform/tenants (alta negocio QA)", P.call("POST", "/platform/tenants", {
    "legal_name": f"QA Servidor {TS} S.A.", "trade_name": f"QA Servidor {TS}", "plan_code": f"qa-srv-{TS}",
    "root_email": f"qa.srv{TS}@pymes.local", "root_full_name": "QA Servidor", "contact_email": "qa@pymes.local",
    "notes": "Negocio creado por la bateria de pruebas del servidor"}),
    cond=lambda b: b["temp_password"] and b["tenant"]["id"])
TID = ten["tenant"]["id"] if ten else None
ROOT_TEMP = ten["temp_password"] if ten else None
chk("GET /platform/tenants (lista incluye el nuevo)", P.call("GET", "/platform/tenants"), cond=lambda b: any(t["id"] == TID for t in b))
chk("GET /platform/tenants/:id (ficha)", P.call("GET", f"/platform/tenants/{TID}"), cond=lambda b: b["id"] == TID)
chk("PATCH /platform/tenants/:id (estado activo + notas)", P.call("PATCH", f"/platform/tenants/{TID}", {"status": "active", "notes": "bateria QA"}))
if codes:
    chk("PUT overrides (acuerdo a medida con motivo)", P.call("PUT", f"/platform/tenants/{TID}/overrides", {
        "feature_code": codes[0], "enabled": True, "extra_fee": "0", "note": "prueba de acuerdo QA"}))
    chk("DELETE overrides (volver a heredar del plan)", P.call("DELETE", f"/platform/tenants/{TID}/overrides/{codes[0]}"))
chk("PUT bot-budget del negocio", P.call("PUT", f"/platform/tenants/{TID}/bot-budget", {"monthly_token_budget": 200000}))

modulo("Portal admin: configuracion del sistema")
bot_eng = chk("GET settings/bot (motor IA)", P.call("GET", "/platform/settings/bot"))
CTX["motor"] = bot_eng
chk("GET settings/google", P.call("GET", "/platform/settings/google"))
chk("GET settings/mail", P.call("GET", "/platform/settings/mail"))
chk("GET settings/ruc-padron", P.call("GET", "/platform/settings/ruc-padron"))
sec = chk("GET settings/security", P.call("GET", "/platform/settings/security"))
if sec:
    chk("PUT settings/security (mismos valores, ida y vuelta)", P.call("PUT", "/platform/settings/security", {
        k: sec[k] for k in ("login_max_attempts", "login_window_min", "login_block_min")}))
chk("POST settings/mail/test (correo de prueba -> Mailpit)", P.call("POST", "/platform/settings/mail/test", {}),
    cond=lambda b: b.get("ok"))
acts = chk("GET audit/actions", P.call("GET", "/platform/audit/actions?limit=5"))
lista = acts.get("data", acts) if isinstance(acts, dict) else acts
if lista:
    chk("GET audit/actions/:id", P.call("GET", f"/platform/audit/actions/{lista[0]['id']}"))
chk("GET audit/changes del negocio QA", P.call("GET", f"/platform/audit/changes?tenant_id={TID}&limit=5"))
r = P.call("POST", "/platform/assistant", {"messages": [{"role": "user", "content": "Hola, en una frase: que podes hacer?"}]}, timeout=120)
CTX["asistente"] = r
chk("POST /platform/assistant (asistente IA del admin)", r)

modulo("Portal admin: usuarios del portal y permisos")
chk("GET /platform/users", P.call("GET", "/platform/users"))
ag = chk("POST /platform/users (agente QA)", P.call("POST", "/platform/users", {
    "email": f"qa.agente{TS}@pymes.local", "full_name": "QA Agente", "role": "agent"}), cond=lambda b: b["temp_password"])
if ag:
    AGID = ag["user"]["id"]
    rp = chk("POST /platform/users/:id/reset-password", P.call("POST", f"/platform/users/{AGID}/reset-password", {}),
             cond=lambda b: b["temp_password"])
    A = Cli()
    rec("login del agente con la clave reiniciada", rp and login(A, f"qa.agente{TS}@pymes.local", rp["temp_password"], "platform"))
    chk("agente NO puede cambiar la seguridad del sistema (403)", A.call("PUT", "/platform/settings/security", {
        "login_max_attempts": 10, "login_window_min": 10, "login_block_min": 10}), esperado=(403,))
    chk("agente cambia su propia contrasena", A.call("POST", "/platform/me/password", {
        "current_password": rp["temp_password"], "new_password": f"AgenteQa-{TS}-ok"}))
    chk("PATCH /platform/users/:id (desactivar agente)", P.call("PATCH", f"/platform/users/{AGID}", {"is_active": False}))
    A2 = Cli()
    rec("agente desactivado ya NO puede entrar", not login(A2, f"qa.agente{TS}@pymes.local", f"AgenteQa-{TS}-ok", "platform"))

# ============================================================ NEGOCIO
modulo("Negocio: acceso, cuenta y datos de la empresa")
T = Cli()
rec("login del dueno con la clave temporal", ROOT_TEMP and login(T, f"qa.srv{TS}@pymes.local", ROOT_TEMP, "tenant"))
ROOT_PASS = f"QaServidor-{TS}"
chk("POST /users/me/password (cambio de clave)", T.call("POST", "/users/me/password", {"current_password": ROOT_TEMP, "new_password": ROOT_PASS}))
T = Cli()
rec("login con la clave nueva", login(T, f"qa.srv{TS}@pymes.local", ROOT_PASS, "tenant"))
chk("GET /users/me", T.call("GET", "/users/me"))
chk("PATCH /users/me", T.call("PATCH", "/users/me", {"full_name": "QA Servidor (dueno)"}))
tn = chk("GET /tenant", T.call("GET", "/tenant"), cond=lambda b: b["id"] == TID)
chk("GET /tenant/features (todas activas)", T.call("GET", "/tenant/features"), cond=lambda b: all(f["enabled"] for f in b))
st_ = chk("GET /tenant/settings", T.call("GET", "/tenant/settings"))
if isinstance(st_, dict):
    campos = ("monthly_close_day", "monthly_auto_invoice", "recurring_lead_days", "allow_negative_stock", "low_stock_alerts")
    chk("PUT /tenant/settings (ida y vuelta)", T.call("PUT", "/tenant/settings", {k: st_[k] for k in campos if k in st_}))
if tn:
    br = dict(tn.get("branding") or {})
    br.update({"logo": PNG, "actividad": "Servicios de prueba"})
    chk("PATCH /tenant (logo y actividad)", T.call("PATCH", "/tenant", {"branding": br}))
chk("GET /dashboard", T.call("GET", "/dashboard"), cond=lambda b: "today" in b)
chk("sin sesion -> 401", Cli().call("GET", "/customers"), esperado=(401,))
chk("dueno de negocio NO entra a la plataforma (403)", T.call("GET", "/platform/tenants"), esperado=(401, 403))

modulo("Negocio: sucursales y horarios")
brs = chk("GET /branches", T.call("GET", "/branches"), cond=lambda b: len(b) >= 1) or [{}]
MAIN = brs[0].get("id")
semana = {str(d): [{"from": "08:00", "to": "18:00"}] for d in range(1, 7)}
chk("PUT horario de atencion (lun-sab 08-18)", T.call("PUT", f"/branches/{MAIN}/schedule", {"week": semana, "closed_dates": [], "on_conflict": "abort"}))
chk("GET horario de atencion", T.call("GET", f"/branches/{MAIN}/schedule"), cond=lambda b: b["week"]["1"])
b2 = chk("POST /branches (segunda sucursal)", T.call("POST", "/branches", {"name": "Sucursal QA 2", "address": "Calle QA 123"}))
B2 = uid(b2)
if B2:
    chk("PATCH /branches/:id", T.call("PATCH", f"/branches/{B2}", {"phone": "0981000000"}))

modulo("Negocio: equipo (usuarios) y roles")
chk("GET /users", T.call("GET", "/users"))
su = chk("POST /users (staff)", T.call("POST", "/users", {"email": f"qa.staff{TS}@pymes.local", "full_name": "QA Staff", "role": "staff"}),
         cond=lambda b: b["temp_password"])
if su:
    SUID = su["id"]
    chk("PATCH /users/:id", T.call("PATCH", f"/users/{SUID}", {"full_name": "QA Staff 2"}))
    rp = chk("POST /users/:id/reset-password", T.call("POST", f"/users/{SUID}/reset-password", {}), cond=lambda b: b["temp_password"])
    S = Cli()
    rec("login del staff", rp and login(S, f"qa.staff{TS}@pymes.local", rp["temp_password"], "tenant"))
    chk("staff NO ve integraciones (solo dueno, 403)", S.call("GET", "/integrations"), esperado=(403,))
    chk("staff SI ve clientes", S.call("GET", "/customers"))
    chk("DELETE /users/:id", T.call("DELETE", f"/users/{SUID}"))

modulo("Negocio: integraciones")
chk("PUT /integrations/sifen (timbrado)", T.call("PUT", "/integrations/sifen", {
    "timbrado": "12345678", "establishment": "001", "expedition_point": "001", "vigencia_desde": "2026-01-01"}))
WA = f"dev-qa-srv-{TS}"
chk("PUT /integrations/whatsapp (identificador de prueba)", T.call("PUT", "/integrations/whatsapp", {"phone_number_id": WA, "access_token": "dev-token-qa", "verify_token": "dev-verify-qa", "live": False}))
chk("GET /integrations", T.call("GET", "/integrations"), cond=lambda b: any(i["type"] == "whatsapp" and i["configured"] for i in b))
chk("POST google/connect (genera link de Google)", T.call("POST", "/integrations/google/connect", {}), esperado=(200, 201, 422),
    cond=lambda b: isinstance(b, dict))

modulo("Negocio: campos propios y planilla de empleados")
cf = chk("POST /custom-fields (lista)", T.call("POST", "/custom-fields", {"code": "talle", "label": "Talle", "field_type": "list", "options": ["S", "M", "L"]}))
if cf:
    chk("PATCH /custom-fields/:id", T.call("PATCH", f"/custom-fields/{uid(cf)}", {"label": "Talle QA"}))
chk("GET /custom-fields", T.call("GET", "/custom-fields?entity=customer"), cond=lambda b: any(c["code"] == "talle" for c in b))
chk("PUT form-settings (telefono obligatorio)", T.call("PUT", "/employees/form-settings", {"required_fields": ["phone"]}))
chk("alta de empleado SIN telefono rechazada (422)", T.call("POST", "/employees", {"first_name": "Sin", "last_name": "Telefono"}), esperado=(422,))
e1 = chk("POST /employees (Ana)", T.call("POST", "/employees", {"first_name": "Ana", "last_name": "QA", "phone": "0981000001",
         "marital_status": "soltero", "children_count": 0, "emergency_contact_name": "Mama QA", "emergency_contact_phone": "0981000009",
         "emergency_contact_relation": "madre", "bookable": True}))
e2 = chk("POST /employees (Beto)", T.call("POST", "/employees", {"first_name": "Beto", "last_name": "QA", "phone": "0981000002", "bookable": True}))
E1, E2 = uid(e1), uid(e2)
chk("PATCH /employees/:id", T.call("PATCH", f"/employees/{E1}", {"position": "Estilista"}))
chk("GET /employees", T.call("GET", "/employees"), cond=lambda b: len(b) >= 2)
e3 = chk("POST empleado dado de baja y no agendable", T.call("POST", "/employees", {"first_name": "Baja", "last_name": "QA", "phone": "0981000003", "bookable": False, "is_active": False}))
if e3:
    chk("PATCH solo el horario (lo que manda la pantalla)", T.call("PATCH", f"/employees/{uid(e3)}", {"schedule": {"week": {"1": [{"from": "09:00", "to": "12:00"}]}, "closed_dates": []}}))
    st, lst, _ = T.call("GET", "/employees")
    x = next((z for z in lst if z["id"] == uid(e3)), {}) if st == 200 else {}
    rec("BUG-EDICION-PARCIAL: guardar el horario NO reactiva a un empleado dado de baja", x.get("isActive") is False and x.get("bookable") is False,
        f"quedo activo={x.get('isActive')}, agendable={x.get('bookable')}")
chk("PUT form-settings (volver a ninguno)", T.call("PUT", "/employees/form-settings", {"required_fields": []}))

modulo("Negocio: catalogo")
c1 = chk("POST categoria de servicios", T.call("POST", "/catalog/categories", {"name": "Servicios QA", "default_kind": "servicio"}))
c2 = chk("POST categoria de productos", T.call("POST", "/catalog/categories", {"name": "Productos QA", "default_kind": "item"}))
s1 = chk("POST servicio (Corte QA, 30 min)", T.call("POST", "/catalog/services", {"category_id": uid(c1), "name": "Corte QA", "price": "50000", "duration_min": 30, "description": "Corte de prueba"}))
s2 = chk("POST producto con stock (Shampoo QA)", T.call("POST", "/catalog/services", {"category_id": uid(c2), "name": "Shampoo QA", "price": "35000", "kind": "item", "track_stock": True, "min_stock": 2, "unit": "u", "sku": f"SHQA{TS}"}))
s3 = chk("POST combo (Kit QA)", T.call("POST", "/catalog/services", {"category_id": uid(c2), "name": "Kit QA", "price": "60000", "kind": "item", "is_combo": True}))
S1, S2, S3 = uid(s1), uid(s2), uid(s3)
if S3 and S2:
    chk("PUT componentes del combo", T.call("PUT", f"/catalog/services/{S3}/components", {"components": [{"service_id": S2, "quantity": 1}]}))
    chk("GET componentes del combo", T.call("GET", f"/catalog/services/{S3}/components"), cond=lambda b: len(b) == 1)
chk("PATCH servicio", T.call("PATCH", f"/catalog/services/{S1}", {"price": "55000"}))
s4 = chk("POST producto con IVA 5%", T.call("POST", "/catalog/services", {"category_id": uid(c2), "name": "Libro QA IVA5", "price": "40000", "kind": "item", "tax_rate": 5}))
if s4:
    chk("PATCH desactivar producto (lo que manda el boton de la pantalla)", T.call("PATCH", f"/catalog/services/{uid(s4)}", {"is_active": False}))
    st, lst, _ = T.call("GET", "/catalog/services")
    x = next((z for z in lst if z["id"] == uid(s4)), {}) if st == 200 else {}
    rec("BUG-EDICION-PARCIAL: desactivar un producto conserva su IVA 5%", x.get("taxRate") == 5, f"el IVA quedo en {x.get('taxRate')}%")
c3 = chk("POST categoria de items con orden 5", T.call("POST", "/catalog/categories", {"name": "Items QA", "default_kind": "item", "sort_order": 5}))
if c3:
    chk("PATCH categoria (solo nombre)", T.call("PATCH", f"/catalog/categories/{uid(c3)}", {"name": "Items QA 2"}))
    st, lst, _ = T.call("GET", "/catalog/categories")
    x = next((z for z in lst if z["id"] == uid(c3)), {}) if st == 200 else {}
    rec("BUG-EDICION-PARCIAL: renombrar una categoria conserva tipo y orden", x.get("defaultKind") == "item" and x.get("sortOrder") == 5,
        f"tipo {x.get('defaultKind')}, orden {x.get('sortOrder')}")
ph = chk("POST foto del servicio", T.call("POST", f"/catalog/services/{S1}/photos", {"data": PNG}))
if ph:
    chk("GET foto (imagen)", T.call("GET", f"/catalog/services/{S1}/photos/{uid(ph)}", raw=True), cond=lambda b: b[:4] == b"\x89PNG")
    chk("DELETE foto", T.call("DELETE", f"/catalog/services/{S1}/photos/{uid(ph)}"))
chk("GET /catalog/services", T.call("GET", "/catalog/services"), cond=lambda b: len(b) >= 3)
chk("GET /catalog/categories", T.call("GET", "/catalog/categories"), cond=lambda b: len(b) >= 2)
tpl = T.call("GET", "/catalog/import/template", raw=True)
chk("GET plantilla de importacion CSV", tpl, cond=lambda b: len(b) > 20)
if tpl[0] == 200:
    chk("POST importacion (simulacion)", T.call("POST", "/catalog/import", {"csv": tpl[1].decode("utf-8", "replace"), "dry_run": True}))

modulo("Negocio: inventario")
chk("POST entrada de stock inicial (10)", T.call("POST", "/inventory/entries", {"service_id": S2, "branch_id": MAIN, "quantity": 10, "unit_cost": "20000", "kind": "initial"}))
chk("POST ajuste de stock (-1 rotura)", T.call("POST", "/inventory/adjustments", {"service_id": S2, "branch_id": MAIN, "delta": -1, "reason": "rotura QA"}))
if B2:
    chk("POST transferencia a sucursal 2 (2)", T.call("POST", "/inventory/transfers", {"service_id": S2, "from_branch_id": MAIN, "to_branch_id": B2, "quantity": 2}))
stk = chk("GET /inventory/stock", T.call("GET", "/inventory/stock"))
CTX["stock_inicial"] = stk
chk("GET /inventory/movements", T.call("GET", f"/inventory/movements?service_id={S2}"), cond=lambda b: len(b.get("data", b)) >= 3)

modulo("Negocio: clientes (CRM)")
ruc = chk("GET /ruc/80000001 (padron DNIT)", T.call("GET", "/ruc/80000001"), cond=lambda b: "NAVIERA" in json.dumps(b))
tel = lambda n: f"+5959810{TS[-4:]}{n}"
ca = chk("POST cliente A (con RUC y razon social)", T.call("POST", "/customers", {
    "first_name": "Carla", "last_name": "QA", "phone_e164": tel(1), "email": f"carla{TS}@example.com", "doc_type": "ruc",
    "doc_number": "80000001", "ruc_dv": "3", "legal_name": "NAVIERA CONOSUR SOCIEDAD ANONIMA", "tags": ["vip"],
    "custom_data": {"talle": "M"}, "source": "recomendacion"}))
cb = chk("POST cliente B", T.call("POST", "/customers", {"first_name": "Diego", "last_name": "QA", "phone_e164": tel(2)}))
CA, CB = uid(ca), uid(cb)
chk("POST cliente con telefono duplicado -> 409", T.call("POST", "/customers", {"first_name": "Dup", "phone_e164": tel(2)}), esperado=(409,))
chk("GET /customers?q= (busqueda)", T.call("GET", "/customers?q=Carla"), cond=lambda b: any(c["id"] == CA for c in b["data"]))
chk("GET /customers?tag=vip", T.call("GET", "/customers?tag=vip"), cond=lambda b: any(c["id"] == CA for c in b["data"]))
chk("GET /customers/:id (ficha)", T.call("GET", f"/customers/{CA}"), cond=lambda b: b["id"] == CA)
chk("aislamiento: cliente de OTRO negocio -> 404", T.call("GET", f"/customers/{AJENO}"), esperado=(404,))
chk("PATCH /customers/:id", T.call("PATCH", f"/customers/{CA}", {"city": "Asuncion", "rating": 5}))
cp = chk("POST contacto adicional", T.call("POST", f"/customers/{CA}/contact-points", {"kind": "phone", "label": "trabajo", "value": "+59521123456"}))
if cp:
    chk("PATCH contacto adicional", T.call("PATCH", f"/customers/{CA}/contact-points/{uid(cp)}", {"label": "oficina"}))
    chk("GET contactos", T.call("GET", f"/customers/{CA}/contact-points"), cond=lambda b: len(b) >= 1)
    chk("DELETE contacto adicional", T.call("DELETE", f"/customers/{CA}/contact-points/{uid(cp)}"))
chk("GET identidades fiscales (la del alta)", T.call("GET", f"/customers/{CA}/fiscal-ids"), cond=lambda b: any(f["docNumber"] == "80000001" for f in b))
fi = chk("POST segunda identidad fiscal (CI)", T.call("POST", f"/customers/{CA}/fiscal-ids", {"doc_type": "ci", "doc_number": "1234567", "legal_name": "Carla QA"}))
if fi:
    chk("PATCH identidad fiscal", T.call("PATCH", f"/customers/{CA}/fiscal-ids/{uid(fi)}", {"legal_name": "Carla QA Personal"}))
    chk("DELETE identidad fiscal", T.call("DELETE", f"/customers/{CA}/fiscal-ids/{uid(fi)}"))
due = (dt.datetime.now(TZ) + dt.timedelta(days=1)).isoformat(timespec="seconds")
ac = chk("POST tarea con vencimiento", T.call("POST", f"/customers/{CA}/activities", {"activity_type": "tarea", "body": "Llamar QA", "due_at": due}))
if ac:
    chk("GET /activities (tareas pendientes)", T.call("GET", "/activities?status=pending"), cond=lambda b: any(a["id"] == uid(ac) for a in b))
    chk("PATCH tarea hecha", T.call("PATCH", f"/customers/{CA}/activities/{uid(ac)}", {"done": True}))
    chk("GET actividades del cliente", T.call("GET", f"/customers/{CA}/activities"))
    chk("DELETE actividad", T.call("DELETE", f"/customers/{CA}/activities/{uid(ac)}"))
cdup = chk("POST cliente duplicado para fusionar", T.call("POST", "/customers", {"first_name": "Carla", "last_name": "Duplicada", "email": f"carla.dup{TS}@example.com"}))
if cdup:
    chk("POST /customers/:id/merge (fusion)", T.call("POST", f"/customers/{CA}/merge", {"source_id": uid(cdup)}))
    chk("el cliente fusionado ya no esta activo", T.call("GET", f"/customers/{uid(cdup)}"), esperado=(404, 200),
        cond=lambda b: (not isinstance(b, dict)) or b.get("deletedAt") or b.get("mergedIntoId") or "title" in b)

modulo("Negocio: agenda y turnos")
D = siguiente_dia_habil()
av = chk(f"GET disponibilidad ({D}, Ana)", T.call("GET", f"/appointments/availability?branch_id={MAIN}&service_id={S1}&date={D}&employee_id={E1}"),
         cond=lambda b: len(b) >= 8)
slots = av or []
CTX["slots"] = slots[:6]
ap1 = ap2 = ap3 = None
if len(slots) >= 8:
    ap1 = chk("POST turno 1 (Carla con Ana)", T.call("POST", "/appointments", {"branch_id": MAIN, "customer_id": CA, "service_id": S1, "employee_id": E1, "starts_at": slots[0]}))
    chk("turno SOLAPADO con la misma empleada -> rechazado", T.call("POST", "/appointments", {"branch_id": MAIN, "customer_id": CB, "service_id": S1, "employee_id": E1, "starts_at": slots[0]}), esperado=(409, 422))
    if ap1:
        chk("confirmar turno", T.call("POST", f"/appointments/{uid(ap1)}/confirm", {}))
        rep = chk("reprogramar turno", T.call("POST", f"/appointments/{uid(ap1)}/reschedule", {"starts_at": slots[2]}))
        # La API devuelve el turno NUEVO (el viejo queda cancelado).
        nuevo = uid(rep.get("nuevo") or rep) if isinstance(rep, dict) else None
        chk("marcar atendido (el turno nuevo de la reprogramacion)", T.call("POST", f"/appointments/{nuevo or uid(ap1)}/complete", {}))
    ap2 = chk("POST turno 2 (Diego con Ana)", T.call("POST", "/appointments", {"branch_id": MAIN, "customer_id": CB, "service_id": S1, "employee_id": E1, "starts_at": slots[4]}))
    if ap2:
        chk("marcar no vino", T.call("POST", f"/appointments/{uid(ap2)}/no-show", {}))
    ap3 = chk("POST turno 3 (Carla con Beto)", T.call("POST", "/appointments", {"branch_id": MAIN, "customer_id": CA, "service_id": S1, "employee_id": E2, "starts_at": slots[6]}))
    if ap3:
        chk("cancelar turno", T.call("POST", f"/appointments/{uid(ap3)}/cancel", {"reason": "prueba QA"}))
    ap4 = chk("POST turno 4 (Diego con Beto)", T.call("POST", "/appointments", {"branch_id": MAIN, "customer_id": CB, "service_id": S1, "employee_id": E2, "starts_at": slots[7]}))
desde = dt.datetime.combine(D, dt.time(0, 0), TZ).isoformat()
hasta = dt.datetime.combine(D, dt.time(23, 59), TZ).isoformat()
chk("GET /appointments (del dia)", T.call("GET", f"/appointments?from={urllib.request.quote(desde)}&to={urllib.request.quote(hasta)}"), cond=lambda b: len(b) >= 4)
ab = chk("POST ausencia de Beto con turno ese dia (mantener)", T.call("POST", f"/employees/{E2}/absences", {"starts_on": str(D), "ends_on": str(D), "reason": "tramite QA", "on_conflict": "keep"}))
chk("GET ausencias", T.call("GET", f"/employees/{E2}/absences"), cond=lambda b: len(b.get("data", b) if isinstance(b, dict) else b) >= 1)
if ab:
    chk("DELETE ausencia", T.call("DELETE", f"/employees/{E2}/absences/{uid(ab) or uid(ab.get('absence', {}))}"))
chk("GET historial del cliente", T.call("GET", f"/customers/{CA}/history"))

modulo("Negocio: servicios recurrentes")
rb = chk("POST recurrente semanal", T.call("POST", "/recurring-bookings", {"customer_id": CB, "branch_id": MAIN, "employee_id": E2, "service_ids": [S1],
         "frequency": "weekly", "weekday": (D.isoweekday() % 7), "time_local": "15:00", "starts_on": str(D + dt.timedelta(days=7))}))
chk("GET /recurring-bookings", T.call("GET", "/recurring-bookings"), cond=lambda b: len(b) >= 1)
chk("POST generar turnos recurrentes", T.call("POST", "/recurring-bookings/generate", {}))
if rb:
    chk("PATCH recurrente (pausar)", T.call("PATCH", f"/recurring-bookings/{uid(rb)}", {"is_active": False}))
    chk("DELETE recurrente", T.call("DELETE", f"/recurring-bookings/{uid(rb)}"))

modulo("Negocio: presupuestos")
vu = str(dt.date.today() + dt.timedelta(days=7))
q1 = chk("POST presupuesto (servicio + item libre)", T.call("POST", "/quotes", {"customer_id": CA, "branch_id": MAIN, "valid_until": vu, "items": [
    {"service_id": S1, "quantity": 1}, {"description": "Extra QA", "unit_price": "10000", "quantity": 2, "tax_rate": 10}]}))
Q1 = uid(q1)
chk("GET /quotes/:id", T.call("GET", f"/quotes/{Q1}"), cond=lambda b: b["id"] == Q1)
chk("marcar enviado", T.call("PATCH", f"/quotes/{Q1}", {"status": "sent"}))
chk("marcar aceptado", T.call("PATCH", f"/quotes/{Q1}", {"status": "accepted"}))
chk("GET PDF del presupuesto", T.call("GET", f"/quotes/{Q1}/pdf", raw=True), cond=lambda b: b[:4] == b"%PDF")
qi = chk("POST convertir presupuesto en factura", T.call("POST", f"/quotes/{Q1}/invoice", {}))
q2 = chk("POST segundo presupuesto", T.call("POST", "/quotes", {"customer_id": CB, "branch_id": MAIN, "items": [{"service_id": S1}]}))
if q2:
    chk("DELETE presupuesto borrador", T.call("DELETE", f"/quotes/{uid(q2)}"))
chk("GET /quotes", T.call("GET", "/quotes"))

modulo("Negocio: facturacion (SIFEN simulado)")
INV1 = (qi or {}).get("invoice_id") or (qi or {}).get("id") or ((qi or {}).get("invoice") or {}).get("id")
rec("la conversion devolvio la factura", bool(INV1), qi)
if INV1:
    inv = chk("emitir factura del presupuesto", T.call("POST", f"/invoices/{INV1}/issue", {}), esperado=(200, 201, 202), cond=lambda b: b.get("status") in ("approved", "issuing"))
    fac = T.call("GET", f"/invoices/{INV1}")[1]
    total = int(fac.get("total", 0)) if isinstance(fac, dict) else 0
    chk("pago parcial", T.call("POST", f"/invoices/{INV1}/payments", {"method": "efectivo", "amount": str(total // 2)}))
    chk("pago del saldo", T.call("POST", f"/invoices/{INV1}/payments", {"method": "transferencia", "amount": str(total - total // 2)}))
    chk("GET KuDE (PDF)", T.call("GET", f"/invoices/{INV1}/kude", raw=True), cond=lambda b: b[:4] == b"%PDF")
    chk("POST enviar factura al cliente", T.call("POST", f"/invoices/{INV1}/send", {}))
i2 = chk("POST factura con producto de stock", T.call("POST", "/invoices", {"customer_id": CB, "branch_id": MAIN, "items": [{"service_id": S2, "quantity": 1}]}))
INV2 = uid(i2)
if INV2:
    chk("PATCH datos de facturacion (CI)", T.call("PATCH", f"/invoices/{INV2}/billing", {"billing": {"doc_type": "ci", "doc_number": "4567890", "legal_name": "Diego QA", "save_to_customer": True}}))
    chk("emitir", T.call("POST", f"/invoices/{INV2}/issue", {}), esperado=(200, 201, 202))
    it = T.call("GET", f"/invoices/{INV2}")[1]
    items = it.get("items", []) if isinstance(it, dict) else []
    if items:
        chk("nota de credito con reposicion de stock", T.call("POST", f"/invoices/{INV2}/credit-note", {
            "reason": "Devolucion QA", "items": [{"item_id": items[0]["id"], "quantity": 1}], "restock": True, "notify_customer": False}))
i3 = chk("POST factura a anular", T.call("POST", "/invoices", {"customer_id": CA, "branch_id": MAIN, "items": [{"description": "Servicio a anular", "unit_price": "25000", "tax_rate": 10}]}))
if i3:
    chk("emitir", T.call("POST", f"/invoices/{uid(i3)}/issue", {}), esperado=(200, 201, 202))
    chk("anular dentro de 48 h (con motivo)", T.call("POST", f"/invoices/{uid(i3)}/cancel", {"reason": "Error de carga QA", "notify_customer": False}), esperado=(200, 201, 202))
i4 = chk("POST borrador", T.call("POST", "/invoices", {"customer_id": CA, "branch_id": MAIN, "items": [{"service_id": S1}]}))
if i4:
    chk("DELETE borrador", T.call("DELETE", f"/invoices/{uid(i4)}"))
chk("GET /invoices (aprobadas)", T.call("GET", "/invoices?status=approved"), cond=lambda b: len(b if isinstance(b, list) else b.get("data", [])) >= 1)

modulo("Negocio: cuenta mensual (consumos)")
cm = chk("POST cliente con facturacion mensual", T.call("POST", "/customers", {"first_name": "Mensual", "last_name": "QA", "phone_e164": tel(3), "billing_mode": "monthly"}))
CM = uid(cm)
if CM:
    chk("POST consumo del catalogo", T.call("POST", f"/customers/{CM}/charges", {"service_id": S1, "quantity": 1}))
    chk("POST consumo libre", T.call("POST", f"/customers/{CM}/charges", {"description": "Consumo QA", "unit_price": "15000", "tax_rate": 10}))
    tercero = chk("POST consumo a borrar", T.call("POST", f"/customers/{CM}/charges", {"description": "Borrar QA", "unit_price": "1000", "tax_rate": 10}))
    if tercero:
        chk("DELETE consumo", T.call("DELETE", f"/billing/charges/{uid(tercero)}"))
    chk("GET /billing/accounts", T.call("GET", "/billing/accounts"))
    chk("GET cuenta del cliente", T.call("GET", f"/billing/accounts/{CM}"))
    chk("POST avisar resumen de cuenta", T.call("POST", f"/billing/accounts/{CM}/notify", {}))
    chk("POST facturar la cuenta", T.call("POST", f"/billing/accounts/{CM}/invoice", {"billing": {"doc_type": "ci", "doc_number": "7654321", "legal_name": "Mensual QA", "save_to_customer": True}, "issue": True, "send": False}))
    chk("GET resumenes", T.call("GET", "/billing/statements"))
    chk("POST cierre de mes", T.call("POST", "/billing/close-month", {}))

modulo("Negocio: devoluciones")
if INV2:
    rt = chk("POST devolucion", T.call("POST", "/returns", {"customer_id": CB, "invoice_id": INV2, "service_id": S2, "description": "Producto con falla QA", "reason": "defecto"}))
    if rt:
        chk("GET /returns", T.call("GET", "/returns"))
        chk("GET /returns/:id", T.call("GET", f"/returns/{uid(rt)}"))
        chk("decidir (aprobar)", T.call("POST", f"/returns/{uid(rt)}/decide", {"decision": "approved", "note": "Aprobado QA", "notify_customer": False}))
        chk("completar con reposicion", T.call("POST", f"/returns/{uid(rt)}/complete", {"note": "ok", "restock": {"service_id": S2, "branch_id": MAIN, "quantity": 1}}))
stk2 = chk("GET stock final", T.call("GET", "/inventory/stock"))
CTX["stock_final"] = stk2

modulo("Negocio: bandeja de chat, chat de prueba y tiempo real (SSE)")
eventos = []


def escuchar(token, segundos):
    try:
        req = urllib.request.Request(f"{API}/conversations/stream?access_token={token}", headers={"accept": "text/event-stream", "user-agent": UA})
        with urllib.request.urlopen(req, timeout=segundos + 5) as r:
            fin = time.time() + segundos
            while time.time() < fin:
                linea = r.readline().decode(errors="replace").strip()
                if linea.startswith("event:"):
                    eventos.append(linea[6:].strip())
    except Exception as e:
        eventos.append(f"cierre: {type(e).__name__}")


hilo = threading.Thread(target=escuchar, args=(T.tok, 35), daemon=True)
hilo.start()
time.sleep(2)
FROM1 = tel(4)
chk("chat de prueba: cliente escribe (webhook firmado)", T.call("POST", f"{WEB}/chat/send", {"phone_number_id": WA, "from_phone": FROM1, "from_name": "Cliente QA", "body": "Hola, esto es una prueba"}, auth=False))
time.sleep(4)
cv = chk("GET /conversations (aparece la conversacion)", T.call("GET", f"/conversations?q={urllib.request.quote(FROM1)}"), cond=lambda b: len(b["data"]) >= 1)
CONV = cv["data"][0]["id"] if cv else None
if CONV:
    chk("GET mensajes (llego el del cliente)", T.call("GET", f"/conversations/{CONV}/messages"), cond=lambda b: any("prueba" in m["body"] for m in b["data"]))
    chk("pausar bot", T.call("POST", f"/conversations/{CONV}/pause", {}))
    chk("responder como agente", T.call("POST", f"/conversations/{CONV}/messages", {"body": "Hola, te atiende QA"}))
    time.sleep(3)
    chk("el cliente ve la respuesta en el chat de prueba", T.call("GET", f"/webhooks/webchat/messages?phone_number_id={WA}&from_phone={urllib.request.quote(FROM1)}", auth=False),
        cond=lambda b: any("te atiende QA" in m["body"] for m in b["messages"]))
    chk("vincular conversacion a cliente", T.call("POST", f"/conversations/{CONV}/link-customer", {"customer_id": CA}))
    chk("reactivar bot", T.call("POST", f"/conversations/{CONV}/resume", {}))
    chk("cerrar conversacion", T.call("POST", f"/conversations/{CONV}/close", {}))
hilo.join(40)
rec("tiempo real: la bandeja recibio eventos en vivo por el tunel", any(e in ("message.new", "conversation.updated") for e in eventos), eventos)
CTX["eventos_sse"] = eventos

modulo("Negocio: bot con IA")
chk("PATCH /bot/settings (encender con permisos)", T.call("PATCH", "/bot/settings", {"enabled": True, "access_catalog": True, "access_calendar": True,
    "allow_booking": True, "access_history": True, "access_customer_data": True}))
bs = chk("GET /bot/settings", T.call("GET", "/bot/settings"))
CTX["bot_settings"] = {k: bs.get(k) for k in ("enabled", "engine_available")} if bs else None
FROM2 = tel(5)
chk("cliente pregunta al bot", T.call("POST", f"{WEB}/chat/send", {"phone_number_id": WA, "from_phone": FROM2, "from_name": "Cliente Bot QA",
    "body": "Hola! que servicios tienen y cuanto cuesta el corte?"}, auth=False))
respuesta = None
for _ in range(30):
    time.sleep(3)
    st, b, _ = T.call("GET", f"/webhooks/webchat/messages?phone_number_id={WA}&from_phone={urllib.request.quote(FROM2)}", auth=False)
    if st == 200:
        out = [m for m in b.get("messages", []) if m["direction"] == "out"]
        if out:
            respuesta = out[-1]
            break
CTX["bot_respuesta"] = respuesta
rec("el cliente recibio respuesta (de la IA o aviso de derivacion)", bool(respuesta), "sin respuesta en 90 s")
if respuesta:
    txt = respuesta["body"]
    ia_ok = "55.000" in txt or "55000" in txt
    CTX["bot_modo"] = "ia" if ia_ok else "derivacion"
    st, b, _ = T.call("GET", f"/conversations?q={urllib.request.quote(FROM2)}")
    nh = bool(st == 200 and b.get("data") and b["data"][0].get("needsHuman"))
    rec("sin IA, el bot deriva a una persona (aviso + 'necesita humano')", ia_ok or nh, f"[{respuesta.get('sender_type')}] {txt[:200]} | needsHuman={nh}")
    rec("la IA respondio con el precio real del catalogo (55.000)", ia_ok, f"respuesta: {txt[:200]}")

modulo("Negocio: sesion (renovacion, soporte y salida)")
st, b, _ = T.call("POST", "/auth/refresh", {})
rec("renovar sesion con la cookie", st == 200 and b.get("access_token"), f"HTTP {st}: {b}")
if st == 200:
    T.tok = b["access_token"]
tk = chk("POST token de soporte (el dueno lo genera)", T.call("POST", "/tenant/support-token", {"hours": 1}))
token_sop = (tk or {}).get("token")
chk("GET token de soporte", T.call("GET", "/tenant/support-token"))
if token_sop:
    sa = chk("admin pide acceso con el token", P.call("POST", f"/platform/tenants/{TID}/support-access", {"token": token_sop}))
    code = (sa or {}).get("code") or ((sa or {}).get("url") or "").split("code=")[-1] if sa else None
    if code:
        SC = Cli()
        sb = chk("completar acceso de soporte", SC.call("POST", "/auth/support/complete", {"code": code}, auth=False), cond=lambda b: b.get("access_token"))
        if sb:
            SC.tok = sb["access_token"]
            chk("el admin opera como el negocio", SC.call("GET", "/tenant"), cond=lambda b: b["id"] == TID)
chk("DELETE token de soporte", T.call("DELETE", "/tenant/support-token"))
chk("POST /auth/logout", T.call("POST", "/auth/logout", {}))
st, b, _ = T.call("POST", "/auth/refresh", {}, auth=False)
rec("tras salir, la cookie ya no renueva la sesion", st in (401, 403) and not es_cloudflare(b), f"HTTP {st}: {b}")

# ============================================================ RESUMEN
json.dump({"ts": TS, "tenant_id": TID, "root": f"qa.srv{TS}@pymes.local", "root_pass": ROOT_PASS, "ids": {
    "CA": CA, "CB": CB, "CM": CM, "S1": S1, "S2": S2, "E1": E1, "E2": E2, "INV1": INV1, "INV2": INV2, "Q1": Q1, "CONV": CONV, "MAIN": MAIN, "B2": B2},
    "ctx": CTX, "resultados": RES}, open(os.path.join(SP, f"qa_resultado_{TS}.json"), "w"), default=str, indent=1)
tot = len(RES)
mal = [r for r in RES if not r["ok"]]
print(f"\n##### TOTAL: {tot} pruebas | OK {tot - len(mal)} | FALLAS {len(mal)}")
for r in mal:
    print(f"  [{r['modulo']}] {r['prueba']}: {r['detalle'][:250]}")
print(f"resultado: qa_resultado_{TS}.json")
