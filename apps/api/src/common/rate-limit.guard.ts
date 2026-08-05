import {
  HttpException,
  Injectable,
  SetMetadata,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';

export const RATE_LIMIT_KEY = 'rate_limit';

export interface RateLimitSpec {
  /** Cantidad maxima de requests por ventana. */
  limit: number;
  /** Ventana en segundos. */
  windowSec: number;
}

/** Limite por IP y por ruta. Ej: `@RateLimit(20, 300)` = 20 cada 5 minutos. */
export const RateLimit = (limit: number, windowSec: number) =>
  SetMetadata(RATE_LIMIT_KEY, { limit, windowSec } satisfies RateLimitSpec);

interface Window {
  count: number;
  resetAt: number;
}

/**
 * Rate limiting en memoria por instancia (doc 05 §2, hardening fase 1).
 * Suficiente para el laboratorio y como primera barrera en produccion,
 * donde ademas el borde (ALB/WAF) aplica su propio limite global.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly windows = new Map<string, Window>();

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const spec = this.reflector.getAllAndOverride<RateLimitSpec | undefined>(RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!spec) return true;

    const req = context.switchToHttp().getRequest<FastifyRequest>();
    const key = `${context.getClass().name}.${context.getHandler().name}:${req.ip}`;
    const now = Date.now();

    const current = this.windows.get(key);
    if (!current || current.resetAt <= now) {
      this.windows.set(key, { count: 1, resetAt: now + spec.windowSec * 1000 });
      this.prune(now);
      return true;
    }
    current.count += 1;
    if (current.count > spec.limit) {
      throw new HttpException(
        { title: 'Demasiados intentos, proba de nuevo en unos minutos' },
        429,
      );
    }
    return true;
  }

  /** Poda perezosa para que el mapa no crezca sin limite. */
  private prune(now: number): void {
    if (this.windows.size < 10_000) return;
    for (const [key, window] of this.windows) {
      if (window.resetAt <= now) this.windows.delete(key);
    }
  }
}
