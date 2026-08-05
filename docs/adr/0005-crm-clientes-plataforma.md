# ADR 0005 — CRM de clientes de la plataforma: el tenant es la ficha

- Estado: aceptado
- Fecha: 2026-08-04

## Contexto

El dueño del sistema necesita gestionar a sus propios clientes (las PyMEs que
contratan el SaaS) desde el portal admin: datos de contacto, notas comerciales,
y operaciones de soporte como reiniciar la contraseña de un usuario del tenant.
El esquema aprobado (doc 03) no contempla datos de contacto en `control.tenants`
ni una entidad "cliente de la plataforma" separada.

## Decisión

1. **El tenant ES la ficha del cliente** en fase 1. Se agregan a
   `control.tenants` las columnas `contact_name`, `contact_email` (citext),
   `contact_phone` y `notes` (migración `20260806000000_tenant_crm`). La
   asociación tenant↔cliente pedida al crear un tenant se resuelve cargando el
   contacto en el mismo alta.
2. **Ficha en el portal admin** (`/platform/tenants/[id]`): datos CRM
   editables, estado, plan, y la lista de usuarios del tenant.
3. **Reinicio de contraseña desde la ficha**
   (`POST /platform/tenants/:id/users/:userId/reset-password`, solo padmin):
   genera una contraseña temporal que se muestra una sola vez, revoca todas las
   sesiones activas del usuario y queda en `platform_audit_log` sin secretos.

## Alternativa descartada (por ahora)

Una tabla `control.platform_customers` separada con relación 1:N a tenants.
Se difiere hasta que exista el caso real de un cliente con varios tenants;
si aparece, la migración es directa: crear la tabla, mover los campos de
contacto y colgar `tenants.customer_id`.

## Consecuencias

- El alta de tenant admite (opcionalmente) los datos del contacto comercial.
- Las notas internas del dueño viven en el registro del tenant y jamás se
  exponen por endpoints del portal de clientes (`tenantSelfPatch` no las
  incluye y los serializers del scope tenant no las devuelven).
- El reinicio de contraseña reutiliza el mismo mecanismo de temporal-una-vez
  del alta, con revocación de refresh tokens para forzar re-login.
