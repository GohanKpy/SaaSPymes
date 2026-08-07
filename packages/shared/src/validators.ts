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

/**
 * Monto en guaranies: entero, sin decimales. Un humano tipea "150.000" o
 * "150,000" (separador de miles); en Gs el punto jamas es decimal, asi que
 * solo se limpia el agrupado exacto de a 3 digitos — cualquier otro formato
 * sigue su curso y falla la validacion con el error de campo.
 */
const limpiarMiles = (v: unknown): unknown => {
  if (typeof v !== 'string') return v;
  const trimmed = v.trim();
  return /^\d{1,3}([.,]\d{3})+$/.test(trimmed) ? trimmed.replace(/[.,]/g, '') : trimmed;
};

/** Envuelve un schema de monto para aceptar el formato humano con miles. */
export const montoGs = <T extends z.ZodType>(schema: T) => z.preprocess(limpiarMiles, schema);

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
