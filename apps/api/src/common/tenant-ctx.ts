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
  return {
    tenantId: user.tid,
    userId: user.sub,
    // Sesion de soporte (2026-09-22): el actor es un agente de la plataforma,
    // y asi queda en la auditoria del negocio.
    actorType: user.sup ? 'platform' : 'user',
    // Auditoria de seguridad (2026-09-07): la IP y el id del pedido viajan a los triggers.
    ip: req.ip,
    requestId: req.requestId,
    userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined,
  };
}
