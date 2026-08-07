import { z } from 'zod';

import { montoGs, rucWithDv, uuid } from '../validators';

export const tenantCreate = z
  .object({
    legal_name: z.string().min(1).max(200),
    trade_name: z.string().min(1).max(200).optional(),
    ruc: rucWithDv.optional(),
    timezone: z.string().default('America/Asuncion'),
    plan_code: z.string().min(1),
    branch_name: z.string().min(1).max(200).default('Casa central'),
    // CRM del dueño del sistema (ADR 0005)
    contact_name: z.string().min(1).max(200).optional(),
    contact_email: z.email().optional(),
    contact_phone: z.string().max(30).optional(),
    notes: z.string().max(4000).optional(),
    // Usuario root inicial del tenant
    root_email: z.email(),
    root_full_name: z.string().min(1).max(200),
  })
  .strict();
export type TenantCreate = z.infer<typeof tenantCreate>;

export const tenantPatch = z
  .object({
    legal_name: z.string().min(1).max(200),
    trade_name: z.string().min(1).max(200).nullable(),
    ruc: rucWithDv.nullable(),
    status: z.enum(['trial', 'active', 'suspended', 'closed']),
    plan_code: z.string().min(1),
    timezone: z.string(),
    contact_name: z.string().min(1).max(200).nullable(),
    contact_email: z.email().nullable(),
    contact_phone: z.string().max(30).nullable(),
    notes: z.string().max(4000).nullable(),
  })
  .partial()
  .strict();
export type TenantPatch = z.infer<typeof tenantPatch>;

export const planCreate = z
  .object({
    code: z
      .string()
      .min(1)
      .max(40)
      .regex(/^[a-z0-9_-]+$/),
    name: z.string().min(1).max(120),
    monthly_price: montoGs(z.coerce.bigint().min(0n)),
    currency: z.string().length(3).default('PYG'),
    max_users: z.number().int().min(1).default(1),
    max_branches: z.number().int().min(1).default(1),
    is_active: z.boolean().default(true),
    sort_order: z.number().int().min(0).default(0),
    feature_codes: z.array(z.string()).default([]),
  })
  .strict();
export type PlanCreate = z.infer<typeof planCreate>;

export const planUpdate = planCreate.partial().strict();
export type PlanUpdate = z.infer<typeof planUpdate>;

export const overridePut = z
  .object({
    feature_code: z.string().min(1),
    enabled: z.boolean(),
    extra_fee: montoGs(z.coerce.bigint().min(0n).default(0n)),
    limits: z.record(z.string(), z.unknown()).nullable().optional(),
    note: z.string().min(3).max(1000), // motivo del acuerdo: obligatorio (doc 03)
  })
  .strict();
export type OverridePut = z.infer<typeof overridePut>;

/** Modulo de seguridad del portal admin: valores del bloqueo de login. */
export const securitySettingsPut = z
  .object({
    login_max_attempts: z.number().int().min(1).max(1000),
    login_window_min: z.number().int().min(1).max(1440),
    login_block_min: z.number().int().min(1).max(1440),
  })
  .strict();
export type SecuritySettingsPut = z.infer<typeof securitySettingsPut>;

export const featureCreate = z
  .object({
    code: z
      .string()
      .min(1)
      .max(40)
      .regex(/^[a-z0-9_]+$/),
    name: z.string().min(1).max(120),
  })
  .strict();
export type FeatureCreate = z.infer<typeof featureCreate>;

export const tenantIdParam = z.object({ id: uuid });

/** Perfil propio del operador del portal admin. */
export const platformProfilePatch = z
  .object({
    full_name: z.string().min(1).max(200),
    email: z.email(),
  })
  .partial()
  .strict();
export type PlatformProfilePatch = z.infer<typeof platformProfilePatch>;

export const platformPasswordChange = z
  .object({
    current_password: z.string().min(1),
    new_password: z.string().min(10).max(200),
  })
  .strict();
export type PlatformPasswordChange = z.infer<typeof platformPasswordChange>;

/** Operadores del portal: 'admin' administra todo; 'agent' lee y da soporte. */
export const platformUserCreate = z
  .object({
    email: z.email(),
    full_name: z.string().min(1).max(200),
    role: z.enum(['admin', 'agent']),
  })
  .strict();
export type PlatformUserCreate = z.infer<typeof platformUserCreate>;

export const platformUserUpdate = z
  .object({
    full_name: z.string().min(1).max(200),
    role: z.enum(['admin', 'agent']),
    is_active: z.boolean(),
  })
  .partial()
  .strict();
export type PlatformUserUpdate = z.infer<typeof platformUserUpdate>;
