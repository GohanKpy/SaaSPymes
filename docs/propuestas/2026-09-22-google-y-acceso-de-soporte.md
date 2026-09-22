# Entrar con Google y acceso de soporte con token — 2026-09-22

**Pedidos de Johan:** (1) acceder con autenticación de Google; (2) desde el
portal admin, un botón para acceder como un cliente específico, en una
ventana nueva, con un token que da el cliente (por ahora 1111 para todos);
(3) el cliente genera un token de soporte: con él cualquiera del soporte
puede ver sus datos; sin autorización nadie accede.

**Estado:** implementado el 2026-09-22. Diseño en
[ADR 0014](../adr/0014-inicio-de-sesion-google-y-acceso-de-soporte.md).

## Qué tiene que hacer Johan para activar Google

1. En Google Cloud (la misma app OAuth del calendario) agregar la URI de
   redirección `https://api.inicia.com.py/api/v1/auth/google/callback` (y
   `http://localhost:4301/api/v1/auth/google/callback` para el laboratorio).
2. Portal admin → Sistema → Google → tildar "Permitir iniciar sesión con
   Google" → Guardar.
3. Mientras la app de Google esté en modo prueba, solo las cuentas invitadas
   como testers pueden entrar con Google.

## Endpoints

| Ruta | Quién | Qué |
|---|---|---|
| `GET /auth/google/config` | público | `{enabled}` |
| `GET /auth/google/start?scope&origin` | público | redirige a Google |
| `GET /auth/google/callback` | Google | canjea y vuelve a `<origen>/login?google=<código>` |
| `POST /auth/google/complete {code, tenant_id?}` | público + `x-requested-with` | cierra la sesión (cookie de refresh) |
| `GET/POST/DELETE /tenant/support-token` | root, admin del negocio | estado / generar / revocar |
| `POST /platform/tenants/:id/support-access {token}` | padmin (admin, agent) | valida el token y devuelve un código (60 s) |
| `POST /auth/support/complete {code}` | público + `x-requested-with` | sesión de soporte de 60 min, sin refresh |

## Cómo probar

1. Tenant QA → Ajustes → Mi cuenta → "Acceso para soporte": estado "token
   inicial 1111"; Generar (24 h) muestra un token de 6 dígitos; Revocar lo
   quita.
2. Portal admin → cliente → "Acceder como cliente" → token equivocado: "El
   token de soporte no coincide"; token correcto: se abre el panel del
   cliente con la franja roja de soporte; Auditoría del negocio muestra las
   acciones con origen portal admin.
3. Login del panel con Google habilitado: botón "Entrar con Google"; con un
   email sin usuario: "Esa cuenta de Google no tiene usuario en ningún negocio".
