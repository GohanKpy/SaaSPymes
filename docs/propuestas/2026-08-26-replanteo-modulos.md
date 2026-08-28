# Replanteo de producto — 2026-08-26 (referencia Bitrix24)

Documento de trabajo aprobable por el dueño; la versión completa con contexto
está en el artifact "Replanteo Inicia PyMEs". Cuando una fase se apruebe e
implemente, sus decisiones de arquitectura van a `docs/adr/` como siempre.

## Ya implementado como cimiento (migración 20260826000000)

- `customer_contact_points`: N teléfonos/emails/webs/redes por cliente, con
  etiqueta y principal (multifield estilo Bitrix).
- `custom_field_defs` + `customers.custom_data`: campos personalizados por
  tenant (text|number|date|boolean|list|money|url) con validación server-side.
  Default mínimo de la ficha: nombre, apellido, celular, email.
- Campos estándar nuevos en `customers`: source/source_detail, company_name,
  job_title, city, tags[], assigned_user_id, marketing_opt_in, rating.
- `customer_activities`: timeline propio (notas + tareas con due_at/done_at).
- Endpoints CRUD completos; filtros por tag/source; suite de aislamiento
  ampliada a 24 tablas.

## Mejoras priorizadas

**P1 — IMPLEMENTADA COMPLETA el 2026-08-28** (aprobada por el dueño; decisiones
de arquitectura en ADR 0010; migraciones 20260828000000/100000/200000, suite de
aislamiento en 27 tablas, smoke 23/23 por tunel y flujo del bot verificado en
vivo) — Ficha CRM nueva en el panel (multifield + campos configurables +
timeline unificado) · Ajustes → Campos del cliente · Bandeja de tareas (el
"Seguimiento:" del bot crea tarea) · Dashboard con KPIs · Recordatorios de
turnos por WhatsApp (plantillas oficiales Meta, tokens por tenant) ·
Reprogramar/cancelar por chat · Fotos de catálogo · Presupuestos formales
(quote → factura).

**P2** — Página pública de auto-reserva · Tablero kanban de oportunidades ·
Stock simple de ítems (cantidad + alerta + descuento al facturar) · Listas de
precios con vigencia · Import/export CSV de clientes · Dup-check por
email/doc · KuDE por WhatsApp/email · Reportes de ventas y caja diaria ·
Vista calendario semanal · No-show por cliente · Plantillas rápidas y
asignación de conversaciones · Cobro de mensualidades a tenants
(platform_invoices).

**P3** — Variantes de producto (SKU) · Unidades de medida · Comisiones por
empleado · Buffers y precio por profesional · Recursos físicos · IG/Messenger
por API oficial Meta · Links de pago (Bancard/Pagopar) · Facturas recurrentes
· Notas de crédito · SIFEN real (certificado + WS SET) · Envío de emails.

## Pendientes para "todo conectado" (control funcional 2026-08-26, 20/20 smoke)

- Del dueño: META_APP_SECRET; phone_number_id + token oficiales por cliente;
  publicar app Google "In production"; su prueba E2E de Calendar; link de
  Meet por negocio; IPs para el padmin (opcional).
- De producción: SIFEN real, emails, pasarela de pagos, worker con tareas
  (hoy vacío), AWS/KMS/TOTP/SQS.
