# Proyecto: SaaS de Gestion para PyMEs (Paraguay)

## Que es y para quien

Plataforma SaaS multitenant de gestion integral para PyMEs de servicios de
Paraguay (ejemplo: peluquerias, talleres, consultorios, etc): CRM, catalogo tipado, agenda
con empleados agendables, bandeja de WhatsApp con bot de IA que atiende y
agenda solo, y facturacion electronica SIFEN. Dos audiencias: los tenants
operan en el portal de clientes; el dueno de la plataforma administra tenants,
planes, overrides y el motor del bot desde un portal admin separado (ADR 0004).
Planes y features son datos, no codigo: se gestionan desde el panel admin.
Agendar turnos en Calendario local y con opcion de cincronizar con google calendar.

## Fuente de verdad

- `docs/plan` (11 documentos): la arquitectura aprobada. Antes de cualquier
  tarea, leer el documento relevante.
- `docs/adr` (0001–0009): desvios aceptados del plan.
- `docs/mapa-arquitectura.md`: mapa del estado real del codigo (orientacion
  rapida: componentes, modulos, estado vs roadmap).

## Stack y estructura

TypeScript de punta a punta; monorepo pnpm + Turborepo; Node >= 22.

- `apps/web` — Next.js 15. Una app, dos portales via `PORTAL` (clientes :4300,
  admin :4308).
- `apps/api` — NestJS + Fastify: REST `/api/v1`, webhooks firmados, SSE. Hoy
  tambien corre el bot y la sync de Google Calendar in-process.
- `apps/worker` — NestJS standalone; vacio (heartbeat) hasta el pase a SQS.
- `packages/db` — Prisma (esquemas `control` + `app`), migraciones, seed,
  `tenantTx()` y la suite de aislamiento SQL.
- `packages/shared` — DTOs zod (unica definicion de formas de datos) y
  `env.ts` (la app no arranca con config incompleta).
- `packages/botengine` — motor del bot multiproveedor OpenAI/Anthropic
  (ADR 0002), tools server-side y prompt en 3 capas (ADR 0008).
- `packages/wa` / `packages/invoicing` — cliente WhatsApp Cloud API y
  `InvoicingProvider` (fake en laboratorio).

Laboratorio local: `docker-compose.dev.yml`, puertos host **4300–4308**
(ADR 0001); nunca 3000/3001/5432. Postgres 16 con RLS real, MinIO, ElasticMQ,
Mailpit. Arranque y credenciales de seed: README.md.

Servidor (ADR 0015, desde 2026-09-24): el sistema corre en el servidor del
proveedor, nativo y **sin Docker** (decisión cerrada), con Postgres 17 local
(Supabase más adelante), publicado en `client/admin/api.inicia.com.py`.
Despliegue, túnel, integraciones cortadas y diagnóstico:
`docs/operacion/servidor.md`. Estado y pendientes: `docs/estado/`. Regresión
completa contra el servidor: skill `testear-servidor`.

## Regla numero uno: aislamiento estricto entre tenants

El cruce de datos entre tenants mata el negocio (docs/plan/05). Cuatro
barreras, todas obligatorias siempre:

1. El `tenant_id` sale SOLO del JWT; jamas del body o query.
2. Toda operacion de datos de tenant corre dentro de `AppPrisma.tx()` /
   `tenantTx()` (fija `app.tenant_id` con SET LOCAL).
3. RLS `ENABLE`+`FORCE` con fallo cerrado en TODAS las tablas del esquema
   `app`. Toda tabla nueva nace con `tenant_id`, politica `tenant_isolation`,
   FK compuesta `(tenant_id, id)` y su caso en la suite de aislamiento.
4. 404 opaco: un recurso de otro tenant responde igual que uno inexistente.

**Ninguna tarea que toque datos se declara terminada sin correr la suite de
aislamiento multitenant (docs/plan/08 §2)**: capa SQL en
`packages/db/src/tests/isolation.test.ts` y capa API en
`apps/api/test/isolation-api.e2e.test.ts`; se ejecutan con `pnpm test` con el
laboratorio levantado. En rojo bloquea el merge.

## Reglas

- Nunca editar migraciones ya aplicadas (siempre migracion nueva,
  expand-and-contract).
- Todo desvio de la arquitectura requiere un ADR en `docs/adr`.
- Ningun endpoint, bucket, cola ni host va fijo en el codigo (docs/plan/11).
  Config del sistema → panel padmin (`platform_settings`); config del
  cliente → su panel; en codigo solo `DEFAULT_*` y pisos tecnicos.
- Dinero en `bigint` (guaranies sin decimales, jamas floats) + `currency`;
  tiempos en `timestamptz` UTC.
- Los DTOs zod de `packages/shared` son la unica definicion de formas de
  datos; el server siempre recalcula (totales, IVA, disponibilidad,
  numeracion).
- Bot: un permiso apagado = la herramienta NO existe para el modelo; toda
  tool ejecuta amarrada a tenant + conversacion bajo RLS y se registra en
  `bot_tool_calls`. Tras cambios de comportamiento, correr la bateria
  (skill `testear-bot`; guia en la memoria `guia-bot-whatsapp`).
- Secretos cifrados (envelope) en `integration_credentials` /
  `platform_settings`; jamas en logs, audit log ni respuestas de la API.
