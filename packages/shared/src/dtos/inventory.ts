import { z } from 'zod';

import { montoGs, uuid } from '../validators';

// Inventario fase 1 (2026-09-14, ADR 0013).

export const STOCK_MOVEMENT_KINDS = ['initial', 'purchase', 'sale', 'sale_reversal', 'return', 'adjustment', 'transfer_in', 'transfer_out'] as const;
export type StockMovementKind = (typeof STOCK_MOVEMENT_KINDS)[number];

export const stockQuery = z.object({
  branch_id: uuid.optional(),
  /** Solo items bajo el minimo. */
  low_only: z.coerce.boolean().optional(),
});
export type StockQuery = z.infer<typeof stockQuery>;

export const movementsQuery = z.object({
  service_id: uuid.optional(),
  branch_id: uuid.optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type MovementsQuery = z.infer<typeof movementsQuery>;

/** Ingreso de mercaderia (compra, carga inicial): suma y actualiza el costo promedio. */
export const stockEntry = z
  .object({
    service_id: uuid,
    branch_id: uuid,
    quantity: z.coerce.number().positive().max(1_000_000),
    unit_cost: montoGs(z.coerce.bigint().min(0n).optional()),
    kind: z.enum(['purchase', 'initial']).default('purchase'),
    note: z.string().trim().max(300).optional(),
  })
  .strict();
export type StockEntry = z.infer<typeof stockEntry>;

/** Ajuste por conteo fisico, rotura o perdida: se fija la cantidad real o se aplica una diferencia. */
export const stockAdjustment = z
  .object({
    service_id: uuid,
    branch_id: uuid,
    new_quantity: z.coerce.number().min(-1_000_000).max(1_000_000).optional(),
    delta: z.coerce.number().min(-1_000_000).max(1_000_000).optional(),
    reason: z.string().trim().min(3).max(300),
  })
  .strict()
  .refine((a) => (a.new_quantity !== undefined) !== (a.delta !== undefined), { message: 'indicar new_quantity o delta (uno de los dos)' });
export type StockAdjustment = z.infer<typeof stockAdjustment>;

/** Traslado entre sucursales. */
export const stockTransfer = z
  .object({
    service_id: uuid,
    from_branch_id: uuid,
    to_branch_id: uuid,
    quantity: z.coerce.number().positive().max(1_000_000),
    note: z.string().trim().max(300).optional(),
  })
  .strict()
  .refine((t) => t.from_branch_id !== t.to_branch_id, { message: 'las sucursales deben ser distintas' });
export type StockTransfer = z.infer<typeof stockTransfer>;
