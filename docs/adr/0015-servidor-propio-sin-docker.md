# ADR 0015 — El sistema corre en el servidor del proveedor, nativo y sin Docker

- Estado: aceptado en su parte DEV (ejecutado 2026-09-24; direcciones
  definitivas 2026-09-29). LIVE (Vercel + Supabase + VPS) sigue como
  propuesta.
- Fecha: 2026-09-29

## Contexto

Pedidos de Johan (2026-09-22 a 2026-09-29):

1. Migrar el sistema del laboratorio Docker de su PC a un servidor del
   proveedor y trabajar desde ahí.
2. **Sin Docker** en esa instancia ("no utilizaremos docker en esta
   instancia", 2026-09-24): decisión cerrada, no se vuelve a preguntar.
3. PostgreSQL **local** en el servidor por ahora; **Supabase después**.
4. Copiar la base del laboratorio al servidor y probar ahí.
5. Reemplazar las direcciones de prueba: `test` → `client`, `test-admin` →
   `admin` (y `test-api` → `api`).

El análisis completo, con dimensionamiento, costos y el LIVE en Vercel +
Supabase, está en
[docs/propuestas/2026-09-22-migracion-dev-servidor-y-live-vercel-supabase.md](../propuestas/2026-09-22-migracion-dev-servidor-y-live-vercel-supabase.md).

Esto se desvía de [docs/plan/06](../plan/06-Infrastructure-Deployment-Diagram.md)
(AWS EC2 + RDS) y de
[docs/plan/11](../plan/11-Local-Development-Environment.md) (laboratorio
Docker como único entorno).

## Decisión

- El sistema corre en el **servidor del proveedor** (Ubuntu 26.04 LTS,
  4 vCPU, 7,2 GB RAM), **nativo**: Node 24 con `fnm`, pnpm 10, PostgreSQL 17
  de pgdg en `localhost:4302`, servicios `systemd` bajo un usuario sin
  privilegios (`dev`) y `cloudflared` nativo.
- Se publica por el túnel Cloudflare `pymes-test`, administrado localmente,
  en `client.inicia.com.py`, `admin.inicia.com.py` y `api.inicia.com.py`.
  Las direcciones `test*` quedan como alias. El firewall solo deja entrar SSH.
- Mismos puertos que el laboratorio (4300 web, 4301 API, 4302 Postgres, 4307
  Mailpit, 4308 webadmin; ADR 0001), para que la configuración sea la misma.
- La base es una copia del laboratorio con las integraciones reales cortadas
  (WhatsApp real, Google Calendar y SMTP de plataforma). Se reactivan a
  pedido: ver [docs/operacion/servidor.md](../operacion/servidor.md) §5.
- El laboratorio Docker (`docker-compose.dev.yml`) sigue siendo el entorno de
  desarrollo en la PC, pero ya no sale a internet: los hostnames apuntan al
  servidor.
- Las reglas del proyecto no cambian: aislamiento con RLS, suite de
  aislamiento verde antes de declarar terminado, nada hardcodeado (las
  direcciones van por `WEB_ORIGIN`, `PUBLIC_API_URL` y `NEXT_PUBLIC_API_URL`).

## Consecuencias

- Operación, despliegue y rollback de DNS: [docs/operacion/servidor.md](../operacion/servidor.md).
- El servidor hoy cumple el papel de entorno principal **con datos de
  prueba**. Antes de atender clientes reales hay que:
  - recopiar o limpiar la base;
  - activar respaldos automáticos;
  - cargar los secretos reales (Meta, llave de IA, SMTP);
  - decidir si el LIVE va a Vercel + Supabase según la propuesta. La
    propuesta desaconseja producción en la misma máquina que DEV, salvo su
    "plan B" (§7.5).
- `NEXT_PUBLIC_API_URL` se compila dentro del front: cambiar de dirección
  exige recompilar con `--force`.
- Las URIs de Google OAuth dependen de `PUBLIC_API_URL` y deben estar
  registradas en Google Cloud.
- Pendiente del plan original: actualizar docs/plan/06 y /11 cuando se
  decida el LIVE. Hasta entonces, este ADR es la fuente de verdad del
  entorno desplegado.
