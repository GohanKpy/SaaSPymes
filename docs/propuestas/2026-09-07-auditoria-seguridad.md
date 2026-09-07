# Auditoría de seguridad — 2026-09-07

**Pedido de Johan:** "un sistema de logs para auditoría por seguridad de cada acción que efectúan tanto los admin como los clientes, para que al hacer seguimiento a un problema podamos trackear desde admin: qué usuario, desde qué IP, qué acción, fecha y hora, estado anterior, estado nuevo; en el caso de contraseñas no guardar esa información."

**Estado:** implementado el 2026-09-07.

## Qué había

- `app.audit_log`: triggers por fila en las tablas sensibles de cada negocio (clientes, turnos, servicios, facturas, usuarios, ajustes del bot, integraciones y las tablas nuevas) con actor, tipo de actor, acción `tabla.operación`, **antes y después** en JSON. Las contraseñas de usuarios ya se excluían desde el 2026-08-07; la columna `ip` existía pero **nadie la llenaba**.
- `control.platform_audit_log`: anotaciones explícitas de algunas acciones del portal admin (alta de cliente, cambios de ajustes del sistema).
- Nada registraba **intentos de login**, acciones rechazadas, ni qué pedido HTTP causó cada cambio.

## Qué se hizo

| Pieza | Detalle |
|---|---|
| Id por pedido | Un `request_id` (UUID) por petición HTTP (hook `onRequest`). Es el **`trace_id`** que ven los usuarios en cualquier error: con él, en Auditoría se encuentra la acción y sus cambios. |
| IP y navegador en cada fila | `tenantTx` fija `app.ip`, `app.request_id` y `app.user_agent` en la sesión; las cinco funciones de trigger pasan por `app.audit_row()`, que las copia a `app.audit_log` (columnas nuevas `request_id`, `user_agent`; `ip` ahora se llena). |
| Sin secretos, siempre | `app.audit_scrub()` saca de todo antes/después `password_hash`, `totp_secret`, `encrypted_payload`, `token_hash` y `data` (bytes), cualquiera sea la tabla. |
| Registro de acciones | `control.action_log`: toda petición **POST/PUT/PATCH/DELETE** de los paneles de clientes y del portal admin, más los **intentos de login** (exitosos, fallidos, bloqueados) y los pedidos rechazados por token inválido: fecha/hora, cliente, usuario (id, email, rol, origen), IP, navegador, acción (método + ruta), resultado (código y título del error), duración y el **cuerpo enviado redactado** (claves con `pass`, `token`, `secret`, `otp`, `cookie`… valen `"[oculto]"`; textos largos se resumen; tope 6 KB). Se escribe fuera del ciclo del pedido: no lo frena ni lo hace fallar. Quedan fuera los webhooks de Meta, la renovación silenciosa del token y la salud. |
| Pantalla | Portal admin → Seguridad → **Auditoría**. Pestaña **Acciones**: filtros por cliente, usuario (email), texto (acción, IP, trace_id), fechas, origen (panel / portal / sin sesión) y "solo errores"; cada fila se abre y muestra los datos enviados y los **cambios en la base (antes → después)** que causó. Pestaña **Cambios por registro**: por cliente, tipo de dato e id del registro (la historia de un cliente, un turno, una factura). Desde la ficha de un cliente: "Ver auditoría". |

## Cómo se rastrea un problema

1. El usuario reporta un error: pedir el **trace_id** (sale en el mensaje rojo) o el email y la hora aproximada.
2. Auditoría → Acciones → buscar el trace_id (o filtrar por cliente + usuario + fecha).
3. Abrir la acción: se ve qué mandó, qué respondió el sistema y qué filas cambiaron con sus valores anteriores y nuevos.
4. Para seguir un dato puntual (un turno que "desapareció"): pestaña Cambios por registro con el id del turno.

## Límites conocidos

- El registro de acciones no incluye lecturas (GET): solo lo que cambia algo y los logins. Descargar un comprobante o listar clientes no se anota.
- Las acciones del bot (agendar por WhatsApp) sí quedan en `app.audit_log` (actor `bot`) pero no en el registro de acciones HTTP: el webhook de Meta está excluido por volumen.
- Sin retención automática: `control.action_log` crece; definir purga (por ejemplo, 12 meses) cuando haya datos reales.
