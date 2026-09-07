import { z } from 'zod';

import { montoGs, paginationQuery, uuid } from '../validators';

export const invoiceItemInput = z
  .object({
    service_id: uuid.optional(), // sin service_id: item libre
    description: z.string().min(1).max(500).optional(),
    quantity: z.coerce.number().positive().default(1),
    unit_price: montoGs(z.coerce.bigint().min(0n).optional()),
    tax_rate: z.union([z.literal(0), z.literal(5), z.literal(10)]).optional(),
  })
  .strict()
  .refine((i) => i.service_id || (i.description && i.unit_price !== undefined), {
    message: 'item libre requiere description y unit_price',
  });
export type InvoiceItemInput = z.infer<typeof invoiceItemInput>;

/**
 * A nombre de quien sale la factura (2026-09-07). Se elige UNA de tres formas:
 * fiscal_id (identidad guardada en la ficha), billing (datos sueltos; con
 * save_to_customer quedan en la ficha) o ninguna (el documento propio del
 * cliente, si lo tiene). Emitir exige que haya datos.
 */
export const invoiceBillingInput = z
  .object({
    doc_type: z.enum(['ruc', 'ci', 'pasaporte']),
    doc_number: z.string().min(1).max(20),
    ruc_dv: z.string().max(2).optional(),
    legal_name: z.string().min(1).max(200),
    save_to_customer: z.boolean().default(true),
  })
  .strict();
export type InvoiceBillingInput = z.infer<typeof invoiceBillingInput>;

export const invoiceCreate = z
  .object({
    customer_id: uuid,
    branch_id: uuid,
    fiscal_id: uuid.optional(),
    billing: invoiceBillingInput.optional(),
    items: z.array(invoiceItemInput).min(1),
  })
  .strict();
export type InvoiceCreate = z.infer<typeof invoiceCreate>;

/** Cambiar a nombre de quien sale un BORRADOR (desde el detalle). */
export const invoiceBillingUpdate = z
  .object({
    fiscal_id: uuid.optional(),
    billing: invoiceBillingInput.optional(),
  })
  .strict()
  .refine((b) => b.fiscal_id || b.billing, { message: 'Falta fiscal_id o billing' });
export type InvoiceBillingUpdate = z.infer<typeof invoiceBillingUpdate>;

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
    amount: montoGs(z.coerce.bigint().positive()),
    notes: z.string().max(500).optional(),
  })
  .strict();
export type PaymentCreate = z.infer<typeof paymentCreate>;

// ---------------- cuenta mensual (2026-09-07) ----------------

/** Consumo pendiente cargado a mano (articulo comprado, extra); mismo contrato que un item de factura. */
export const chargeCreate = z
  .object({
    service_id: uuid.optional(),
    description: z.string().min(1).max(500).optional(),
    quantity: z.coerce.number().positive().default(1),
    unit_price: montoGs(z.coerce.bigint().min(0n).optional()),
    tax_rate: z.union([z.literal(0), z.literal(5), z.literal(10)]).optional(),
    charged_on: z.iso.date().optional(),
    notes: z.string().max(500).optional(),
  })
  .strict()
  .refine((i) => i.service_id || (i.description && i.unit_price !== undefined), {
    message: 'consumo libre requiere description y unit_price',
  });
export type ChargeCreate = z.infer<typeof chargeCreate>;

/** Facturar la cuenta de un cliente: todos sus consumos pendientes (o hasta una fecha). */
export const accountInvoice = z
  .object({
    fiscal_id: uuid.optional(),
    billing: invoiceBillingInput.optional(),
    /** Emitir en el acto (toma numero). */
    issue: z.boolean().default(true),
    /** Enviar al cliente por su canal (WhatsApp o email) con el comprobante. */
    send: z.boolean().default(true),
    /** Solo consumos con fecha hasta esta inclusive; ausente = todos los pendientes. */
    until: z.iso.date().optional(),
  })
  .strict();
export type AccountInvoice = z.infer<typeof accountInvoice>;

export const accountNotify = z.object({ until: z.iso.date().optional() }).strict();
export type AccountNotify = z.infer<typeof accountNotify>;
