# PyMEs SaaS

SaaS de gestión integral para PyMEs (Paraguay). La arquitectura aprobada vive en
[docs/plan](docs/plan/README.md) y es la fuente de verdad; los desvíos requieren
ADR en `docs/adr`.

## Estructura

```
apps/
  web/          Next.js 15 (panel tenants + panel admin + sitio)
  api/          NestJS + Fastify (REST + webhooks + SSE)
  worker/       NestJS standalone (consumidores SQS)
packages/
  db/           schema Prisma + migraciones + seeds
  shared/       tipos, DTOs zod, constantes, env
  invoicing/    interfaz InvoicingProvider + implementaciones
  wa/           cliente WhatsApp Cloud API
  botengine/    orquestacion Claude + tools
infra/local/    laboratorio Docker (docs/plan/11)
```

## Laboratorio local (docs/plan/11)

Requisitos: Node ≥ 22, pnpm 10 (`npm i -g pnpm@10`), Docker con Compose.

```bash
cp .env.local.example .env.local
pnpm install
docker compose -f docker-compose.dev.yml up -d --build
```

Puertos de host: bloque dedicado **4300–4307** para no colisionar con otros
proyectos ([ADR 0001](docs/adr/0001-bloque-puertos-laboratorio-local.md)):
web en `localhost:4300`, API en `localhost:4301/health`, Postgres en
`localhost:4302` (base `pymes`), MinIO en `localhost:4303` (consola `4304`),
ElasticMQ en `localhost:4305`, Mailpit SMTP en `localhost:4306` (UI `4307`).
Dentro de la red de Docker rigen los puertos canónicos (`db:5432`, etc.).

## Scripts

| Comando          | Qué hace                                    |
| ---------------- | ------------------------------------------- |
| `pnpm dev`       | Apps en modo watch (requiere env exportado) |
| `pnpm build`     | Build de todas las apps y packages          |
| `pnpm typecheck` | `tsc --noEmit` en todo el monorepo          |
| `pnpm lint`      | ESLint con la config compartida             |
| `pnpm test`      | Tests (aún no hay: llegan con fase 1)       |

Para `pnpm dev` fuera de Docker: `set -a && source .env.local && set +a && pnpm dev`
(con los hosts de `.env.local` cambiados a `localhost` y el puerto de host del
bloque: ej. `db:5432` → `localhost:4302`). Web y API igual escuchan en 4300/4301.
