import { z } from 'zod';

import { montoGs, uuid } from '../validators';

const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'fecha YYYY-MM-DD');

const horaHHMM = z.string().regex(/^\d{2}:\d{2}$/, 'hora HH:MM');
const franja = z
  .object({ from: horaHHMM, to: horaHHMM })
  .refine((r) => r.from < r.to, 'la franja debe terminar despues de empezar');

/** Horario propio del empleado (fase 3): mismo formato que el de la sucursal
 *  (week 0=domingo..6=sabado, closed_dates = dias libres). null = usa el
 *  horario del negocio. */
export const employeeSchedule = z
  .object({
    week: z.record(z.string().regex(/^[0-6]$/), z.array(franja).max(3)),
    closed_dates: z.array(fecha).max(400).default([]),
  })
  .strict();
export type EmployeeSchedule = z.infer<typeof employeeSchedule>;

/**
 * Planilla de RRHH del empleado (ADR 0009). Empleado != usuario del panel:
 * el vinculo a un login es opcional y llega en fase posterior. `bookable`
 * define si participa de la agenda; `salary` solo lo ven root/admin.
 */
export const employeeCreate = z
  .object({
    first_name: z.string().min(1).max(120),
    last_name: z.string().min(1).max(120),
    branch_id: uuid.optional(),
    ci_number: z.string().max(20).optional(),
    birth_date: fecha.optional(),
    phone: z.string().max(30).optional(),
    email: z.email().optional(),
    address: z.string().max(500).optional(),
    position: z.string().max(120).optional(),
    hired_at: fecha.optional(),
    ips_number: z.string().max(30).optional(),
    emergency_contact: z.string().max(300).optional(),
    salary: montoGs(z.coerce.bigint().min(0n)).optional(),
    notes: z.string().max(2000).optional(),
    bookable: z.boolean().default(true),
    is_active: z.boolean().default(true),
    schedule: employeeSchedule.nullable().optional(),
  })
  .strict();
export type EmployeeCreate = z.infer<typeof employeeCreate>;

export const employeeUpdate = employeeCreate.partial().strict();
export type EmployeeUpdate = z.infer<typeof employeeUpdate>;
