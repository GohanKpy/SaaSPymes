# ADR 0007 — Sincronización con Google Calendar (diseño; implementación fase 2)

- Estado: aceptado (diseño); implementación planificada
- Fecha: 2026-08-05

## Contexto

Pedido del dueño del sistema: la agenda interna debe reflejarse en el Google
Calendar del negocio automáticamente — cada turno agendado se escribe en su
calendario, cada cancelación lo quita — y la conexión debe hacerse **una sola
vez**, sin re-autenticación periódica.

## Decisión

### 1. Conexión sin re-autenticación (la clave está en OAuth bien hecho)

- **OAuth 2.0 authorization code** con `access_type=offline` y
  `prompt=consent`: Google entrega un **refresh token** de larga vida que
  permite renovar el access token (60 min) indefinidamente, sin intervención
  del usuario.
- **Requisito crítico**: la app OAuth en Google Cloud Console debe estar
  **publicada "In production"**. En estado "Testing" los refresh tokens
  caducan a los 7 días — esa es la causa típica de "me pide reconectar cada
  semana". Scope mínimo: `https://www.googleapis.com/auth/calendar.events`
  (no requiere verificación de Google por ser scope no-restringido).
- El refresh token muere solo si: el usuario revoca el acceso, cambia la
  contraseña de Google en ciertos casos, o pasa **6 meses sin uso**. Como el
  worker lo usa en cada sync, el caso "sin uso" no ocurre en la práctica.
- Ante `invalid_grant` (revocación real): la integración pasa a estado
  `disconnected`, el panel muestra "Reconectar Google Calendar" y avisa por
  la bandeja. Es el único escenario de re-autenticación.

### 2. Almacenamiento

- `integration_credentials` tipo `google_calendar` (tabla existente):
  refresh token en `encrypted_payload` (AES-256-GCM, igual que WhatsApp),
  `public_config` = { calendar_id, connected_email, status }. Por tenant en
  fase A; por sucursal o por profesional cuando lleguen los "recursos
  agendables" (doc 03 §3.3).
- Access tokens NO se persisten: se renuevan en memoria y se descartan.

### 3. Flujo de sincronización (interno → Google)

- `appointments` gana columna `google_event_id` (migración aditiva).
- Eventos del ciclo de vida del turno (crear/confirmar/cancelar/reagendar)
  encolan un job `calendar.sync` en SQS; el **worker** (ya existente) lo
  procesa: insert/patch/delete del evento vía Google Calendar API, con
  reintentos exponenciales y sin bloquear jamás la reserva del cliente.
- Idempotencia: el job lleva appointment_id + versión; si el turno cambió
  antes de procesarse, se sincroniza el estado final.
- El evento en Google lleva: servicio, cliente (nombre + teléfono), sucursal
  y un link al panel. Zona horaria del tenant.

### 4. Sentido inverso (Google → interno), fase B

- **Watch channels** de Google Calendar (push a un webhook nuestro) para
  detectar borrados/movidos hechos a mano en Google: si el dueño borra el
  evento, el turno interno se cancela y el slot se libera (regla pedida:
  "si se cancela algo, liberar el turno").
- Los channels caducan (~7 días máx): el worker los **renueva
  automáticamente** con un job programado — el usuario nunca se entera.
  Fallback: reconciliación incremental con `syncToken` cada hora.

### 5. Qué NO hace (por diseño)

- No se leen calendarios personales para bloquear agenda interna (fase C si
  se pide: freebusy query con el mismo token).
- Nada de Google entra al prompt del bot: el bot sigue consultando SOLO la
  agenda interna; Google es un espejo.

## Plan de implementación (cuando Johan lo priorice)

1. Migración `google_event_id` + credencial `google_calendar` + env
   `GOOGLE_CLIENT_ID/SECRET` (config del dueño, panel admin como ADR 0003).
2. Endpoints connect/callback/disconnect + UI en Ajustes del tenant.
3. Jobs `calendar.sync` en worker + cola (se aprovecha el pase a SQS del
   hardening #19).
4. Fase B: watch channels + renovación + reconciliación.

Prerequisito operativo: cuenta Google Cloud del proyecto con OAuth consent
screen publicada en producción (sin esto, re-auth cada 7 días garantizada).
