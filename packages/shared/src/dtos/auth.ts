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

export interface LoginResponse {
  access_token?: string;
  user?: AuthUser;
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
}
