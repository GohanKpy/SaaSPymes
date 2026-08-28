# ADR 0010 — P1 del replanteo 2026-08-26: decisiones de implementacion

**Fecha:** 2026-08-28 · **Estado:** aceptado · **Contexto:**
docs/propuestas/2026-08-26-replanteo-modulos.md (fase P1 aprobada por el dueño
el 2026-08-28).

## Decisiones

### 1. Fotos de catalogo en Postgres (bytea), no en S3 todavia

El plan (docs/plan/11) preve S3/MinIO para archivos. P1 guarda las fotos de
catalogo en `app.service_photos` como `bytea` con pisos tecnicos en codigo
(`DEFAULT_MAX_PHOTO_BYTES` 1.5 MB, `DEFAULT_MAX_PHOTOS_PER_SERVICE` 5).

- Por que: a escala laboratorio (decenas de productos por tenant) el costo es
  irrelevante y evita traer el SDK de AWS, buckets configurables y presigned
  URLs antes de tiempo. El contrato de la API (subir data URL, servir bytes
  por id inmutable con cache privado) NO cambia con el pase a S3: es solo un
  backend de almacenamiento distinto, en el hardening de produccion.
- Auditoria: variante `app.row_audit_sin_data()` — el audit_log registra el
  hecho sin los bytes (mismo criterio que `row_audit_credentials` con
  `encrypted_payload`).

### 2. Presupuestos como espejo liviano SIN caracter fiscal

`app.quotes`/`app.quote_items` duplican la forma de invoices/invoice_items en
chico: numeracion comercial simple por tenant (`P-0001`, advisory lock, sin
huecos fiscales que cuidar), items congelados al guardar, totales SIEMPRE
recalculados server-side con el mismo helper de facturas (`resolveItems` /
`taxPortion` exportados de invoices.service). La conversion crea un BORRADOR
de factura y el circuito fiscal (emitir/pagar/KuDE) sigue identico. Un
presupuesto facturado o rechazado es inmutable; solo los borradores se editan
o borran.

### 3. Recordatorios de turno in-process en la API

Mismo patron que InactivityService y la sync de Calendar: barrido cada 5 min
por tenant, hasta que el worker/SQS del hardening lo absorba (#19). Config del
negocio en `bot_settings` (activado, horas de anticipacion 1–72, nombre de
plantilla Meta del tenant, idioma). El recordatorio entra a la conversacion
del cliente como mensaje `system` (visible en la bandeja) y sale por el
pipeline normal de WaSender; con envio real y plantilla configurada va como
plantilla oficial de Meta (`sendTemplate` en @pymes/wa — unica via fuera de
la ventana de 24 h), sin plantilla como texto. Un turno se recuerda a lo sumo
UNA vez (`appointments.reminder_sent_at` se marca aun si no se pudo enviar,
para no re-escanear).

### 4. Bandeja de tareas alimentada por el resumen del bot

La linea "Seguimiento:" del resumen de conversaciones inactivas crea una
`customer_activity` tipo `seguimiento` con vencimiento a 24 h. Un solo
seguimiento abierto creado por el sistema por cliente (`created_by IS NULL`):
el resumen siguiente lo refresca en vez de acumular duplicados.

### 5. Cancelar/reprogramar por chat: cancelar+crear en UNA transaccion

`reschedule_appointment` cancela el turno viejo y crea el nuevo dentro de la
misma transaccion: `createInTx` re-valida solapes bajo advisory lock, y si el
horario nuevo fallo, el rollback deja el turno original intacto. Ambas tools
viven bajo el permiso de agenda (`allow_booking`) y solo alcanzan turnos
propios, futuros y vigentes del cliente de la conversacion (guard
server-side, jamas por prompt).

## Consecuencias

- Migraciones 20260828000000 (fotos), 20260828100000 (presupuestos),
  20260828200000 (recordatorios); suite de aislamiento en 27 tablas.
- El pase a S3 y a SQS quedan como deuda explicita del hardening de
  produccion, sin cambio de contrato para el panel ni el bot.
