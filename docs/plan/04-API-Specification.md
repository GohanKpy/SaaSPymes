# 04 · API Specification
## REST /api/v1

---

## 1. Convenciones generales

- **Base URL:** `https://api.<dominio>/api/v1` (tenants) y `https://api.<dominio>/api/v1/platform` (administración global).
- **Formato:** JSON UTF-8. Fechas ISO 8601 con zona (`2026-08-14T15:30:00-04:00`). Montos como enteros en guaraníes + campo `currency`.
- **Autenticación:** `Authorization: Bearer <access_token>` (JWT, 15 minutos). Refresh vía cookie `httpOnly` + `POST /auth/refresh` con rotación. El refresh token nunca es accesible por JavaScript.
- **Identidad de tenant:** viaja **dentro del JWT** (claims `tid`, `uid`, `role`, `branches`). Jamás se acepta un `tenant_id` del body o query para decidir el scoping: el token manda. Cada request abre transacción con `SET LOCAL app.tenant_id` (documento 03).
- **Paginación:** cursor-based: `?limit=50&cursor=<opaque>`. Respuesta: `{ "data": [...], "next_cursor": "..." | null }`. Cursor opaco (id + timestamp firmados) para estabilidad con inserciones concurrentes.
- **Filtros y orden:** query params documentados por recurso; `?q=` para búsqueda de texto donde aplique.
- **Errores:** `application/problem+json` (RFC 7807):

```json
{
  "type": "https://docs.<dominio>/errors/validation",
  "title": "Datos invalidos",
  "status": 422,
  "detail": "phone_e164 debe estar en formato E.164",
  "errors": { "phone_e164": ["formato invalido"] },
  "trace_id": "0af7..."
}
```

- **Códigos de estado:** 200 OK, 201 Created, 202 Accepted (trabajos asíncronos), 204 No Content, 400 request malformado, 401 sin autenticar, 403 sin permiso (incluye feature no habilitada en el plan), 404 no existe **o no es de tu tenant** (nunca se distingue), 409 conflicto de estado (ej. anular fuera de plazo), 422 validación, 429 rate limit, 500 error interno con `trace_id`.
- **Idempotencia:** mutaciones críticas (`POST /invoices/{id}/issue`, pagos) aceptan header `Idempotency-Key`; la API guarda el resultado 24 h y devuelve la misma respuesta ante reintentos.
- **Rate limiting:** por IP en auth (10/min) y por tenant en API general (600/min, configurable por plan). Respuesta 429 con `Retry-After`.
- **Versionado:** prefijo de ruta `/v1`. Cambios incompatibles abren `/v2` conviviendo un período; los compatibles (campos nuevos opcionales) no versionan. Deprecaciones se anuncian con header `Sunset`.
- **Documentación:** OpenAPI 3.1 generada desde los decoradores de NestJS, publicada en `/api/docs` (protegida en producción). El contrato OpenAPI es artefacto del build y se versiona en el repo.

## 2. Matriz de autorización

Roles de tenant: `root`, `admin`, `staff`. Roles de plataforma: `padmin`, `pagent`.

| Recurso | root | admin | staff | Nota |
|---|---|---|---|---|
| Configuración e integraciones (tokens) | CRUD | sin acceso | sin acceso | Regla de negocio central: solo root ve secretos |
| Usuarios del tenant | CRUD | CRUD (no root) | no | admin no puede tocar usuarios root |
| Sucursales | CRUD | leer | leer | |
| Clientes, catálogo, agenda | CRUD | CRUD | CRUD | staff limitado a sus sucursales (`user_branch_access`) |
| Bandeja de chat | total | total | sus sucursales | pausar bot y responder requiere feature `chat_inbox` |
| Facturas: emitir | sí | sí | configurable | anular: solo root y admin, con motivo obligatorio |
| Reportes | sí | sí | sus sucursales | |
| Planes y overrides | no | no | no | exclusivo de plataforma (`padmin`) |

