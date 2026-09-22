import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@pymes/db';
import type { FastifyReply, FastifyRequest } from 'fastify';

import type { AuthRequest } from '../auth/decorators';
import { AppPrisma } from '../prisma/app-prisma.service';
import { PlatformPrisma } from '../prisma/platform-prisma.service';
import { cuerpoParaAuditoria } from './redact';

const METODOS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
/** Rutas que no son acciones de personas (webhooks de Meta, renovacion silenciosa del token, salud). */
const EXCLUIDAS = [/^\/health/, /^\/api\/v1\/webhooks\//, /^\/api\/v1\/auth\/refresh$/];
const EMAIL_CACHE_MS = 10 * 60_000;

/**
 * Registro de acciones (auditoria de seguridad, pedido de Johan 2026-09-07).
 * Se alimenta desde hooks de Fastify (ver app.factory): captura TODO pedido
 * que cambia algo, incluidos los rechazados por el guard (token invalido) y
 * los intentos de login fallidos. Escribe fuera del ciclo del pedido: jamas
 * lo frena ni lo hace fallar.
 */
@Injectable()
export class ActionLogService {
  private readonly logger = new Logger('ActionLog');
  private readonly emails = new Map<string, { at: number; email: string | null }>();

  constructor(
    private readonly platformDb: PlatformPrisma,
    private readonly appDb: AppPrisma,
  ) {}

  debeRegistrar(req: FastifyRequest): boolean {
    if (!METODOS.has(req.method)) return false;
    const url = req.url.split('?')[0] ?? req.url;
    return !EXCLUIDAS.some((re) => re.test(url));
  }

  /** Llamado en onResponse: arma la fila y la guarda en segundo plano. */
  registrar(req: FastifyRequest & AuthRequest, reply: FastifyReply): void {
    if (!this.debeRegistrar(req)) return;
    const user = req.authUser;
    const url = req.url;
    const path = (url.split('?')[0] ?? url).replace(/^\/api\/v1/, '') || '/';
    const route = (req.routeOptions?.url ?? '').replace(/^\/api\/v1/, '') || null;
    const entrada = {
      requestId: req.requestId ?? null,
      tenantId: user?.scope === 'tenant' ? (user.tid ?? null) : null,
      actorUserId: user?.sub ?? null,
      // Sesion de soporte (2026-09-22): el actor es de plataforma aunque el token sea del tenant.
      actorScope: user?.sup ? 'platform' : (user?.scope ?? 'anon'),
      actorRole: user?.role ?? null,
      ip: req.ip ?? null,
      userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'].slice(0, 300) : null,
      method: req.method,
      path: path.slice(0, 500),
      route,
      status: reply.statusCode,
      durationMs: Math.round(reply.elapsedTime ?? 0),
      body: cuerpoParaAuditoria(req.body) as Prisma.InputJsonValue | null,
      errorTitle: reply.statusCode >= 400 ? (req.problemTitle ?? null) : null,
    };
    void this.guardar(entrada).catch((error) => {
      this.logger.warn(`no se pudo registrar la accion ${entrada.method} ${entrada.path}: ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  private async guardar(e: {
    requestId: string | null;
    tenantId: string | null;
    actorUserId: string | null;
    actorScope: string;
    actorRole: string | null;
    ip: string | null;
    userAgent: string | null;
    method: string;
    path: string;
    route: string | null;
    status: number;
    durationMs: number;
    body: Prisma.InputJsonValue | null;
    errorTitle: string | null;
  }): Promise<void> {
    const actorEmail = await this.emailDe(e.actorScope, e.tenantId, e.actorUserId);
    await this.platformDb.client.actionLog.create({
      data: {
        requestId: e.requestId,
        tenantId: e.tenantId,
        actorUserId: e.actorUserId,
        actorScope: e.actorScope,
        actorRole: e.actorRole,
        actorEmail,
        ip: e.ip,
        userAgent: e.userAgent,
        method: e.method,
        path: e.path,
        route: e.route,
        status: e.status,
        durationMs: e.durationMs,
        body: e.body === null ? undefined : e.body,
        errorTitle: e.errorTitle,
      },
    });
  }

  /** Email del actor para leer el registro sin joins entre esquemas; cache de 10 min. */
  private async emailDe(scope: string, tenantId: string | null, userId: string | null): Promise<string | null> {
    if (!userId) return null;
    const key = `${scope}:${userId}`;
    const hit = this.emails.get(key);
    if (hit && Date.now() - hit.at < EMAIL_CACHE_MS) return hit.email;
    let email: string | null = null;
    try {
      if (scope === 'platform') {
        const u = await this.platformDb.client.platformUser.findUnique({ where: { id: userId }, select: { email: true } });
        email = u?.email ?? null;
      } else if (scope === 'tenant' && tenantId) {
        email = await this.appDb.tx({ tenantId, actorType: 'system' }, async (tx) => {
          const u = await tx.user.findFirst({ where: { id: userId }, select: { email: true } });
          return u?.email ?? null;
        });
      }
    } catch {
      email = null;
    }
    this.emails.set(key, { at: Date.now(), email });
    return email;
  }
}
