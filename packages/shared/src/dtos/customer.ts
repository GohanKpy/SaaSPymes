import { z } from 'zod';

import { paginationQuery, phoneE164, uuid } from '../validators';

// CRM extendido (2026-08-26, referencia Bitrix24): la ficha arranca con el
// minimo (nombre, apellido, celular, email) y crece con campos estandar
// opcionales + campos personalizados del tenant + multiples contactos.

/** Origen del cliente: de donde llego (marketing basico). */
export const customerSource = z.enum([
  'whatsapp',
  'instagram',
  'facebook',
  'recomendacion',
  'web',
  'local',
  'otro',
]);

const tags = z.array(z.string().min(1).max(40)).max(30);
/** Valores de campos personalizados del tenant (clave = code de la definicion). */
const customData = z.record(
  z.string().regex(/^[a-z0-9_]{2,40}$/),
  z.union([z.string().max(2000), z.number(), z.boolean()]),
);

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
    source: customerSource.optional(),
    source_detail: z.string().max(300).optional(),
    company_name: z.string().max(200).optional(),
    job_title: z.string().max(120).optional(),
    city: z.string().max(120).optional(),
    tags: tags.optional(),
    assigned_user_id: uuid.optional(),
    marketing_opt_in: z.boolean().optional(),
    rating: z.number().int().min(1).max(5).optional(),
    custom_data: customData.optional(),
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
    source: customerSource.nullable(),
    source_detail: z.string().max(300).nullable(),
    company_name: z.string().max(200).nullable(),
    job_title: z.string().max(120).nullable(),
    city: z.string().max(120).nullable(),
    tags: tags,
    assigned_user_id: uuid.nullable(),
    marketing_opt_in: z.boolean(),
    rating: z.number().int().min(1).max(5).nullable(),
    custom_data: customData,
  })
  .partial()
  .strict();
export type CustomerUpdate = z.infer<typeof customerUpdate>;

export const customerListQuery = paginationQuery.extend({
  q: z.string().max(120).optional(),
  tag: z.string().max(40).optional(),
  source: customerSource.optional(),
});
export type CustomerListQuery = z.infer<typeof customerListQuery>;

// ------------------- puntos de contacto multiples -------------------

export const contactPointCreate = z
  .object({
    kind: z.enum(['phone', 'email', 'web', 'im']),
    /** celular|trabajo|casa|whatsapp|instagram|facebook|telegram|x|tiktok|web|otro */
    label: z.string().min(1).max(40).default('otro'),
    value: z.string().min(1).max(300),
    is_primary: z.boolean().default(false),
    sort: z.number().int().min(0).max(999).default(0),
  })
  .strict();
export type ContactPointCreate = z.infer<typeof contactPointCreate>;

export const contactPointUpdate = contactPointCreate.partial().strict();
export type ContactPointUpdate = z.infer<typeof contactPointUpdate>;

// ------------------- campos personalizados del tenant -------------------

export const customFieldDefCreate = z
  .object({
    entity: z.enum(['customer', 'service', 'appointment', 'invoice']).default('customer'),
    code: z.string().regex(/^[a-z0-9_]{2,40}$/, 'code: minusculas, numeros y _'),
    label: z.string().min(1).max(120),
    field_type: z.enum(['text', 'number', 'date', 'boolean', 'list', 'money', 'url']),
    options: z.array(z.string().min(1).max(120)).max(50).default([]),
    required: z.boolean().default(false),
    show_in_form: z.boolean().default(true),
    sort: z.number().int().min(0).max(999).default(0),
  })
  .strict()
  .refine((f) => f.field_type !== 'list' || f.options.length > 0, {
    message: 'un campo de tipo lista necesita opciones',
    path: ['options'],
  });
export type CustomFieldDefCreate = z.infer<typeof customFieldDefCreate>;

export const customFieldDefUpdate = z
  .object({
    label: z.string().min(1).max(120),
    options: z.array(z.string().min(1).max(120)).max(50),
    required: z.boolean(),
    show_in_form: z.boolean(),
    sort: z.number().int().min(0).max(999),
    is_active: z.boolean(),
  })
  .partial()
  .strict();
export type CustomFieldDefUpdate = z.infer<typeof customFieldDefUpdate>;

// ------------------- timeline: notas y tareas -------------------

export const activityCreate = z
  .object({
    activity_type: z.enum(['nota', 'llamada', 'reunion', 'tarea', 'seguimiento']),
    body: z.string().min(1).max(4000),
    due_at: z.iso.datetime({ offset: true }).optional(),
    assigned_user_id: uuid.optional(),
  })
  .strict();
export type ActivityCreate = z.infer<typeof activityCreate>;

export const activityUpdate = z
  .object({
    body: z.string().min(1).max(4000),
    due_at: z.iso.datetime({ offset: true }).nullable(),
    assigned_user_id: uuid.nullable(),
    /** true marca la tarea como hecha; false la reabre. */
    done: z.boolean(),
  })
  .partial()
  .strict();
export type ActivityUpdate = z.infer<typeof activityUpdate>;
