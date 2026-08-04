import { z } from 'zod';

/** Telefono E.164 ('+5959xxxxxxxx'); mismo patron que el CHECK de la base. */
export const E164_REGEX = /^\+[1-9][0-9]{6,14}$/;
export const phoneE164 = z.string().regex(E164_REGEX, 'debe estar en formato E.164 (+5959...)');

/**
 * Digito verificador de RUC paraguayo (modulo 11, base 2..9 ciclica).
 * Contrato del doc 04 §4: se valida en la API y en el front con este mismo codigo.
 */
export function computeRucDv(ruc: string): number {
  const digits = ruc.replace(/\D/g, '');
  let factor = 2;
  let sum = 0;
  for (let i = digits.length - 1; i >= 0; i--) {
    sum += Number(digits[i]) * factor;
    factor = factor === 9 ? 2 : factor + 1;
  }
  const rest = sum % 11;
  return rest > 1 ? 11 - rest : 0;
}

/** RUC 'base-dv' (ej. '80012345-6'). */
export const rucWithDv = z
  .string()
  .regex(/^\d{5,8}-\d$/, "formato esperado 'base-dv', ej. 80012345-6")
  .refine(
    (v) => {
      const [base, dv] = v.split('-');
      return base !== undefined && dv !== undefined && computeRucDv(base) === Number(dv);
    },
    { message: 'digito verificador de RUC invalido' },
  );

export const uuid = z.uuid();

/** Paginacion cursor-based (doc 04 §1). */
export const paginationQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
});
export type PaginationQuery = z.infer<typeof paginationQuery>;

export interface Page<T> {
  data: T[];
  next_cursor: string | null;
}
