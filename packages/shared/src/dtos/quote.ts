import { z } from 'zod';

import { paginationQuery, uuid } from '../validators';

import { invoiceItemInput } from './invoice';

// Presupuestos formales (P1 replanteo 2026-08-26): quote → factura.
// Mismos items que una factura (el server recalcula totales SIEMPRE);
// sin caracter fiscal hasta convertirse en borrador de factura.

export const quoteStatus = z.enum(['draft', 'sent', 'accepted', 'rejected', 'invoiced']);
export type QuoteStatus = z.infer<typeof quoteStatus>;

export const quoteCreate = z
  .object({
    customer_id: uuid,
    branch_id: uuid,
    valid_until: z.iso.date().optional(),
    notes: z.string().max(2000).optional(),
    items: z.array(invoiceItemInput).min(1),
  })
  .strict();
export type QuoteCreate = z.infer<typeof quoteCreate>;

/** Solo borradores se editan; los items llegan completos (reemplazo total). */
export const quoteUpdate = z
  .object({
    valid_until: z.iso.date().nullable(),
    notes: z.string().max(2000).nullable(),
    items: z.array(invoiceItemInput).min(1),
    /** Transiciones manuales: draft→sent, sent→accepted|rejected (y volver a sent). */
    status: z.enum(['sent', 'accepted', 'rejected']),
  })
  .partial()
  .strict();
export type QuoteUpdate = z.infer<typeof quoteUpdate>;

export const quoteListQuery = paginationQuery.extend({
  status: quoteStatus.optional(),
  customer_id: uuid.optional(),
});
export type QuoteListQuery = z.infer<typeof quoteListQuery>;
