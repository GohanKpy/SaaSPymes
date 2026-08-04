# ADR 0004 · Portal de plataforma separado del portal de clientes

**Fecha:** 2026-08-04
**Estado:** aceptado (decision del negocio)

## Contexto

El doc 01 §5 preveia un solo frontend sirviendo panel de tenants y panel
admin. El negocio pidio que el portal del dueño del sistema tenga un link
de acceso distinto al de los clientes y quede preparado para restringirse
a IPs especificas (la restriccion concreta se aplicara despues).

## Decision

Una sola aplicacion Next.js, desplegada como **dos instancias en modo
distinto** (variable `PORTAL`), cada una con su puerto/hostname:

- **Portal clientes** (`PORTAL=client`, puerto 4300 local): sirve login de
  tenants, panel de empresa y chat de prueba. Toda ruta `/platform/*`
  redirige fuera: el portal admin ni siquiera es visible.
- **Portal plataforma** (`PORTAL=admin`, puerto 4308 local): sirve SOLO
  `/platform/*` con su propio login (`/platform/login`); cualquier otra
  ruta redirige al panel admin.

El middleware de Next aplica la particion en el servidor. En produccion
cada instancia va detras de su hostname (ej. `admin.<dominio>` vs
`app.<dominio>`) y la restriccion por IP se aplica en el perimetro
(Cloudflare Access / WAF, doc 05 §7) sobre el hostname admin.

Defensa en profundidad en la API: `PLATFORM_ALLOWED_IPS` (lista de IPs o
CIDRs) restringe los endpoints `/platform/*` y el login de plataforma;
vacia = sin restriccion (laboratorio). Fuera de la lista responde 404
opaco.

## Consecuencias

- Los clientes no pueden llegar al login del dueño ni por URL directa.
- La restriccion por IP tiene dos capas independientes (perimetro + API).
- Un solo codebase y una sola imagen Docker: la separacion es despliegue,
  no duplicacion. El puerto 4308 se suma al bloque del ADR 0001.
