# ADR 0014 — Inicio de sesión con Google y acceso de soporte con token del cliente

- Estado: aceptado (implementado 2026-09-22)
- Fecha: 2026-09-22

## Contexto

Pedidos del dueño (2026-09-22):

1. Poder entrar a los paneles con la cuenta de Google.
2. Desde el portal admin, un botón "Acceder como cliente" que abra en una
   ventana nueva el panel de ese cliente, autorizado por un **token que da el
   cliente** (por ahora `1111` para todos).
3. En el panel del cliente, un botón para **generar un token de soporte**.
   Los datos del cliente son privados: nadie de la plataforma entra sin ese
   token; el token es la autorización.

## Decisión

### 1. Entrar con Google (ambos portales)

- Se reutiliza la **app OAuth de Google del sistema** (ADR 0007, padmin →
  Sistema → Google) con un interruptor nuevo "Permitir iniciar sesión con
  Google". Hay que registrar en Google Cloud la URI
  `<API>/api/v1/auth/google/callback` (además de la del calendario).
- Flujo (authorization code, server-side; sin librerías nuevas):
  `GET /auth/google/start?scope=tenant|platform&origin=<panel>` → Google
  (`openid email profile`, `prompt=select_account`, `state` cifrado con
  origen, scope y vencimiento 10 min) → `GET /auth/google/callback` →
  canje del code por el `id_token` (viene del endpoint de tokens de Google
  por TLS con nuestro secreto: no hace falta verificar su firma) → email
  verificado → **código de un solo uso** cifrado (60 s) → redirección a
  `<origen>/login?google=<código>` → el panel llama
  `POST /auth/google/complete {code, tenant_id?}` con `x-requested-with`, que
  cierra la sesión igual que el login por contraseña (cookie de refresh,
  elección de empresa si el email existe en varias).
- **Sin registro automático**: Google solo prueba la identidad del email;
  el usuario tiene que existir y estar activo en un negocio (o en la
  plataforma). El email de Google debe venir `email_verified`. El login de
  plataforma respeta `PLATFORM_ALLOWED_IPS` igual que con contraseña.
- Auditoría: `auth.login_google` en `app.audit_log` / `platform_audit_log`.

### 2. Token de soporte (lado cliente)

- `control.tenants.support_token_hash` (sha256 de `id:token`),
  `support_token_expires_at`, `support_token_created_at/by`. Todos los
  clientes existentes y nuevos arrancan con el token inicial **1111** sin
  vencimiento (decisión provisoria del dueño).
- Ajustes → Mi cuenta (root y admin): estado del token, **Generar token de
  soporte** (6 dígitos aleatorios, duración 1 h / 24 h / 7 días; se muestra
  una sola vez) y **Revocar**. `GET/POST/DELETE /tenant/support-token`.

### 3. Acceder como cliente (portal admin)

- Ficha del cliente → "Acceder como cliente" → pide el token → `POST
  /platform/tenants/:id/support-access {token}`: valida hash y vencimiento
  (403 si no coincide; bloqueo por intentos con la misma regla del login),
  audita (`tenant.support_access` en plataforma y `auth.support_login` en el
  tenant), avisa por correo al negocio ("un agente de soporte entró con tu
  token") y devuelve un **código de un solo uso** (60 s). El portal admin
  abre `<panel del cliente>/login?support=<código>` en una ventana nueva.
- `POST /auth/support/complete {code}` emite un access token de **60
  minutos, sin cookie de refresh**, con claims `scope=tenant, tid, role=root,
  sup=true, spe=<email del agente>`. Al vencer, la ventana se cierra sola
  (hay que volver a entrar desde padmin con el token vigente).
- Dentro del panel: franja permanente "Sesión de soporte de la plataforma
  (agente) · vence HH:MM · todo queda registrado". `tenantCtx` marca
  `actorType='platform'` y el registro de acciones guarda `actor_scope=
  platform` con el email del agente y el `tenant_id`, así en Auditoría se
  distingue lo que hizo soporte de lo que hizo el cliente.

## Consecuencias

- Ningún usuario de plataforma puede ver datos de un negocio desde su panel
  sin un token vigente; lo que padmin ya veía (usuarios, uso del bot,
  acuerdos) sigue igual porque es CRM de la plataforma, no datos del negocio.
- La sesión de soporte no sobrevive a un F5 (no hay refresh): decisión
  consciente para que el acceso sea corto y explícito.
- Un mismo navegador con dos clientes abiertos: cada pestaña mantiene su
  token en memoria; no comparten cookie porque la sesión de soporte no la usa.
