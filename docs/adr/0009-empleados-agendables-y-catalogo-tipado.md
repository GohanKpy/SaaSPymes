# ADR 0009 — Empleados agendables (RRHH) y catálogo tipado

- Estado: aceptado (fases 1, 2 y 3 implementadas)
- Fecha: 2026-08-13 (fases 2 y 3: 2026-08-17)

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

### 4. Fase 3 (implementada 2026-08-17)

- **Horario propio**: `employees.schedule` (mismo formato que el de la
  sucursal: week + closed_dates como días libres/vacaciones); NULL = usa el
  horario del negocio. La grilla de slots sigue saliendo del horario de la
  SUCURSAL: el horario del empleado filtra adentro (nunca ofrece fuera del
  horario de atención). Disponibilidad = hay al menos un agendable en su
  franja, sin turno ni bloqueo personal (los turnos sin asignar se
  descuentan). Asignar a alguien fuera de su horario da 409 con el motivo.
- **Google Calendar por empleado**: filas adicionales de
  `integration_credentials` con `employee_id` (unicidad tenant+type+employee
  NULLS NOT DISTINCT). El root genera el link OAuth por empleado y puede
  abrirlo o pasárselo (state cifrado TTL 10 min con el employee_id). Ida: el
  turno se copia también al calendario del asignado
  (`appointments.employee_google_event_id`). Vuelta: el barrido por CONEXIÓN
  importa eventos ajenos como `calendar_blocks.employee_id` (bloquean solo a
  esa persona). Borrar nuestro evento del calendario del NEGOCIO cancela el
  turno; borrarlo del calendario del empleado se ignora (la agenda del
  negocio manda). Unicidad de blocks tenant+evento+empleado NULLS NOT
  DISTINCT (misma cuenta conectada dos veces no colisiona).
- **Elección de profesional por chat**: `get_available_slots` y
  `book_appointment` aceptan `empleado` (nombre); el server lo resuelve con
  match único normalizado (nombre completo o de pila) contra los agendables
  y ata slots + reserva a esa persona. El prompt recibe la sección EQUIPO
  (únicos nombres válidos) y la regla de no inventar nombres ni elegir por
  su cuenta. Nombre no reconocido → error accionable con el equipo real.

## Fases

1. Empleados + asignación + anti-solape + disponibilidad por empleados
   libres + auto-asignación + sección RRHH en el panel. ✔
2. Catálogo tipado + migración de `bookable_by_bot` + UI de categorías. ✔
3. Horarios individuales por empleado, calendario Google propio por empleado,
   elección de profesional por chat. ✔
