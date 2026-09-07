# Turnos con varios servicios y clientes con varios RUC — 2026-09-07

**Estado:** aprobado por Johan ("planifica todo y empecemos con la implementación"), en implementación.
**Origen:** pedidos de Johan del 2026-09-07 tras probar el panel con Massi.

## Pedidos y decisión

| Pedido | Decisión |
|---|---|
| En Agenda solo deben aparecer servicios; los productos que no se agendan, no | El selector de la Agenda filtra `kind === 'servicio'`. Los ítems siguen agendándose solo por el bot como "reunión inicial" (ADR 0009), que es otro flujo. |
| Agendar varios servicios en un turno | Nueva tabla `app.appointment_services` (uno o más servicios por turno, con orden y minutos congelados). `appointments.service_id` sigue siendo el principal (el primero) para compatibilidad: bot, historial, facturar desde la agenda. |
| Reducir el tiempo cuando se combinan servicios | Nuevo campo por servicio: **"Duración cuando se combina con otro servicio"** (`services.combo_duration_min`, vacío = la completa). Regla: el servicio más largo cuenta entero; cada otro suma su duración combinada (o la completa si no tiene). El panel muestra el total calculado y deja **ajustarlo a mano** antes de buscar horario. |
| Facturar a nombre de otra persona; varios RUC por cliente | Nueva tabla `app.customer_fiscal_ids` (RUC o CI + razón social / nombre, con predeterminado). En la ficha del cliente se administran; al crear la factura se elige una, o se carga una nueva (con opción de guardarla en la ficha). |
| Si el cliente no tiene RUC ni razón social, pedirlos al crear la factura | El formulario de factura exige "Facturar a" siempre: si el cliente no tiene documento propio ni identidades guardadas, pide los datos ahí mismo. El servidor lo exige al **emitir** (un borrador puede quedar sin datos, p. ej. el que nace de un presupuesto, y se completa desde el detalle). |
| A nombre de quién salió cada factura | La factura congela `billing_name`, `billing_doc_type`, `billing_doc_number`, `billing_ruc_dv` al crearse (dato fiscal); la emisión y el comprobante (KuDE) leen eso. Facturas viejas sin snapshot: se usa el documento del cliente, como hasta ahora. |
| El botón Copiar de las credenciales no copia | `navigator.clipboard` falla fuera de HTTPS/localhost y el código no tenía respaldo ni aviso. Helper `copiarTexto` con respaldo (`execCommand`) y aviso de error; formato en una línea: `Usuario: alfredo | Contraseña: AsQ123`. |

## Fuera de alcance (se anota para después)

- El bot sigue agendando **un** servicio por turno (crea igual su fila en `appointment_services`). Que el bot combine servicios es un cambio del prompt y las tools que conviene medir con la batería aparte.
- Cambiar los servicios de un turno ya agendado (hoy: cancelar y agendar de nuevo, o reprogramar).
- Consumidor final sin RUC (44444401-7): no pedido; hoy se exige documento.

## Aislamiento

Las dos tablas nuevas nacen con `tenant_id`, RLS `ENABLE`+`FORCE`, FK compuestas `(tenant_id, id)` y su fila en la suite `packages/db/src/tests/isolation.test.ts` (caso 4/5 y un caso 3c: un servicio de B no se puede colgar de un turno de A).

## Orden de trabajo

1. Esquema + migración `20260907000000_turnos_multiservicio_y_ruc_multiples` + suite de aislamiento.
2. DTOs compartidos (catálogo, turnos, clientes, facturas).
3. API: catálogo, disponibilidad y alta de turnos multi-servicio, identidades fiscales, borrador/emisión/KuDE con snapshot.
4. Panel: Agenda (solo servicios, varios, duración), Catálogo (campo nuevo), ficha del cliente (RUCs), Facturación ("Facturar a"), Copiar.
5. `pnpm test`, build, deploy, verificación con curl en el tenant QA, manual del asistente.
