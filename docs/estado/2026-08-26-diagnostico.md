# Diagnóstico del estado del producto — 2026-08-26

**Alcance:** lectura completa de `docs/plan` (11 documentos) y los 9 ADR, contra
el código real del monorepo a esta fecha. Se auditó en profundidad seguridad y
secretos, capa de datos y RLS, y completitud funcional/tests.

**Marco de severidad — importante:** el sistema está en **etapa de desarrollo y
test; toda la información dentro es falsa** (tenants y clientes de prueba, sin
piloto real). Por eso ningún hallazgo de este informe es un incidente de negocio
*hoy*. La escala que uso es: **BLOQUEANTE-PILOTO** (hay que resolverlo antes de
que entre el primer dato real de un negocio), **DEUDA** (mejora antes de escalar)
y **NOTA** (correcto, o menor). El único matiz que sí aplica hoy: los secretos
versionados en git (ver §3.1) son deuda que se arrastra en el historial y conviene
cortar cuanto antes, aunque los valores actuales sean de juguete.

---

## 1. Propósito y fase (confirmación)

**Producto:** SaaS multitenant para PyMEs de servicios de Paraguay. Le da a cada
negocio su operación completa —CRM, catálogo tipado, agenda con empleados,
facturación electrónica SIFEN— y su diferencial es un **bot de WhatsApp con IA**
que atiende y agenda solo, con el personal pudiendo pausar y tomar control. Dos
audiencias: los tenants (portal de clientes) y el dueño de la plataforma (portal
admin separado, ADR 0004) que vende planes, pacta overrides y controla el costo
de IA por tenant. Planes y features son datos, no código. La restricción de
diseño número uno: **el cruce de datos entre tenants es inaceptable**.

**Fase:** funcionalmente por encima de la Fase 2 del roadmap (docs/plan/07), pero
en **Fase 0 de infraestructura**. Fase 1 completa; Fase 2 con las piezas externas
simuladas (SIFEN fake, sin emails reales, WhatsApp a falta de credenciales
oficiales); Fase 3 sin arrancar. AWS nunca se encendió: todo corre en el
laboratorio local expuesto por Cloudflare Tunnel. Estado real: **pre-piloto**.

---

## 2. Estado actual vs. plan

### 2.1 Implementado y sólido

