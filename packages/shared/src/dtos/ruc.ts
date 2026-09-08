import { z } from 'zod';

// Padron RUC de la DNIT (ADR 0012): consulta de un contribuyente por RUC para
// completar razon social y DV al tipear (formularios de clientes y facturas).

/** Lo que tipea el usuario: '80012345', '80012345-6', '80.012.345' o con letra final. */
export const rucParam = z.string().trim().min(3).max(16);

/**
 * Normaliza un RUC tipeado a la clave del padron: sin puntos ni espacios, en
 * mayusculas y SIN el digito verificador ('80012345-6' -> '80012345').
 * Vacio si no queda nada util.
 */
export function normalizarRuc(input: string): string {
  const base = (input.split('-')[0] ?? '').replace(/[^0-9a-zA-Z]/g, '').toUpperCase();
  return /^\d{3,8}[A-Z]?$/.test(base) ? base : '';
}

export interface RucLookupView {
  /** true si el RUC esta en el padron descargado de la DNIT. */
  found: boolean;
  /** RUC normalizado (sin DV). */
  ruc: string;
  /** DV del padron; si no esta, el calculado por modulo 11 (o null si no aplica). */
  dv: string | null;
  razon_social: string | null;
  /** ACTIVO | SUSPENSION TEMPORAL | BLOQUEADO | CANCELADO | CANCELADO DEFINITIVO */
  estado: string | null;
  ruc_anterior: string | null;
  /** Ultima descarga que toco esta fila. */
  updated_at: string | null;
}
