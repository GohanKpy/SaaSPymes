import { z } from 'zod';

import { rucWithDv, uuid } from '../validators';

export const tenantSelfPatch = z
  .object({
    legal_name: z.string().min(1).max(200),
    trade_name: z.string().min(1).max(200).nullable(),
    ruc: rucWithDv.nullable(),
    timezone: z.string(),
    // Marca del negocio: logo (data URL, para el KuDE y el panel), actividad
    // economica y email de facturacion. El logo vive en branding (doc 03);
    // el pase a object storage llega con la fase 2.
    branding: z
      .record(z.string(), z.unknown())
      .refine((b) => {
        const logo = b['logo'];
        return (
          logo === undefined ||
          logo === null ||
          (typeof logo === 'string' && /^data:image\/(png|jpeg);base64,/.test(logo))
        );
      }, 'logo debe ser un data URL PNG o JPEG')
      .refine(
        (b) => JSON.stringify(b).length <= 500_000,
        'branding demasiado grande (logo max ~350 KB)',
      ),
  })
  .partial()
  .strict();
export type TenantSelfPatch = z.infer<typeof tenantSelfPatch>;

export const branchCreate = z
  .object({
    name: z.string().min(1).max(200),
    address: z.string().max(500).optional(),
    phone: z.string().max(30).optional(),
  })
  .strict();
export type BranchCreate = z.infer<typeof branchCreate>;

export const branchUpdate = branchCreate.partial().strict();
export type BranchUpdate = z.infer<typeof branchUpdate>;

const horaHHMM = z.string().regex(/^\d{2}:\d{2}$/, 'hora HH:MM');
const franja = z
  .object({ from: horaHHMM, to: horaHHMM })
  .refine((r) => r.from < r.to, 'la franja debe terminar despues de empezar');

/**
 * Horario de atencion de la sucursal: por dia de semana (0=domingo..6=sabado)
 * hasta 3 franjas (el hueco entre franjas = almuerzo); dia ausente o con
 * lista vacia = cerrado. closed_dates = dias off puntuales.
 */
export const branchSchedulePut = z
  .object({
    // Claves 0=domingo..6=sabado; los dias ausentes quedan cerrados.
    week: z.record(z.string().regex(/^[0-6]$/), z.array(franja).max(3)),
    closed_dates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(400).default([]),
    /** Que hacer si hay turnos afectados: abort (default) devuelve 409 con la lista. */
    on_conflict: z.enum(['abort', 'keep', 'cancel_notify']).default('abort'),
    /** Mensaje breve para los clientes cancelados (obligatorio con cancel_notify). */
    message: z.string().min(3).max(500).optional(),
  })
  .strict()
  .refine((s) => s.on_conflict !== 'cancel_notify' || Boolean(s.message), {
    message: 'message es obligatorio con cancel_notify',
    path: ['message'],
  });
export type BranchSchedulePut = z.infer<typeof branchSchedulePut>;

export const userCreate = z
  .object({
    email: z.email(),
    full_name: z.string().min(1).max(200),
    role: z.enum(['admin', 'staff']), // el root nace con el tenant
    branch_ids: z.array(uuid).default([]),
  })
  .strict();
export type UserCreate = z.infer<typeof userCreate>;

export const userUpdate = z
  .object({
    full_name: z.string().min(1).max(200),
    role: z.enum(['admin', 'staff']),
    is_active: z.boolean(),
    branch_ids: z.array(uuid),
  })
  .partial()
  .strict();
export type UserUpdate = z.infer<typeof userUpdate>;

export interface EffectiveFeature {
  code: string;
  name: string;
  enabled: boolean;
  source: 'plan' | 'override';
  limits: Record<string, unknown>;
}
