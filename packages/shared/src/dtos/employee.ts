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

/** Estado civil (dato que pide el Ministerio de Trabajo). */
export const MARITAL_STATUSES = ['soltero', 'casado', 'divorciado', 'viudo', 'union_de_hecho'] as const;
export type MaritalStatus = (typeof MARITAL_STATUSES)[number];

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
    // Contacto de emergencia desglosado (2026-08-28): nombre, telefono y
    // relacion con el empleado (padre, madre, esposo/a...).
    emergency_contact_name: z.string().max(150).optional(),
    emergency_contact_phone: z.string().max(30).optional(),
    emergency_contact_relation: z.string().max(60).optional(),
    marital_status: z.enum(MARITAL_STATUSES).optional(),
    children_count: z.coerce.number().int().min(0).max(30).optional(),
    salary: montoGs(z.coerce.bigint().min(0n)).optional(),
    notes: z.string().max(2000).optional(),
    bookable: z.boolean().default(true),
    is_active: z.boolean().default(true),
    schedule: employeeSchedule.nullable().optional(),
  })
  .strict();
export type EmployeeCreate = z.infer<typeof employeeCreate>;

export const employeeUpdate = employeeCreate
  .partial()
  .extend({
    /** Al dar de baja (is_active=false) con turnos futuros (2026-09-08): abort (409 con la lista), notify (avisar a los clientes) o keep. */
    on_conflict: z.enum(['abort', 'notify', 'keep']).optional(),
  })
  .strict();
export type EmployeeUpdate = z.infer<typeof employeeUpdate>;

/**
 * Campos de la planilla que cada tenant puede marcar como obligatorios en su
 * empresa (nombre y apellido son SIEMPRE obligatorios y no aparecen aca).
 * El server valida contra esta lista al crear/editar empleados.
 */
export const EMPLOYEE_REQUIRABLE_FIELDS = [
  'ci_number',
  'birth_date',
  'phone',
  'email',
  'address',
  'position',
  'hired_at',
  'ips_number',
  'emergency_contact_name',
  'emergency_contact_phone',
  'emergency_contact_relation',
  'marital_status',
  'children_count',
  'salary',
] as const;
export type EmployeeRequirableField = (typeof EMPLOYEE_REQUIRABLE_FIELDS)[number];

export const employeeFormSettingsPut = z
  .object({
    required_fields: z
      .array(z.enum(EMPLOYEE_REQUIRABLE_FIELDS))
      .max(EMPLOYEE_REQUIRABLE_FIELDS.length),
  })
  .strict();
export type EmployeeFormSettingsPut = z.infer<typeof employeeFormSettingsPut>;

/**
 * Ausencia de un empleado (2026-09-08): del dia starts_on al ends_on (null =
 * hasta nuevo aviso). Si tiene turnos en el periodo, on_conflict decide:
 * abort → 409 con la lista; notify → se registra y se avisa a cada cliente
 * por WhatsApp/email para que elija otra persona u otro dia; keep → se
 * registra sin avisar.
 */
export const absenceCreate = z
  .object({
    starts_on: fecha,
    ends_on: fecha.nullable().optional(),
    reason: z.string().trim().max(300).optional(),
    on_conflict: z.enum(['abort', 'notify', 'keep']).default('abort'),
  })
  .strict()
  .refine((a) => !a.ends_on || a.ends_on >= a.starts_on, { message: 'la ausencia no puede terminar antes de empezar', path: ['ends_on'] });
export type AbsenceCreate = z.infer<typeof absenceCreate>;

/** Baja de un empleado (DELETE /employees/:id?on_conflict=). */
export const employeeRemoveQuery = z.object({ on_conflict: z.enum(['abort', 'notify', 'keep']).default('abort') });
export type EmployeeRemoveQuery = z.infer<typeof employeeRemoveQuery>;
