# ADR 0009 — Empleados agendables (RRHH) y catálogo tipado

- Estado: aceptado (fase 1 implementada; fase 2 planificada)
- Fecha: 2026-08-13

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

### 3. Catálogo tipado (fase 2, diseño cerrado)

El TIPO vive en el producto (no en la categoría, que solo aporta un default
de conveniencia al crear): `kind: servicio | item`. Servicio → `duration_min`
es el tiempo de la TAREA. Ítem → venta pura; con `requiere_reunion` ✓ usa
`meeting_min` (default 30) y el bot coordina una reunión inicial — absorbe el
`bookable_by_bot` actual (migración: true→servicio; false→ítem con reunión).

## Fases

1. (esta) Empleados + asignación + anti-solape + disponibilidad por empleados
   libres + auto-asignación + sección RRHH en el panel.
2. Catálogo tipado + migración de `bookable_by_bot` + UI de categorías.
3. Horarios individuales por empleado, calendario Google propio por empleado,
   elección de profesional por chat.