- **Aislamiento multitenant (la prioridad #1): íntegro.** Las 24 tablas del
  esquema `app` tienen RLS `ENABLE`+`FORCE` con política `tenant_isolation`
  (USING y WITH CHECK). No hay una sola tabla huérfana. **No existe ningún
  `$queryRaw`/`$executeRaw` en toda la API**, y no hay ningún acceso a datos de
  tenant fuera de `tenantTx()`. Las FKs compuestas `(tenant_id, id)` están en las
  tablas hijas. El rol de runtime `app_rw` es `NOBYPASSRLS`; `app.current_tenant()`
  falla cerrado (sin tenant → cero filas), verificado sobre las 24 tablas.
- **`platform_ops` bien resuelto:** el rol de plataforma que pedía el plan
  (docs/plan/03 §4 regla 3) existe con 4 políticas explícitas y acotadas
  (`login_lookup`, `sessions`, `webhook_lookup`), no como un bypass de RLS.
- **Auth:** JWT RS256 con `jose` (15 min, `algorithms:['RS256']` fijo, sin
  `alg:none`); refresh token de 48 bytes hasheado SHA-256 en DB, **con rotación y
  detección de reuso que revoca toda la cadena**; cookie `httpOnly`+`SameSite=strict`
  + header anti-CSRF `X-Requested-With`; Argon2id 64 MiB/t=3/p=4; lockout por
  cuenta e IP configurable desde el panel.
- **Crypto:** AES-256-GCM con IV aleatorio por operación y authTag; falla al
  arrancar si la llave no mide 32 bytes; se usa consistente para todas las
  credenciales de integraciones, llaves del bot y el `state` de OAuth.
- **Webhooks de WhatsApp:** firma `X-Hub-Signature-256` verificada **siempre y
  primero**, sobre el `rawBody`, con `timingSafeEqual`; identidad del tenant por
  `phone_number_id`; dedupe por `wa_message_id` con índice único parcial en DB.
- **Bandeja de chat: completa** — conversaciones, mensajes, SSE con los 4 eventos
  del spec, envío como agente, pause/resume, link-customer.
- **Bot:** motor multiproveedor (ADR 0002), 7 tools con permiso-como-existencia,
  prompt en 3 capas (ADR 0008), ledger de tokens con corte (ADR 0006). Es el
  paquete **mejor testeado** del repo.
- **Agenda:** `availability()` respeta franjas, cierres, duración por tipo y
  capacidad por empleados libres; anti-solape con `pg_advisory_xact_lock`.
- **Facturación (dominio):** totales e IVA recalculados server-side; numeración
  correlativa con advisory lock; ventana de anulación de 48 h con 409 que deriva
  a nota de crédito.
- **CRM extendido** (multifield, campos personalizados, actividades, merge,
  history), catálogo tipado, empleados agendables (ADR 0009): todo operativo.
- **Disciplina de código:** un solo `any` en todo el repo (justificado), cero
  `@ts-ignore`/`eslint-disable`, ninguna migración editada tras aplicarse.

### 2.2 A medias (implementado con huecos)

| Área | Qué falta |
|---|---|
| **Notificación al cliente final** | Confirmar o cancelar un turno **no avisa a nadie**. El único aviso proactivo de todo el sistema es la cancelación por cambio de horario de sucursal (`branch-schedule.service.ts:181`). Esto es el criterio de cierre de Fase 1 ("operar el día con notificaciones"). |
| **Facturación (endpoints)** | Faltan `PATCH /invoices/:id` (editar borrador), `POST /:id/credit-note`, `POST /:id/send`; `issue` **no exige `Idempotency-Key`** (cero rastro en el repo) pese a que el plan lo marca crítico; `GET /:id/kude` devuelve el PDF inline en vez de URL prefirmada; el disparo del KuDE al completar el pago no existe. |
| **Agenda (endpoints)** | `PATCH /appointments/:id` (reprogramar) **no existe**; `confirm`/`cancel` no notifican; `complete` sin `?draft_invoice`. |
| **Integraciones** | `POST /integrations/smtp/test` **no existe** (criterio de cierre de Fase 1); SIFEN guarda datos pero **sin upload del `.p12`**; WhatsApp no dispara verificación asíncrona. |
| **Auth self-service** | Sin `forgot-password`/`reset-password`, sin invitaciones por email, sin `must_change_password`, y **un usuario de tenant no puede cambiar su propia contraseña** (depende de su admin). |
| **Bot** | `instructions-file` en S3 sustituido por texto en DB; `GET /bot/usage` embebido en settings, sin costo estimado. |
| **Plataforma** | Sin `/platform/billing/*`, sin `/platform/tenants/:id/usage` completo (solo tokens), sin `/platform/audit` legible. |
| **Utilitarios** | Sin `/health/ready`, sin `GET /audit` (la auditoría **se escribe pero no se puede leer** por ninguna API ni UI), sin `/files/presign`, sin OpenAPI en `/api/docs`. |

### 2.3 No existe (declarado como pendiente)

- **Toda la infraestructura asíncrona.** El worker es un heartbeat de 27 líneas.
  **Ningún código toca SQS, S3/MinIO ni SMTP** — están en env y docker-compose
  pero ociosos. Lo asíncrono corre `setInterval` dentro de la API (no sobrevive a
  múltiples réplicas: cada instancia barrería en paralelo).
- **Envío de emails:** cero `nodemailer` en el repo.
- **SIFEN real:** solo `FakeInvoicingProvider` (aprueba con CDC sintético). No hay
  sandbox ni proveedor homologado; `credit_notes` modelada pero sin flujo.
- **TOTP:** solo columnas en DB. Peor: una cuenta con `totp_enabled=true` **queda
  bloqueada** (428) porque la verificación no está implementada (`auth.service.ts:206`).
- **KMS:** `CRYPTO_PROVIDER=kms` **lanza excepción y la API no arranca**
  (`crypto.service.ts:18`).
- **Pasarela de pagos, billing a tenants, cabeceras de seguridad, tests E2E/carga.**

---

## 3. Desvíos del plan y de buenas prácticas

### 3.1 Secretos de "producción" = valores versionados en GitHub — DEUDA (cortar ya)

Verificado byte a byte: en `.env.local`, las variables `JWT_PRIVATE_KEY_BASE64`,
`JWT_PUBLIC_KEY_BASE64`, `CRYPTO_LOCAL_KEY_BASE64`, `META_APP_SECRET` y
`AWS_SECRET_ACCESS_KEY` son **idénticas** a las del `.env.local.example`, que **sí
está en git** (remote `github.com/GohanKpy/SaaSPymes.git`; `.gitignore` solo
excluye `.env.local`). Con datos falsos hoy el impacto es nulo, pero:

- Es la clase de deuda que el historial de git conserva para siempre. La llave
  privada RSA que firma los JWT y la llave AES que cifra credenciales **no deben
  volver a nacer de un archivo de ejemplo**. El ejemplo debe traer placeholders
  (`CHANGE_ME`), no material criptográfico usable.
- Mientras el laboratorio esté expuesto por el túnel con estas llaves, cualquiera
  que lea el repo público puede firmar tokens `role:'root'`/`scope:'platform'` y
  descifrar los payloads. No urge por los datos falsos, pero es la razón por la que
  esto **debe estar resuelto antes del primer piloto**, no después.

### 3.2 `trustProxy: true` confía en todos los proxies — DEUDA

`app.factory.ts:29` usa `FastifyAdapter({ trustProxy: true })`. Detrás del túnel
hace falta *algo* de trust para que `req.ip` no sea siempre la IP del túnel, pero
`true` confía en **cualquier** `X-Forwarded-For`, incluido el del atacante.
Combinado con `common/ip.ts:18` (`127.0.0.1` siempre pasa), un header
`X-Forwarded-For: 127.0.0.1` atraviesa cualquier allowlist. Esto degrada, todos a
la vez: la restricción de IP del portal admin, el lockout por IP (que además
permite bloquear a terceros eligiendo su IP), el rate limit y la **veracidad de la
IP en el audit log**. Lo correcto: confiar solo en el rango de Cloudflare.

### 3.3 GRANTs demasiado amplios — DEUDA (desvío heredado del plan)

`infra/local/init/01-schema.sql:46-49` da `SELECT/INSERT/UPDATE/DELETE` sobre
**todas** las tablas de `control` y `app` a `app_rw` y `platform_ops`.
Consecuencias concretas: `app_rw` puede `SELECT control.platform_users` (leer los
hashes de los admins de plataforma) y `DELETE FROM app.audit_log` de su propio
tenant. Esto además incumple la promesa del plan §7 ("sin DELETE físico en
invoices/messages/audit_log"): **no hay ningún `REVOKE DELETE` que la imponga**.
El plan trae el mismo GRANT amplio, así que es fidelidad a un punto flojo del
plan, no una desviación caprichosa — pero conviene corregir ambos.

### 3.4 Auditoría de empleados filtra datos sensibles — DEUDA

`employees` usa el trigger genérico `app.row_audit()`, que **copia `salary`,
`ci_number`, `ips_number`, `birth_date` y `emergency_contact` en claro al
audit_log** (`20260813000000:40`) — justo el criterio que sí se aplicó a `users`
y a `credentials`. Falta la variante dedicada que excluya esas columnas.

### 3.5 Otros desvíos menores

- **`updated_at` congelado** en `bot_usage_monthly`, `employees` y
  `custom_field_defs`: no tienen el trigger `trg_*_touch` y el schema Prisma no
  usa `@updatedAt` en ningún lado.
- **Drop no expand-and-contract:** `20260817000000` migra datos y hace
  `DROP COLUMN bookable_by_bot` en la **misma** migración. Con deploy atómico no
  duele, pero contradice la disciplina del resto (contradice docs/plan/06 §5).
- **Stack del frontend distinto al plan:** no hay TanStack Query ni shadcn/ui
  (docs/plan/01 §4 los nombraba). Se maneja con `useState`+`fetch` manual y
  primitivos caseros. Funciona, pero explica páginas de 500-685 líneas y recargas
  manuales en cada evento SSE.
- **CORS/redirect laxos fuera de producción:** el regex de `app.factory.ts:40`
  acepta **cualquier host** en los puertos 4300/4308 con `credentials:true`, y el
  mismo patrón habilita un open-redirect en el callback de Google
  (`integrations.controller.ts:71`). Activo hoy porque `NODE_ENV=development`.
- **Tablas y vista muertas:** `notification_emails` (con RLS, cero usos),
  `subscriptions`/`platform_invoices` (billing sin implementar), y la vista
  `customer_history` (existe con `security_invoker`, pero solo la usa el test; no
  está mapeada en Prisma ni la consulta la app — el history del CRM la reconstruye
  por otro camino).
- **`bot.service.ts`:** 1002 líneas concentrando prompt, ejecución de 7 tools,
  presupuesto, SSE y envío WA. Candidato a partirse.

---

## 4. Riesgos priorizados

### 4.1 Aislamiento de datos entre tenants — **el riesgo #1, hoy bien cubierto**

La defensa en profundidad está **realmente implementada** (4 barreras + suite
bloqueante). Los riesgos que quedan son de segunda línea, no de aislamiento roto:

- **[DEUDA] `refresh_tokens` es la superficie donde RLS no protege.** La política
  `platform_sessions` es `USING(true) WITH CHECK(true)`: el único guard son los
  `where` de Prisma en `auth.service.ts`. Hoy el código es correcto (lookup por
  `tokenHash`, revocación por `userScope`+`userId`), pero es la superficie de mayor
  consecuencia (un bug de scope aquí = toma de sesión cross-tenant) y **no tiene
  ningún test**. Además `replaced_by` es FK simple, no compuesta.
- **[DEUDA] La suite de aislamiento no cubre los casos 7, 8 y 9 del plan**
  (docs/plan/08 §2): staff cruzando sucursal, webhook con `phone_number_id` de otro
  tenant, y bot de A pidiendo datos de cliente de B. **Son justo las superficies
  nuevas (chat/bot)** y las que el plan marcó como evidencia de seguridad. También
  falta cualquier test del rol `platform_ops`.
- **[DEUDA] FKs de actor/relación faltantes:** `appointments.invoice_id` sin FK
  (heredado del plan), `employees.user_id` sin FK compuesta.

### 4.2 Tokens y secretos — **varios BLOQUEANTE-PILOTO**

- **[BLOQUEANTE-PILOTO] Material criptográfico versionado** (§3.1): rotar llaves
  reales y sacar todo secreto usable del `.env.local.example` antes del primer dato
  real. Una llave que estuvo en git sigue comprometida aunque se rote después, así
  que el corte conviene cuanto antes.
- **[BLOQUEANTE-PILOTO] TOTP inexistente** y allowlist de IP desactivada y evadible
  (§3.2): hoy el portal del dueño es **password-only**, sin segundo factor y sin
  red que lo proteja. El plan exige TOTP obligatorio para plataforma.
- **[BLOQUEANTE-PILOTO] KMS inexistente:** `CRYPTO_PROVIDER=kms` impide arrancar.
  El pase a AWS del plan asume KMS operativo; hoy no hay ni la clase ni la
  dependencia. La única DEK vive en `process.env` toda la vida del proceso, sin
  rotación, sin AAD que ate el ciphertext a su `tenant_id`, sin versionado de
  llave (rotarla vuelve ilegible todo lo cifrado).
- **[BLOQUEANTE-PILOTO] Superficies de laboratorio abiertas tras el túnel:**
  `/chat/send` (sin auth, firma webhooks reales con el `META_APP_SECRET` del
  server — una fábrica de mensajes de WhatsApp falsificados) y
  `/webhooks/webchat/messages` (público, lee conversaciones de cualquier tenant).
  Hoy accesibles porque `NODE_ENV=development`+`ALLOW_WEBCHAT=true`, y el default
  del example reabre el chat aun en producción. Con datos falsos es inocuo, pero no
  puede quedar así cuando entren conversaciones reales.
- **[DEUDA] Sin cabeceras de seguridad** (helmet/CSP/HSTS/nosniff/frame-ancestors):
  cero en API y web. Relevante porque el token del SSE viaja en query string.
- **[DEUDA] `/auth/login` sin rate limit** (solo lockout en memoria, evadible por
  `X-Forwarded-For`); PII de clientes en logs y en `bot_tool_calls.args` sin purga;
  contraseñas temporales viajando en el body de respuesta.

### 4.3 Lo que puede comprometer SIFEN más adelante

SIFEN es hoy un fake, así que no hay riesgo activo; los riesgos son de **diseño que
habrá que enderezar antes de conectar el proveedor real**, y conviene atenderlos
ahora que es barato:

- **[BLOQUEANTE-SIFEN] Falta `Idempotency-Key` en `POST /issue`.** El plan lo marca
  crítico: sin clave de idempotencia, un reintento (de red, del worker futuro, del
  usuario) puede **emitir un documento fiscal duplicado** contra el SET. Hay que
  tenerlo antes del primer documento real. La numeración correlativa con advisory
  lock ya está bien; falta la idempotencia de la emisión.
- **[BLOQUEANTE-SIFEN] Sin upload ni gestión del certificado `.p12`** del tenant
  (ni su passphrase por separado): el flujo real de firma no puede existir sin eso.
- **[DEUDA-SIFEN] `invoice_items` y `payments` sin trigger de auditoría** pese a ser
  dato fiscal y dinero. Para documentos electrónicos, la traza importa.
- **[DEUDA-SIFEN] `audit_log` borrable** (§3.3): la evidencia fiscal/inmutable que
  el plan promete no está garantizada por la base.
- **[DEUDA-SIFEN] Cero tests de `invoices.service`**: numeración bajo concurrencia
  (que el plan exige nominalmente), máquina de estados, ventana de 48 h, cálculo de
  IVA — nada tiene red. Es el módulo donde un bug cuesta dinero y credibilidad.
- **[NOTA] El KuDE se re-renderiza en cada descarga** y no se persiste; con SIFEN
  real, el PDF aprobado debería guardarse (S3) como parte del documento.

### 4.4 Otros riesgos operativos

- **[DEUDA] Ningún canal de notificación al cliente final** (§2.2): sin esto, "el
  negocio opera su día" no se cumple, y depende de infraestructura asíncrona que no
  existe.
- **[DEUDA] Trabajo asíncrono in-process:** no escala a réplicas; el `setInterval`
  de inactividad y los barridos de Google correrían en paralelo por instancia.
- **[NOTA] Seed con padmin por defecto** (`admin@pymes.local`/`Admin1234!dev`) sin
  guard de `NODE_ENV`: el `upsert` no pisa cuentas existentes, pero podría crear un
  admin con credenciales públicas si el email no existe en el destino.

---

## 5. Recomendaciones

### 5.1 Cambiar ya (barato ahora, caro después; no rompe el flujo de desarrollo)

1. **Cortar los secretos del repo.** Rotar JWT/AES/`META_APP_SECRET`, reemplazar
   los valores del `.env.local.example` por placeholders (`CHANGE_ME`), y regenerar
   las llaves locales fuera de git. Es la única deuda que el historial arrastra.
2. **Trigger de auditoría dedicado para `employees`** que excluya salario, CI, IPS,
   nacimiento y contacto de emergencia (copiar la variante de `users`). Es una
   migración chica y cierra una fuga de PII sensible.
3. **GRANTs mínimos** en el init SQL: quitarle a `app_rw` el acceso a
   `control.platform_users` y el `DELETE` sobre `audit_log`/`invoices`/`messages`
   (esto último además cumple la promesa del plan §7). Hacerlo ahora, con esquema
   chico, es trivial; después es arqueología de permisos.
4. **Confiar solo en Cloudflare** en `trustProxy` (no `true`), y quitar el
   `127.0.0.1 → siempre pasa` incondicional de `ip.ts`. Restaura la validez del
   lockout, el rate limit y la IP del audit log.
5. **Idempotencia y certificado de facturación**, aunque SIFEN siga fake: agregar
   `Idempotency-Key` a `issue` y el modelo de upload del `.p12`. Diseñarlo con el
   proveedor fake evita rehacer el flujo cuando llegue el real.
6. **Completar la suite de aislamiento con los casos 7, 8 y 9** y un test de
   `platform_ops`. Son las superficies nuevas (bot/chat/webhook) y hoy no tienen red.

### 5.2 Mejorar después (antes de escalar / del piloto con datos reales)

- Implementar **TOTP** (enrolamiento + verificación + recovery), reactivar y
  endurecer la allowlist del portal admin.
- Implementar el **provider KMS** de `CryptoService` (y decidir si se agrega AAD con
  `tenant_id` y versionado de llave para permitir rotación).
- **Cabeceras de seguridad** (helmet/CSP en API, `headers()` en Next), sacar el
  token del SSE de la query string, poner rate limit a `/auth/login`.
- Tests de las reglas con dinero/estado: `invoices.service`, `appointments.service`,
  `auth.service`, `crypto.service`. Sumar Playwright para los 6 recorridos del plan.
- Endpoints faltantes de facturación (`credit-note`, editar borrador, `send`),
  `PATCH /appointments/:id`, `GET /audit`, `/health/ready`.
- `updated_at` (triggers/`@updatedAt`), FKs compuestas de actor, partir
  `bot.service.ts`, decidir el destino de las tablas/vista muertas.
- Cerrar el material de laboratorio (`/chat`, `/webchat/messages`) detrás de una
  única bandera coherente y autenticada, no de `NODE_ENV`.

### 5.3 Próximo paso de desarrollo recomendado — y por qué

**La infraestructura asíncrona (worker + colas + notificaciones + object storage),
no más features.**

Razones, en orden:

1. **Es el cuello de botella de todo lo que sigue.** El criterio de cierre de Fase 1
   ("el negocio opera su día con notificaciones") no se cumple porque **confirmar o
   cancelar un turno no avisa a nadie**. Recordatorios de turno, KuDE por
   WhatsApp/email, envío de comprobantes, invitaciones por email: **todo** depende
   de una capa asíncrona que hoy es un heartbeat de 27 líneas.
2. **El diseño ya lo pide y lo tiene a medio camino.** El plan manda que la API
   encole y el worker ejecute; los `setInterval` in-process están marcados en el
   código como deuda explícita ("el pase a SQS+worker llega con el hardening"), y
   ElasticMQ/MinIO/Mailpit ya están en el compose ociosos. Es completar una
   arquitectura decidida, no inventar una.
3. **Desbloquea el pase a AWS con paridad.** Mover el trabajo a SQS/S3/SMTP ahora
   —contra los emuladores locales— es lo que hace que encender AWS sea un cambio de
   variables y no una reescritura (docs/plan/11). Hoy, con todo in-process, el pase
   a AWS es un refactor.
4. **No pelea con el resto de las prioridades.** Los "cambiar ya" de §5.1 son
   quirúrgicos y no chocan con este frente; el piloto real (que necesita §5.2) no
   puede ocurrir sin notificaciones de todos modos.

Concretamente: worker consumiendo una cola real, primer job de punta a punta
(recordatorio o confirmación de turno por WhatsApp, que ya tiene el cliente de
Cloud API listo en `packages/wa`), y mover el barrido de inactividad y la sync de
Google del `setInterval` a la cola. Con eso, el criterio de Fase 1 se cierra de
verdad y el camino a AWS queda pavimentado.

---

*Fuentes: docs/plan/01–11, ADR 0001–0009, y auditoría del código a 2026-08-26
(seguridad/secretos, capa de datos/RLS, completitud funcional/tests). Las
referencias `archivo:línea` del cuerpo son los anclajes verificables de cada
hallazgo.*
