# Cuenta mensual, servicios recurrentes y formato de miles — 2026-09-07

**Estado:** implementado y desplegado en el laboratorio el 2026-09-07 (verificado en el tenant QA: consumo automático al marcar Atendido, resumen y factura por email en Mailpit, link público del comprobante, cierre de mes a pedido e idempotente, turno recurrente generado y confirmado con "si" por el webhook).

## 1. Formato de miles en los campos de dinero

Todo campo donde se escribe un monto en guaraníes (precio del catálogo, líneas
de factura y presupuesto, monto recibido en un pago, salario, precio de un
plan, consumo manual) usa el componente `MoneyInput`: se tipea `150000` y se
ve `150.000` mientras se escribe. El servidor ya aceptaba el formato con puntos
(`montoGs`), así que el valor viaja tal cual.

## 2. Cuenta mensual (facturar todo el mes de una vez)

| Pieza | Decisión |
|---|---|
| Preferencias del cliente | En la ficha: **Facturación** = por servicio (hoy) o **cuenta mensual**; **Recibe las facturas por** WhatsApp o email; avisos por WhatsApp / email (ya existían, se muestran juntos). Columnas `customers.billing_mode`, `customers.invoice_channel`. |
| Consumos pendientes | Tabla `app.customer_charges` (cuenta corriente): al marcar **Atendido** un turno de un cliente mensual, sus servicios pasan a consumos pendientes con el precio del catálogo de ese momento. Los artículos comprados se cargan a mano desde la ficha ("Agregar consumo"). Cada consumo guarda fecha, descripción, cantidad, precio, IVA, origen y estado (pendiente / facturado / anulado). |
| Facturar el mes | Pestaña **Cuentas del mes** en Facturación: clientes con saldo pendiente, detalle, "Enviar resumen" y **"Facturar el mes"** (una factura con todos los consumos, a nombre del RUC predeterminado o el que se elija; opción de emitir ya y enviar al cliente por su canal). Los consumos quedan marcados como facturados con el número de factura. |
| Cierre automático | Ajustes → Facturación: **día de cierre** (1 a 28; por defecto el 1) y **facturar automáticamente** (apagado por defecto). Un trabajo horario, en la fecha de cierre según la zona horaria del negocio, arma el **resumen del mes anterior** por cliente (`app.billing_statements`, uno por cliente y mes: idempotente), se lo envía al cliente por su canal, avisa al dueño (tarea en Tareas + correo a los emails de aviso del negocio) y, si el negocio activó facturar automáticamente, emite la factura y la envía. |
| Envío al cliente | **WhatsApp**: mensaje del sistema en su conversación (visible en la bandeja; con envío real sale por la Cloud API) con el resumen y, para la factura, número, total y un **link firmado y con vencimiento** al comprobante PDF (`/public/kude?t=<token>`, sin login, 30 días). **Email**: correo con el resumen y el PDF adjunto, vía SMTP. |
| Correo saliente | Nuevo en el portal admin → Sistema → **Correo saliente** (servidor, puerto, usuario, contraseña cifrada, remitente). Sin configurar, rige `SMTP_HOST` del entorno (Mailpit en el laboratorio). |
| Comprobante sin pago | La regla "el KuDE se entrega recién con el pago" sigue para el botón del panel. La cuenta mensual **envía la factura para que la paguen**: ese envío usa el comprobante aunque esté impaga (es la razón del envío). |

## 3. Servicios recurrentes

| Pieza | Decisión |
|---|---|
| Definición | Tabla `app.recurring_bookings`: cliente, servicios, profesional (opcional), frecuencia **semanal / cada dos semanas / mensual**, día (de la semana o del mes, 1 a 28), hora, duración, desde / hasta, activo. Se crea desde la ficha del cliente ("Servicios recurrentes") o desde la Agenda con "Repetir…" sobre un turno. |
| Generación | Un trabajo horario crea el próximo turno **X días antes** (Ajustes → Horarios → "Turnos recurrentes: crear y avisar N días antes", por defecto 7), estado *a confirmar*, nota "Turno recurrente". Si el horario ya no está libre, no se crea y queda una tarea para el dueño con el motivo. |
| Confirmación del cliente | Al crearlo se le escribe por WhatsApp: "te agendamos X el día D a las H, ¿lo confirmás? Respondé SÍ para confirmar o NO para cancelarlo". La respuesta **SÍ / NO se resuelve en forma determinística** antes de que intervenga el bot (sin cambios en el prompt): SÍ confirma el turno y responde "Listo"; NO lo cancela y responde. Cualquier otra respuesta sigue su curso normal con el bot. |
| Agenda | Los turnos recurrentes se marcan "recurrente" y, mientras esperan respuesta, "esperando confirmación del cliente". |

## Fuera de alcance (anotado)

- Consumidor final sin RUC en la factura mensual (hoy exige receptor, como toda factura).
- Enviar el PDF como documento adjunto por WhatsApp (la Cloud API lo permite; requiere subir el archivo a Meta): hoy va como link firmado.
- Que el cliente cambie sus preferencias por chat (hoy las carga el negocio en la ficha).
- Reintentos del envío de correo (queda registrado el error en el log; pasa a la cola con el hardening #19).

## Aislamiento

Las tablas nuevas (`tenant_settings`, `customer_charges`, `billing_statements`, `recurring_bookings`) nacen con `tenant_id`, RLS `ENABLE`+`FORCE`, FK compuestas y su fila en la suite. El endpoint público del comprobante no recibe tenant ni id en claro: el token es un JSON cifrado (AES-GCM) con tenant, factura y vencimiento; se abre con la sesión de sistema de ese tenant.
