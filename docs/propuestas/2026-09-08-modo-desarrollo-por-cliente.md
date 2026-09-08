# Modo desarrollo por cliente (check DEV) — 2026-09-08

**Pedido de Johan:** "¿Por qué antes podía emitir comprobantes y ahora no?
Aún estamos en desarrollo, nada en producción, pero las simulaciones necesito
poder visualizarlas completas. En la ficha de cada cliente habilitá una
opción para decidir si la cuenta está en desarrollo o producción, con un
check DEV: si está en DEV no se deben emitir facturas (reales); si está en
producción es correcto que bloquee los tests."

**Causa:** desde el 2026-09-07 emitir exige receptor (RUC o cédula y nombre)
y el panel no deja crear ni emitir sin esos datos; la mayoría de los clientes
de prueba no los tienen cargados.

**Estado:** implementado el 2026-09-08 (migración `20260908100000_tenant_dev_mode`).

| Pieza | Detalle |
|---|---|
| Dato | `control.tenants.dev_mode` (default false para clientes nuevos; los existentes quedaron en true porque ninguno está en producción). `PATCH /platform/tenants/:id { dev_mode }`; `GET /tenant` lo devuelve al panel. |
| Portal admin | Ficha del cliente → casilla "DEV: cuenta en desarrollo" + etiqueta DEV en la cabecera. |
| Panel del negocio | Franja violeta "Cuenta en modo desarrollo…" en todas las pantallas. "Facturar a" deja de ser obligatorio: se puede crear el borrador y emitir sin receptor; si se cargan datos, se guardan igual. |
| API | `issue`: en DEV no exige receptor (va "Consumidor final" al proveedor) ni configuración de SIFEN (timbrado `DEV00000`, punto 001-001). En producción, los 422 de siempre (`billing-missing`, `sifen-not-configured`). |
| KuDE | Leyenda roja "SIMULACION - CUENTA EN MODO DESARROLLO - SIN VALIDEZ FISCAL" arriba y en el pie. |
