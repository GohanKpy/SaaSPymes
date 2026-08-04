import { type CanActivate, type ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';

import { IS_PUBLIC, type AuthRequest } from '../decorators';
import { JwtSigner } from '../jwt.service';

/** Capa 1: autenticacion JWT (doc 04 §2). */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtSigner,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<FastifyRequest & AuthRequest>();
    const header = req.headers.authorization;
    // EventSource no permite headers: el stream SSE acepta ?access_token=.
    const query = (req.query as Record<string, string | undefined>) ?? {};
    const token = header?.startsWith('Bearer ') ? header.slice(7) : query.access_token;
    if (!token) throw new UnauthorizedException();

    try {
      req.authUser = await this.jwt.verify(token);
      return true;
    } catch {
      throw new UnauthorizedException();
    }
  }
}
