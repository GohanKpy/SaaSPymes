import { z } from 'zod';

import { uuid } from '../validators';

// Devoluciones (2026-09-14): el bot o el panel registran el pedido; una
// persona lo revisa, decide y lo completa.

export const RETURN_STATUSES = ['requested', 'reviewing', 'approved', 'rejected', 'completed'] as const;
export type ReturnStatus = (typeof RETURN_STATUSES)[number];

export const returnCreate = z
  .object({
    customer_id: uuid,
    invoice_id: uuid.optional(),
    service_id: uuid.optional(),
    description: z.string().trim().min(5).max(1000),
    reason: z.string().trim().max(300).optional(),
  })
  .strict();
export type ReturnCreate = z.infer<typeof returnCreate>;

export const returnListQuery = z.object({
  status: z.enum(RETURN_STATUSES).optional(),
  customer_id: uuid.optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ReturnListQuery = z.infer<typeof returnListQuery>;

/** Decision de una persona del equipo: aprobar o rechazar, con nota y aviso al cliente. */
export const returnDecide = z
  .object({
    decision: z.enum(['approved', 'rejected', 'reviewing']),
    note: z.string().trim().min(3).max(1000),
    notify_customer: z.boolean().default(true),
  })
  .strict();
export type ReturnDecide = z.infer<typeof returnDecide>;

/** Cierre: opcionalmente reingresa mercaderia al stock y vincula la nota de credito. */
export const returnComplete = z
  .object({
    note: z.string().trim().max(1000).optional(),
    restock: z
      .object({ service_id: uuid, branch_id: uuid, quantity: z.coerce.number().positive().max(1_000_000) })
      .optional(),
    credit_note_id: uuid.optional(),
    notify_customer: z.boolean().default(false),
  })
  .strict();
export type ReturnComplete = z.infer<typeof returnComplete>;
