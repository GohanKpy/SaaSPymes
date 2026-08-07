import { z } from 'zod';

import { montoGs } from '../validators';

export const categoryCreate = z
  .object({
    name: z.string().min(1).max(120),
    sort_order: z.number().int().min(0).default(0),
  })
  .strict();
export type CategoryCreate = z.infer<typeof categoryCreate>;

export const categoryUpdate = categoryCreate.partial().strict();
export type CategoryUpdate = z.infer<typeof categoryUpdate>;

export const serviceCreate = z
  .object({
    category_id: z.uuid(),
    name: z.string().min(1).max(200),
    description: z.string().max(2000).optional(),
    // Montos en guaranies sin decimales (convencion del plan); string por BigInt.
    price: montoGs(z.coerce.bigint().min(0n)),
    currency: z.string().length(3).default('PYG'),
    tax_rate: z.union([z.literal(0), z.literal(5), z.literal(10)]).default(10),
    duration_min: z.number().int().positive().optional(),
    bookable_by_bot: z.boolean().default(true),
    is_active: z.boolean().default(true),
  })
  .strict();
export type ServiceCreate = z.infer<typeof serviceCreate>;

export const serviceUpdate = serviceCreate.partial().strict();
export type ServiceUpdate = z.infer<typeof serviceUpdate>;
