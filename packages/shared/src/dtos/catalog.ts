import { z } from 'zod';

import { montoGs } from '../validators';

/** ADR 0009 fase 2: tipo del producto. 'servicio' se agenda como turno propio;
 *  'item' es venta (con reunion inicial opcional coordinada por el bot). */
export const catalogKind = z.enum(['servicio', 'item']);
export type CatalogKind = z.infer<typeof catalogKind>;

export const categoryCreate = z
  .object({
    name: z.string().min(1).max(120),
    sort_order: z.number().int().min(0).default(0),
    // Solo un default de conveniencia al crear productos en la categoria.
    default_kind: catalogKind.default('servicio'),
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
    // Si falta, hereda el default_kind de la categoria (server-side).
    kind: catalogKind.optional(),
    // Servicio: duracion de la tarea. null explicito = volver al default (30).
    duration_min: z.number().int().positive().nullable().optional(),
    // Servicio: minutos que aporta cuando se combina con otro en el mismo
    // turno (2026-09-07). null = la duracion completa.
    combo_duration_min: z.number().int().positive().nullable().optional(),
    // Item: coordinar una reunion inicial para tratarlo, y su duracion.
    requires_meeting: z.boolean().optional(),
    meeting_min: z.number().int().positive().nullable().optional(),
    is_active: z.boolean().default(true),
  })
  .strict();
export type ServiceCreate = z.infer<typeof serviceCreate>;

export const serviceUpdate = serviceCreate.partial().strict();
export type ServiceUpdate = z.infer<typeof serviceUpdate>;

// ------------------- fotos de catalogo (P1 2026-08-28) -------------------

/** Piso tecnico del tamano de una foto decodificada (no configurable). */
export const DEFAULT_MAX_PHOTO_BYTES = 1_500_000;
/** Tope de fotos por producto. */
export const DEFAULT_MAX_PHOTOS_PER_SERVICE = 5;

// ---------------- carga masiva por CSV (pedido 2026-08-30) ----------------

/** Piso tecnico: filas maximas por importacion. */
export const DEFAULT_MAX_IMPORT_ROWS = 500;

export const catalogImport = z
  .object({
    /** Texto crudo del CSV (el server parsea y valida TODO). */
    csv: z.string().min(1).max(1_000_000),
    /** true = solo vista previa: valida y reporta sin crear nada. */
    dry_run: z.boolean().default(false),
  })
  .strict();
export type CatalogImport = z.infer<typeof catalogImport>;

export const servicePhotoCreate = z
  .object({
    /** data URL (data:image/png|jpeg|webp;base64,...) — mismo camino que el logo. */
    data: z
      .string()
      .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/, 'foto: data URL png/jpeg/webp')
      .max(2_200_000, 'foto demasiado grande (max ~1.5 MB)'),
    sort: z.number().int().min(0).max(99).default(0),
  })
  .strict();
export type ServicePhotoCreate = z.infer<typeof servicePhotoCreate>;
