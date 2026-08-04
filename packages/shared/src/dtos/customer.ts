import { z } from 'zod';

import { paginationQuery, phoneE164 } from '../validators';

export const customerCreate = z
  .object({
    first_name: z.string().min(1).max(120),
    last_name: z.string().min(1).max(120).optional(),
    doc_type: z.enum(['ci', 'ruc', 'pasaporte']).optional(),
    doc_number: z.string().min(1).max(20).optional(),
    ruc_dv: z.string().max(2).optional(),
    email: z.email().optional(),
    phone_e164: phoneE164.optional(),
    birth_date: z.iso.date().optional(),
    address: z.string().max(500).optional(),
    notes: z.string().max(2000).optional(),
    notify_whatsapp: z.boolean().default(true),
    notify_email: z.boolean().default(false),
  })
  .strict()
  .refine((c) => !c.doc_number || c.doc_type, {
    message: 'doc_type es obligatorio si hay doc_number',
    path: ['doc_type'],
  });
export type CustomerCreate = z.infer<typeof customerCreate>;

export const customerUpdate = z
  .object({
    first_name: z.string().min(1).max(120),
    last_name: z.string().min(1).max(120).nullable(),
    doc_type: z.enum(['ci', 'ruc', 'pasaporte']).nullable(),
    doc_number: z.string().min(1).max(20).nullable(),
    ruc_dv: z.string().max(2).nullable(),
    email: z.email().nullable(),
    phone_e164: phoneE164.nullable(),
    birth_date: z.iso.date().nullable(),
    address: z.string().max(500).nullable(),
    notes: z.string().max(2000).nullable(),
    notify_whatsapp: z.boolean(),
    notify_email: z.boolean(),
  })
  .partial()
  .strict();
export type CustomerUpdate = z.infer<typeof customerUpdate>;

export const customerListQuery = paginationQuery.extend({
  q: z.string().max(120).optional(),
});
export type CustomerListQuery = z.infer<typeof customerListQuery>;
