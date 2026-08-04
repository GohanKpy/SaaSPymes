import { ForbiddenException } from '@nestjs/common';
import type { TenantContext } from '@pymes/db';
import type { FastifyRequest } from 'fastify';

import type { AuthRequest } from '../auth/decorators';

/**
 * Contexto RLS desde el JWT: el tenant_id SIEMPRE sale del token, jamas del
 * request (doc 05 §2, barrera 1).
 */
export function tenantCtx(req: FastifyRequest & AuthRequest): TenantContext {
  const user = req.authUser;
  if (!user || user.scope !== 'tenant' || !user.tid) throw new ForbiddenException();
  return { tenantId: user.tid, userId: user.sub, actorType: 'user' };
}
