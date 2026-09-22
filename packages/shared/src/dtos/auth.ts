import { z } from 'zod';

import { uuid } from '../validators';

export const loginRequest = z
  .object({
    email: z.email(),
    password: z.string().min(1),
    scope: z.enum(['tenant', 'platform']).default('tenant'),
    // El mismo email puede existir en varios tenants: segunda vuelta con eleccion.
    tenant_id: uuid.optional(),
    totp_code: z.string().length(6).optional(),
  })
  .strict();
export type LoginRequest = z.infer<typeof loginRequest>;

export interface AuthUser {
  id: string;
  email: string;
  full_name: string;
  role: string; // tenant: root|admin|staff · plataforma: admin|agent
  scope: 'tenant' | 'platform';
  tenant_id?: string;
  branches?: string[];
}

/** Sesion de soporte (2026-09-22): un agente de la plataforma dentro del panel de un cliente, con su token. */
export interface SupportInfo {
  /** Email del agente de soporte. */
  agent: string;
  /** Vencimiento ISO de la sesion (sin renovacion). */
  until: string;
}

export interface LoginResponse {
  access_token?: string;
  user?: (AuthUser & { support?: SupportInfo });
  /** Presente cuando el email existe en mas de un tenant. */
  tenant_options?: { id: string; name: string }[];
}

/** Claims del JWT (doc 05 §3). */
export interface AccessTokenClaims {
  sub: string;
  scope: 'tenant' | 'platform';
  tid?: string;
  role: string;
  branches?: string[];
  jti: string;
  /** Sesion de soporte (2026-09-22): agente de plataforma dentro de un tenant; spe = su email. */
  sup?: boolean;
  spe?: string;
}

// ---------------- Google y soporte (2026-09-22, ADR 0014) ----------------

/** Cierre del login con Google: codigo de un solo uso que dejo el callback. */
export const googleComplete = z
  .object({
    code: z.string().min(20).max(4000),
    tenant_id: uuid.optional(),
  })
  .strict();
export type GoogleComplete = z.infer<typeof googleComplete>;

export const googleStartQuery = z.object({
  scope: z.enum(['tenant', 'platform']).default('tenant'),
  /** Origen del panel que inicio el flujo (tiene que estar en WEB_ORIGIN). */
  origin: z.string().url(),
});
export type GoogleStartQuery = z.infer<typeof googleStartQuery>;

/** Sesion de soporte: codigo de un solo uso que emitio el portal admin con el token del cliente. */
export const supportComplete = z.object({ code: z.string().min(20).max(4000) }).strict();
export type SupportComplete = z.infer<typeof supportComplete>;

/** Padmin pide entrar como un cliente: el token que el cliente le dio. */
export const supportAccessRequest = z.object({ token: z.string().trim().min(4).max(64) }).strict();
export type SupportAccessRequest = z.infer<typeof supportAccessRequest>;

/** El cliente genera un token de soporte con vencimiento (horas). */
export const supportTokenCreate = z.object({ hours: z.number().int().min(1).max(168).default(24) }).strict();
export type SupportTokenCreate = z.infer<typeof supportTokenCreate>;
