import { z } from 'zod';

import { uuid } from '../validators';

/** Piso tecnico de la duracion de un turno ajustada a mano (minutos). */
export const MIN_APPOINTMENT_MIN = 5;
export const MAX_APPOINTMENT_MIN = 12 * 60;

export const appointmentCreate = z
  .object({
    branch_id: uuid,
    customer_id: uuid,
    /** Servicio principal (bot y compatibilidad). Con service_ids, se ignora. */
    service_id: uuid.optional(),
    /** Varios servicios en el mismo turno (2026-09-07); el primero es el principal. */
    service_ids: z.array(uuid).min(1).max(10).optional(),
    /** Duracion total ajustada a mano; ausente = la calculada por el servidor. */
    duration_min: z.number().int().min(MIN_APPOINTMENT_MIN).max(MAX_APPOINTMENT_MIN).optional(),
    /** Empleado asignado; ausente = auto-asignacion (ADR 0009). */
    employee_id: uuid.optional(),
    starts_at: z.iso.datetime({ offset: true }),
    // sin ends_at: se calcula con la duracion de los servicios (default 30 min)
    ends_at: z.iso.datetime({ offset: true }).optional(),
    notes: z.string().max(1000).optional(),
  })
  .strict();
export type AppointmentCreate = z.infer<typeof appointmentCreate>;

export const appointmentUpdate = z
  .object({
    starts_at: z.iso.datetime({ offset: true }),
    ends_at: z.iso.datetime({ offset: true }),
    service_id: uuid.nullable(),
    notes: z.string().max(1000).nullable(),
  })
  .partial()
  .strict();
export type AppointmentUpdate = z.infer<typeof appointmentUpdate>;

export const appointmentListQuery = z.object({
  branch_id: uuid.optional(),
  /** Turnos de un cliente puntual (panel del chat y ficha, fase 1 auditoria 2026-09-05). */
  customer_id: uuid.optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  status: z.enum(['pending', 'confirmed', 'completed', 'cancelled', 'no_show']).optional(),
});
export type AppointmentListQuery = z.infer<typeof appointmentListQuery>;

/** Lista de uuids separada por coma (query string). */
const uuidList = z
  .string()
  .transform((v) => v.split(',').map((x) => x.trim()).filter(Boolean))
  .pipe(z.array(uuid).min(1).max(10));

export const availabilityQuery = z
  .object({
    branch_id: uuid,
    /** Un servicio (bot, compatibilidad) o varios (panel, 2026-09-07). */
    service_id: uuid.optional(),
    service_ids: uuidList.optional(),
    /** Duracion total ajustada a mano (minutos); ausente = la calculada. */
    duration_min: z.coerce.number().int().min(MIN_APPOINTMENT_MIN).max(MAX_APPOINTMENT_MIN).optional(),
    date: z.iso.date(),
    /** Solo horarios donde ESTE empleado esta libre (eleccion de profesional). */
    employee_id: uuid.optional(),
  })
  .refine((q) => q.service_id || q.service_ids, { message: 'Falta service_id o service_ids', path: ['service_id'] });
export type AvailabilityQuery = z.infer<typeof availabilityQuery>;

export const appointmentCancel = z
  .object({ reason: z.string().max(500).optional() })
  .strict();
export type AppointmentCancel = z.infer<typeof appointmentCancel>;

/** Reprogramar desde el panel: nueva fecha/hora (uno de los horarios de disponibilidad) y, opcional, otro profesional. */
export const appointmentReschedule = z
  .object({
    starts_at: z.iso.datetime({ offset: true }),
    employee_id: uuid.optional(),
  })
  .strict();
export type AppointmentReschedule = z.infer<typeof appointmentReschedule>;
