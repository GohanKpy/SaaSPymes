import { type CanActivate, type ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';

import { PLATFORM_ROLES, ROLES, type AuthRequest } from '../decorators';

/** Capa 2: rol y ambito (doc 04 §2). Sin metadata de roles, solo exige JWT. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<FastifyRequest & AuthRequest>();
    const user = req.authUser;
    if (!user) return true; // ruta @Public

    const platformRoles = this.reflector.getAllAndOverride<string[] | undefined>(PLATFORM_ROLES, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (platformRoles) {
      if (user.scope !== 'platform' || (platformRoles.length > 0 && !platformRoles.includes(user.role))) {
        throw new ForbiddenException();
      }
      return true;
    }

    const roles = this.reflector.getAllAndOverride<string[] | undefined>(ROLES, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (roles) {
      if (user.scope !== 'tenant' || !roles.includes(user.role)) throw new ForbiddenException();
    } else if (user.scope !== 'tenant') {
      // Rutas de tenant sin metadata explicita: cualquier rol del tenant.
      throw new ForbiddenException();
    }
    return true;
  }
}
