import { z } from 'zod';

import { paginationQuery, uuid } from '../validators';

export const invoiceItemInput = z
  .object({
    service_id: uuid.optional(), // sin service_id: item libre
    description: z.string().min(1).max(500).optional(),
    quantity: z.coerce.number().positive().default(1),
    unit_price: z.coerce.bigint().min(0n).optional(),
    tax_rate: z.union([z.literal(0), z.literal(5), z.literal(10)]).optional(),
  })
  .strict()
  .refine((i) => i.service_id || (i.description && i.unit_price !== undefined), {
    message: 'item libre requiere description y unit_price',
  });
export type InvoiceItemInput = z.infer<typeof invoiceItemInput>;

export const invoiceCreate = z
  .object({
    customer_id: uuid,
    branch_id: uuid,
    items: z.array(invoiceItemInput).min(1),
  })
  .strict();
export type InvoiceCreate = z.infer<typeof invoiceCreate>;

export const invoiceListQuery = paginationQuery.extend({
  status: z.enum(['draft', 'issuing', 'approved', 'rejected', 'cancelled', 'credited']).optional(),
  customer_id: uuid.optional(),
});
export type InvoiceListQuery = z.infer<typeof invoiceListQuery>;

export const invoiceCancel = z
  .object({
    reason: z.string().min(3).max(1000), // obligatorio (doc 04 §3.9)
  })
  .strict();
export type InvoiceCancel = z.infer<typeof invoiceCancel>;

export const paymentCreate = z
  .object({
    method: z.enum(['efectivo', 'transferencia', 'tarjeta', 'qr', 'otro']),
    amount: z.coerce.bigint().positive(),
    notes: z.string().max(500).optional(),
  })
  .strict();
export type PaymentCreate = z.infer<typeof paymentCreate>;
