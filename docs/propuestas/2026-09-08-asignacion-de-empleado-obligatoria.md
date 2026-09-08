# Asignación de empleado obligatoria — 2026-09-08

**Pedido de Johan:** "al hacer una reserva sí o sí debe asignarse a un
empleado. Para decidir a qué empleado, ver quién está libre en el horario
deseado y con menos carga laboral asignada en el día. Si el cliente solicita
un empleado específico, verificar que esté disponible: si lo está, asignar;
si no, notificar al cliente que no está disponible en ese horario."

**Estado:** implementado el 2026-09-08 (ADR 0009 §5).

## Qué había

- Con empleados agendables cargados ya se asignaba uno libre (el de menos
  turnos en una ventana de ±24 h) y el profesional pedido se verificaba.
- **Sin** empleados agendables el turno se creaba sin nadie asignado
  (capacidad fija 1 por franja). Tucano, INICIA y Plews Tyres están así.
- Si el profesional pedido no estaba libre, el bot recibía "no está
  disponible; horarios vigentes: …" sin decir de quién se trataba ni quién
  más podía atender; y los 409 de la API le llegaban como "Conflict Exception".

## Qué se hizo

| Pieza | Detalle |
|---|---|
| Empleado obligatorio | Sin empleados agendables no hay horarios y crear un turno da 409 "Para agendar hace falta al menos un empleado que atienda clientes con turno: cargalo en Personal". La Agenda muestra el aviso (link a Personal) y deshabilita "Nuevo turno"; el bot deriva a una persona con `request_human`. |
| Menos carga del día | Entre los libres y dentro de su horario, gana el de menos **minutos** agendados en el día local del turno; empate → menos turnos → nombre. |
| Profesional pedido | Panel: el selector solo ofrece sus horarios libres y, si no tiene, lo dice ("Ana no tiene horarios libres ese día: probá otro día o Cualquiera"). Bot: el error de la tool dice "Ana no está disponible el 2026-09-10 a las 15:00", lista sus otros horarios y quién más podría atender a esa hora; el prompt (regla 3) obliga a decírselo al cliente y a no cambiar de profesional ni de horario sin que lo acepte. |
| Quién atiende | El bot ya devolvía `atendidoPor`; ahora la regla 3 le pide decirle al cliente quién lo atiende. |

## Impacto en los clientes actuales

- Negocios sin ningún empleado con "Atiende clientes con turno": **Tucano**,
  INICIA y Plews Tyres. Hasta que carguen uno en Personal no van a poder
  agendar (ni ellos ni el bot). El aviso en la Agenda lo explica.
- No había turnos futuros sin empleado en ningún negocio, así que no hubo
  que migrar datos.

## Cómo probar

1. Tenant sin empleados agendables: Agenda muestra el aviso; `POST /appointments`
   responde 409 con el mensaje; `GET /appointments/availability` devuelve `[]`.
2. Tenant con dos empleados (QA): dos turnos seguidos sin profesional van a
   personas distintas; el tercero va al que tenga menos minutos ese día.
3. Bot: pedir "con Ana a las 10" cuando Ana ya tiene turno → el bot responde
   que Ana no está disponible a esa hora y ofrece sus otros horarios o a la
   otra profesional; no reserva hasta que el cliente elija.