La autorización se implementa con guards de NestJS en tres capas: (1) autenticación JWT, (2) rol y sucursal, (3) feature habilitada según plan + overrides (guard `FeatureGuard('invoicing')`). Un 403 por feature devuelve `type: .../feature-not-enabled` para que la UI ofrezca el upgrade.

## 3. Endpoints

### 3.1 Autenticación (`/auth`)

| Método | Ruta | Descripción | Códigos |
|---|---|---|---|
| POST | `/auth/login` | email + password (+ `totp_code` si está activo). Devuelve access token y setea cookie de refresh | 200, 401, 423 (bloqueado por intentos), 428 (requiere TOTP) |
| POST | `/auth/refresh` | Rota el refresh token y devuelve nuevo access token | 200, 401 |
| POST | `/auth/logout` | Revoca la cadena de refresh | 204 |
| POST | `/auth/forgot-password` | Envía token de un solo uso (respuesta siempre 202, sin filtrar existencia) | 202 |
| POST | `/auth/reset-password` | Cambia contraseña con token | 204, 400, 410 |
| POST | `/auth/totp/setup` · `/auth/totp/verify` · `DELETE /auth/totp` | Alta, verificación y baja de 2FA | 200, 204 |

### 3.2 Cuenta y estructura (`/tenant`, `/branches`, `/users`)

| Método | Ruta | Rol | Descripción |
|---|---|---|---|
| GET/PATCH | `/tenant` | root (PATCH), todos (GET) | Datos de la empresa: nombre, RUC, logo, timezone |
| GET | `/tenant/features` | todos | Features efectivas (plan + overrides) para que la UI muestre u oculte módulos |
| GET/POST | `/branches` · PATCH/DELETE `/branches/{id}` | root/admin | Sucursales; DELETE es soft delete y exige no tener turnos futuros |
| GET/POST | `/users` · PATCH/DELETE `/users/{id}` | root/admin | Alta con invitación por email; asignación de sucursales |
| GET/POST/DELETE | `/notification-emails` | root/admin | Lista de correos de aviso (no usuarios) |

### 3.3 Integraciones (`/integrations`), solo root

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/integrations` | Estado por tipo (configurada sí/no, `public_config`); jamás devuelve secretos, ni siquiera enmascarados |
| PUT | `/integrations/whatsapp` | Guarda token, phone_number_id, verify_token. Dispara verificación asíncrona (202) |
| PUT | `/integrations/smtp` | host, puerto, usuario, password. `POST /integrations/smtp/test` envía correo de prueba |
| PUT | `/integrations/sifen` | timbrado, establecimiento, punto, certificado (upload `.p12` + passphrase) |
| PUT | `/integrations/google-calendar` | Inicia OAuth; callback en `/integrations/google-calendar/callback` |
| DELETE | `/integrations/{type}` | Desactiva y purga credenciales |

Toda escritura acá genera entrada de auditoría con actor, IP y tipo (sin payload).

### 3.4 CRM (`/customers`)

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/customers?q=&limit=&cursor=` | Búsqueda por nombre (trigram), teléfono, documento o email |
| POST | `/customers` | Alta; valida unicidad de teléfono/email/documento por tenant (409 con referencia al existente) |
| GET | `/customers/{id}` | Ficha completa |
| PATCH | `/customers/{id}` | Edición parcial |
| DELETE | `/customers/{id}` | Soft delete; 409 si tiene facturas (se desactiva, no se borra) |
| GET | `/customers/{id}/history` | Vista unificada: visitas, servicios, facturas, pagos |
| POST | `/customers/{id}/merge` | Une un duplicado (`source_id`) sobre este registro; operación auditada |

### 3.5 Catálogo (`/catalog`)

| Método | Ruta | Descripción |
|---|---|---|
| GET/POST | `/catalog/categories` · PATCH/DELETE `/catalog/categories/{id}` | Categorías con orden |
| GET/POST | `/catalog/services` · PATCH/DELETE `/catalog/services/{id}` | Servicios: precio, IVA, duración, `bookable_by_bot` |

