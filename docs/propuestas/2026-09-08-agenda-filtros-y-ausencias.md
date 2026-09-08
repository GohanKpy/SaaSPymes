# Agenda: filtros y ausencias de empleados — 2026-09-08

**Pedidos de Johan:**

1. "En agenda, agregar filtros para filtrar por empleado o por cliente, en caso
   de que la agenda esté muy poblada, para buscar rápido una reserva específica."
2. "Si un empleado tiene reservas asignadas un día X y se retira o se ausenta,
   al colocar la opción ausente debemos recibir una notificación diciendo que
   tenía clientes agendados durante el período afectado, y notificar a los
   clientes con un mensaje de que el empleado X no estará disponible,
   preguntar si quiere que le atienda otra persona (dando las opciones) o
   reagendar otro día."

**Estado:** implementado el 2026-09-08 (ADR 0009 §6; migración
`20260908000000_ausencias_de_empleados`).

## Filtros de la Agenda

- Barra "Profesional" (select) y "Cliente" (nombre o celular) sobre el día
  visible; aplican a la vista Lista y a Por profesional; contador "N de M
  turnos del día"; "Limpiar".
- "Buscar en los próximos 30 días": lista las coincidencias (fecha, hora,
  cliente, servicio, quién atiende, estado) con "Ir al día".
- `?empleado=<id>` en la URL preselecciona el profesional.
- API: `GET /appointments?employee_id=` (nuevo filtro).

## Ausencias

| Pieza | Detalle |
|---|---|
| Dónde | Personal → "Ausencia" por empleado; Agenda → Por profesional → "Ausencia" junto al nombre (prefill con el día visible). Desde/hasta o "hasta nuevo aviso", motivo opcional. Las cargadas se listan y se quitan en el mismo modal. |
| Aviso al dueño | Con turnos en el período la API responde 409 con la lista (`conflicts`) y el panel muestra el modal "X tiene N turnos en ese período" con: Volver / Registrar sin avisar / Registrar y avisar a los clientes. Además: una tarea por turno en Tareas y un correo resumen a los emails de aviso. |
| Aviso al cliente | WhatsApp (si tiene celular y acepta avisos) o email. Texto: "Hola {nombre}! Te escribimos de {negocio}. {Empleado} no va a poder atenderte el {día} a las {hora} ({servicio}). A esa misma hora podría atenderte {otros} / A esa hora no hay otra persona libre, pero podemos buscarte otro día u horario. ¿Preferís que te atienda otra persona o pasar el turno a otro día? Respondé por acá y lo coordinamos." Sin canal, la tarea lo dice ("contactarlo"). |
| Respuesta del cliente | El bot recibe en el contexto del cliente sus turnos avisados por ausencia y resuelve con `reschedule_appointment` (mismo horario con la persona elegida, o sin empleado para que asigne, u otro día con `get_available_slots`). |
| Agenda | Etiqueta roja "profesional ausente" / "profesional ausente · cliente avisado" en los turnos afectados; siguen a nombre del ausente hasta que se reprogramen. |
| Disponibilidad | El ausente no aparece como libre ni se le asigna nada en esas fechas (panel, bot, recurrentes). Elegirlo a mano: 409 "está ausente ese día". |
| Baja | "Dar de baja" y destildar "Trabaja actualmente" pasan por el mismo flujo con todos los turnos futuros (`on_conflict`). |

## Cómo probar

1. Agendar a un cliente con Lucía el viernes 13:00. Personal → Lucía →
   Ausencia ese día → aparece el modal con el turno → "Registrar y avisar".
2. Bandeja: el cliente recibió el mensaje; Tareas: tarea "Lucía ausente…";
   Agenda: el turno marcado "profesional ausente · cliente avisado".
3. El cliente responde "sí, que me atienda Ana": el bot reprograma al mismo
   horario con Ana y lo confirma.
4. Agenda con varios turnos: filtrar por Ana y por "Car" (Carla); "Buscar en
   los próximos 30 días" encuentra el turno de otro día.
