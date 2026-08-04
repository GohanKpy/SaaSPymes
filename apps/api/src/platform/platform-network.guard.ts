import {
  Inject,
  Injectable,
  NotFoundException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { Env } from '@pymes/shared';
import type { FastifyRequest } from 'fastify';

import { ipAllowed } from '../common/ip';
import { ENV } from '../env.module';

/**
 * Restriccion por IP de la superficie de plataforma (ADR 0004): con
 * PLATFORM_ALLOWED_IPS configurada, todo /platform/* fuera de la lista
 * responde 404 opaco. Vacia = sin restriccion (laboratorio). En produccion
 * se suma la capa de perimetro sobre el hostname del portal admin.
 */
@Injectable()
export class PlatformNetworkGuard implements CanActivate {
  constructor(@Inject(ENV) private readonly env: Env) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<FastifyRequest>();
    if (!ipAllowed(req.ip, this.env.PLATFORM_ALLOWED_IPS)) {
      throw new NotFoundException();
    }
    return true;
  }
}