### 3.6 Agenda (`/appointments`)

| Método | Ruta | Descripción | Códigos clave |
|---|---|---|---|
| GET | `/appointments?branch_id=&from=&to=&status=` | Agenda por rango | 200 |
| GET | `/appointments/availability?branch_id=&service_id=&date=` | Slots libres según horario de la sucursal y duración del servicio | 200 |
| POST | `/appointments` | Crea turno (panel). Valida solape según capacidad configurada | 201, 409 (sin disponibilidad) |
| PATCH | `/appointments/{id}` | Reprogramar, cambiar servicio o notas | 200, 409 |
| POST | `/appointments/{id}/confirm` | Confirma un turno `pending` creado por el bot; notifica al cliente | 200, 409 (no está pending) |
| POST | `/appointments/{id}/cancel` | Cancela con motivo opcional; notifica según preferencias | 200 |
| POST | `/appointments/{id}/complete` | Marca atendido; opcionalmente crea borrador de factura (`?draft_invoice=true`) | 200 |

Regla de negocio: los turnos creados por bot nacen `pending` o `confirmed` según `bot_settings.auto_confirm_bookings`; la confirmación manual registra `confirmed_by`.

### 3.7 Bandeja de chat (`/conversations`)

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/conversations?status=&q=&cursor=` | Bandeja ordenada por `last_message_at`; incluye datos del cliente vinculado |
| GET | `/conversations/{id}/messages?cursor=` | Historial paginado hacia atrás |
| POST | `/conversations/{id}/messages` | Envía mensaje como agente (encola a WhatsApp); marca `sender_type=agent` |
| POST | `/conversations/{id}/pause` | Pausa el bot en esa conversación (`status=paused` o `agent` si se autoasigna) |
| POST | `/conversations/{id}/resume` | Reactiva el bot |
| POST | `/conversations/{id}/link-customer` | Vincula manualmente a un cliente (por id); el matching automático usa teléfono, y email/documento como llaves secundarias |
| GET | `/conversations/stream` | **SSE**: eventos `message.new`, `message.status`, `conversation.updated`, `invoice.status` |

Regla de negocio: con la conversación en `paused` o `agent`, el worker no invoca la IA; los mensajes entrantes solo se persisten y notifican.

### 3.8 Bot (`/bot`)

| Método | Ruta | Descripción |
|---|---|---|
| GET/PATCH | `/bot/settings` | Casillas de permisos, textos, auto-confirmación, presupuesto mensual de tokens. PATCH audita cada cambio |
| GET | `/bot/instructions-file` | URL prefirmada S3 de descarga de la última versión |
| PUT | `/bot/instructions-file` | Sube nueva versión (multipart, max 1 MB, `.md`/`.txt`). El backend la guarda como `tenants/<tenant_id>/bot/instructions.md` (clave fija; S3 versioning conserva historial) |
| GET | `/bot/usage` | Consumo del mes: mensajes, tokens, costo estimado |

### 3.9 Facturación (`/invoices`), feature `invoicing`

| Método | Ruta | Descripción | Códigos clave |
|---|---|---|---|
| GET | `/invoices?status=&customer_id=&from=&to=` | Listado | 200 |
| POST | `/invoices` | Crea borrador con items (server recalcula totales e IVA; nunca confía en los del cliente) | 201, 422 |
| GET | `/invoices/{id}` | Detalle con items, pagos y eventos SIFEN | 200 |
| PATCH | `/invoices/{id}` | Edita **solo borradores** | 200, 409 (ya emitida) |
| POST | `/invoices/{id}/issue` | Emite: valida, encola transmisión SIFEN. `Idempotency-Key` requerido | 202, 409, 422 |
| POST | `/invoices/{id}/cancel` | Anula. Body: `{ "reason": "..." }` **obligatorio**. Server decide la vía: evento de cancelación si está dentro de las 48 h de aprobada, si no responde 409 con `type: .../use-credit-note` | 202, 409 |
| POST | `/invoices/{id}/credit-note` | Crea y emite NC electrónica referenciando la factura; motivo obligatorio | 202, 409 |
| POST | `/invoices/{id}/payments` | Registra pago; al completar el total dispara envío del KuDE por WhatsApp/email según preferencia del cliente | 201, 409 (excede saldo) |
| GET | `/invoices/{id}/kude` | URL prefirmada del PDF | 200, 404 |
| POST | `/invoices/{id}/send` | Reenvío manual del comprobante | 202 |

Reglas de negocio críticas: una factura `approved` es inmutable; `cancel` y `credit-note` disparan el email al cliente final con detalle y motivo; la numeración correlativa se asigna al emitir (no al crear el borrador) con lock por punto de expedición para evitar huecos y duplicados.

### 3.10 Webhooks entrantes (`/webhooks`), sin JWT, con verificación propia

| Método | Ruta | Verificación | Acción |
|---|---|---|---|
| GET | `/webhooks/whatsapp` | `hub.verify_token` por tenant | Handshake de Meta |
| POST | `/webhooks/whatsapp` | Firma `X-Hub-Signature-256` (HMAC con app secret) | Dedupe por `wa_message_id`, encola y responde 200 en menos de 1 s |
| POST | `/webhooks/payment` | Firma del proveedor [ABIERTO según pasarela] | Concilia pago de suscripción |
| POST | `/webhooks/sifen` | Según proveedor homologado (opción B) | Actualiza estado del documento |

### 3.11 Plataforma (`/platform/*`), solo `padmin`/`pagent`

| Método | Ruta | Descripción |
|---|---|---|
| GET/POST/PATCH | `/platform/tenants` | Alta, suspensión, datos, plan vigente |
| GET/POST/PATCH | `/platform/plans` y `/platform/features` | Administración de planes: crear, editar precios y límites, activar |
| PUT | `/platform/tenants/{id}/overrides` | Acuerdos a medida: feature, enabled, fee, **nota obligatoria** |
| GET | `/platform/tenants/{id}/usage` | Consumo (mensajes, facturas, tokens IA) |
| GET/POST | `/platform/billing/invoices` | Facturación de la plataforma a tenants |
| GET | `/platform/audit?tenant_id=` | Auditoría transversal |

Los `pagent` tienen lectura y operaciones de soporte; solo `padmin` toca planes, precios y overrides.

### 3.12 Utilitarios

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/health` | Liveness (sin dependencias) |
| GET | `/health/ready` | Readiness: DB, S3, colas |
| GET | `/audit?entity=&entity_id=` | Auditoría del propio tenant (root/admin) |
| POST | `/files/presign` | URL prefirmada de subida (logos), con tipo y tamaño validados |

---

## 4. Contratos de validación

Cada endpoint valida con esquemas **zod** compartidos en `packages/shared` (los mismos que usa el frontend): tipos, formatos (E.164, RUC con dígito verificador, email), rangos y reglas condicionales. La validación es la primera línea; las constraints de la base (documento 03) son la última. Errores de validación siempre 422 con detalle por campo.

## 5. Reglas de negocio transversales en la API

1. **El plan manda:** todo endpoint de una feature pasa por `FeatureGuard`; deshabilitar una feature por impago la apaga en todos los tenants afectados sin deploy.
2. **404 opaco:** pedir un recurso de otro tenant responde 404, indistinguible de inexistente.
3. **Trabajos largos: 202 + SSE.** Nada de requests colgados esperando a SIFEN o a Meta.
4. **Auditoría por diseño:** login, cambios de settings, integraciones, anulaciones, merges y overrides siempre generan entrada de auditoría con actor e IP.
5. **Server recalcula:** totales, IVA, disponibilidad y numeración se calculan siempre en el servidor.
