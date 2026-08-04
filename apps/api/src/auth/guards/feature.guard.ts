import { type CanActivate, type ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';

import { FEATURE, type AuthRequest } from '../decorators';
import { FeaturesService } from '../features.service';

/**
 * Capa 3 (doc 04 §2): la feature debe estar habilitada por plan + overrides.
 * El 403 lleva type feature-not-enabled para que la UI ofrezca el upgrade.
 */
@Injectable()
export class FeatureGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly features: FeaturesService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const code = this.reflector.getAllAndOverride<string | undefined>(FEATURE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!code) return true;

    const req = context.switchToHttp().getRequest<FastifyRequest & AuthRequest>();
    const user = req.authUser;
    if (!user) return true; // ruta @Public
    if (user.scope === 'platform') return true; // plataforma no esta sujeta a planes

    if (!user.tid || !(await this.features.isEnabled(user.tid, code))) {
      throw new ForbiddenException({
        type: 'https://docs.pymes.local/errors/feature-not-enabled',
        title: `La funcionalidad '${code}' no esta habilitada en tu plan`,
      });
    }
    return true;
  }
}
