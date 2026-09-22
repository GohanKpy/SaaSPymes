import { randomUUID } from 'node:crypto';

import { Body, Controller, ForbiddenException, NotFoundException, Param, Post, Req } from '@nestjs/common';
import { supportAccessRequest, uuid, type SupportAccessRequest } from '@pymes/shared';
import type { FastifyRequest } from 'fastify';

import type { SupportCode } from '../auth/sso.controller';
import { PlatformRoles, type AuthRequest } from '../auth/decorators';
import { CryptoService } from '../common/crypto.service';
import { NotifierService } from '../notifications/notifier.service';
import { PlatformPrisma } from '../prisma/platform-prisma.service';
import { hashSupportToken } from '../common/support-token';
import { ZodPipe } from '../common/zod.pipe';

const CODE_TTL_MS = 60_000;
const MAX_FALLOS = 5;
const BLOQUEO_MS = 15 * 60_000;

/**
 * Acceder como cliente (2026-09-22, ADR 0014): padmin presenta el token que
 * le dio el cliente; si coincide y esta vigente, recibe un codigo de un solo
 * uso que el panel del cliente canjea por una sesion de soporte de 60 min.
 * Queda auditado en la plataforma y en el negocio, y el negocio recibe un
 * correo. Cinco tokens equivocados seguidos bloquean 15 minutos.
 */
@Controller('platform/tenants')
export class SupportAccessController {
  private readonly fallos = new Map<string, { count: number; until: number }>();

  constructor(
    private readonly platformDb: PlatformPrisma,
    private readonly crypto: CryptoService,
    private readonly notifier: NotifierService,
  ) {}

  @Post(':id/support-access')
  @PlatformRoles('admin', 'agent')
  async supportAccess(
    @Param('id', new ZodPipe(uuid)) tenantId: string,
    @Body(new ZodPipe(supportAccessRequest)) dto: SupportAccessRequest,
    @Req() req: FastifyRequest & AuthRequest,
  ) {
    const actor = req.authUser;
    if (!actor) throw new ForbiddenException();
    const clave = `${actor.sub}:${tenantId}`;
    const f = this.fallos.get(clave);
    if (f && f.count >= MAX_FALLOS && f.until > Date.now()) {
      throw new ForbiddenException({ title: 'Demasiados intentos con un token incorrecto: esperá 15 minutos' });
    }
    const tenant = await this.platformDb.client.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, tradeName: true, legalName: true, status: true, supportTokenHash: true, supportTokenExpiresAt: true },
    });
    if (!tenant) throw new NotFoundException();
    const vigente = tenant.supportTokenHash && (!tenant.supportTokenExpiresAt || tenant.supportTokenExpiresAt.getTime() > Date.now());
    if (!vigente || tenant.supportTokenHash !== hashSupportToken(tenantId, dto.token)) {
      const prev = this.fallos.get(clave) ?? { count: 0, until: 0 };
      this.fallos.set(clave, { count: prev.count + 1, until: Date.now() + BLOQUEO_MS });
      await this.platformDb.client.platformAuditLog.create({
        data: { actorId: actor.sub, action: 'tenant.support_access_denied', entity: 'tenants', entityId: tenantId, ip: req.ip, detail: { reason: vigente ? 'token_incorrecto' : 'sin_token_vigente' } },
      });
      throw new ForbiddenException({
        title: vigente ? 'El token de soporte no coincide' : 'El cliente no tiene un token de soporte vigente: pedile que genere uno desde Ajustes → Mi cuenta',
      });
    }
    this.fallos.delete(clave);
    const agent = await this.platformDb.client.platformUser.findUnique({ where: { id: actor.sub }, select: { id: true, email: true, fullName: true } });
    if (!agent) throw new ForbiddenException();
    const code: SupportCode = { k: 'support', tid: tenantId, pid: agent.id, exp: Date.now() + CODE_TTL_MS, n: randomUUID() };
    await this.platformDb.client.platformAuditLog.create({
      data: { actorId: agent.id, action: 'tenant.support_access', entity: 'tenants', entityId: tenantId, ip: req.ip, detail: { agent: agent.email } },
    });
    const negocio = tenant.tradeName ?? tenant.legalName;
    void this.notifier.ownerEmail(
      tenantId,
      `${negocio}: acceso de soporte a tu panel`,
      `${agent.fullName} (${agent.email}) entró a tu panel con tu token de soporte el ${new Date().toLocaleString('es-PY')}. La sesión dura hasta 60 minutos y todo lo que haga queda registrado en tu auditoría. Si no lo autorizaste, revocá el token desde Ajustes → Mi cuenta.`,
    );
    return { code: Buffer.from(this.crypto.encryptJson(code)).toString('base64url'), expires_in: CODE_TTL_MS / 1000, tenant: negocio };
  }
}
