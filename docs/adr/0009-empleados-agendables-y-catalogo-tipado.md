# ADR 0009 — Empleados agendables (RRHH) y catálogo tipado

- Estado: aceptado (fases 1 y 2 implementadas; fase 3 pendiente)
- Fecha: 2026-08-13 (fase 2: 2026-08-17)

## Contexto

Pedido del dueño (2026-08-13): los turnos deben asignarse a un empleado del
negocio; un empleado no puede estar en dos eventos a la vez; hace falta una
sección de RRHH con la planilla básica; y el catálogo debe distinguir
servicios (con tiempo de tarea) de ítems de venta (con reunión opcional).
El doc 03 §3.3 ya anticipaba el modelo de "recursos agendables
(empleados/boxes)"; este ADR lo concreta.

## Decisión

### 1. Empleado ≠ usuario del panel

`app.employees` es la ficha de RRHH (identificación, contacto, laborales,
IPS, contacto de emergencia, salario) con un flag **`bookable`**: solo los
agendables participan de la agenda. Vínculo OPCIONAL `user_id` a `app.users`
para cuando el empleado además tiene login. Salario visible solo para
root/admin del tenant (el rol staff no lee la ficha completa).

### 2. Asignación y anti-solape

- `appointments.employee_id` (nullable): turno asignado a un empleado.
- Regla dura: un empleado no puede tener dos turnos vigentes solapados. Se
  impone server-side con el patrón ya probado de la numeración de facturas:
  `pg_advisory_xact_lock(tenant:empleado)` + chequeo de solape dentro de la
  MISMA transacción de la reserva. Concurrencia resuelta sin extensiones de
  Postgres (se evaluó EXCLUDE USING gist; requiere btree_gist y no suma
  frente al advisory lock con un único escritor que es la API).
- **Disponibilidad**: si el tenant tiene empleados agendables activos, la
  capacidad de cada franja pasa a ser "cantidad de empleados libres" (el
  `SLOT_CAPACITY` fijo queda solo para tenants SIN empleados cargados: el
  unipersonal sigue funcionando sin fricción).
- **Auto-asignación**: si la reserva no trae empleado (bot, o panel en
  "Auto"), se asigna el empleado agendable libre con menos turnos ese día.
  El panel permite elegirlo explícitamente; elegir uno ocupado da 409 con
  el motivo. La elección por el cliente final via chat queda para fase 3.
- El evento de Google Calendar incluye quién atiende.

### 3. Catálogo tipado (fase 2, implementada 2026-08-17)

El TIPO vive en el producto (no en la categoría, que solo aporta un default
de conveniencia al crear): `kind: servicio | item`. Servicio → `duration_min`
es el tiempo de la TAREA. Ítem → venta pura; con `requires_meeting` ✓ usa
`meeting_min` (default 30 en código) y el bot coordina una reunión inicial —
absorbió `bookable_by_bot` (migración 20260817: true→servicio; false→ítem con
reunión heredando `duration_min` como `meeting_min`; la columna se eliminó).

Detalles de implementación:

- Regla universal intacta: TODO el catálogo se coordina por chat. En un ítem,
  `requires_meeting` solo decide si el bot OFRECE la reunión por iniciativa
  propia; con ✗ la agenda igual si el cliente lo pide (regla 2026-08-16 del
  dueño: jamás "no se agenda por chat").
- La duración efectiva del turno la resuelve `slotDurationMin()` en
  appointments.service: tarea del servicio o reunión inicial del ítem.
- `list_services` del bot expone `tipo`, `durationMin` (solo servicio),
  `requiereReunion` y `reunionInicialMin` (solo ítem); ya no existe
  `agendable`.
- Al crear/editar, la API normaliza por tipo: servicio sin datos de reunión,
  ítem sin duración de tarea.
- UI de categorías propia en Catálogo: alta/edición con tipo por defecto,
  conteo de productos y eliminación protegida (409 con productos activos).

## Fases

1. (esta) Empleados + asignación + anti-solape + disponibilidad por empleados
   libres + auto-asignación + sección RRHH en el panel.
2. Catálogo tipado + migración de `bookable_by_bot` + UI de categorías.
3. Horarios individuales por empleado, calendario Google propio por empleado,
   elección de profesional por chat.
