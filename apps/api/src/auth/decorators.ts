import { SetMetadata } from '@nestjs/common';
import type { AccessTokenClaims } from '@pymes/shared';

export const IS_PUBLIC = 'isPublic';
/** Ruta sin JWT (webhooks con verificacion propia, login, health). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const ROLES = 'roles';
/** Roles de tenant permitidos (root|admin|staff). Capa 2 (doc 04 §2). */
export const Roles = (...roles: string[]) => SetMetadata(ROLES, roles);

export const PLATFORM_ROLES = 'platformRoles';
/** Ruta exclusiva de plataforma; roles padmin ('admin') / pagent ('agent'). */
export const PlatformRoles = (...roles: string[]) => SetMetadata(PLATFORM_ROLES, roles);

export const FEATURE = 'feature';
/** Capa 3: feature habilitada segun plan + overrides (doc 04 §2). */
export const RequireFeature = (code: string) => SetMetadata(FEATURE, code);

/** Claims autenticados colgados del request por JwtAuthGuard. */
export interface AuthRequest {
  authUser?: AccessTokenClaims;
}
