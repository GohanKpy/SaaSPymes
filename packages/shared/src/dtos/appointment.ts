import { z } from 'zod';

import { uuid } from '../validators';

export const appointmentCreate = z
  .object({
    branch_id: uuid,
    customer_id: uuid,
    service_id: uuid.optional(),
    starts_at: z.iso.datetime({ offset: true }),
    // sin ends_at: se calcula con la duracion del servicio (default 30 min)
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
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  status: z.enum(['pending', 'confirmed', 'completed', 'cancelled', 'no_show']).optional(),
});
export type AppointmentListQuery = z.infer<typeof appointmentListQuery>;

export const availabilityQuery = z.object({
  branch_id: uuid,
  service_id: uuid,
  date: z.iso.date(),
});
export type AvailabilityQuery = z.infer<typeof availabilityQuery>;

export const appointmentCancel = z
  .object({ reason: z.string().max(500).optional() })
  .strict();
export type AppointmentCancel = z.infer<typeof appointmentCancel>;
