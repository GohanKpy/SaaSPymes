import { Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { auditActionsQuery, auditChangesQuery, type AuditActionsQuery, type AuditChangesQuery } from '@pymes/shared';

import { PlatformRoles } from '../auth/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { AppPrisma } from '../prisma/app-prisma.service';
import { PlatformPrisma } from '../prisma/platform-prisma.service';

/**
 * Auditoria de seguridad para el portal admin (2026-09-07): acciones de
 * clientes y operadores (control.action_log) y cambios fila a fila con
 * estado anterior/nuevo (app.audit_log de cada tenant), unidos por request_id.
 * Solo lectura; lo lee admin y agente (soporte).
 */
@Controller('platform/audit')
@PlatformRoles('admin', 'agent')
export class AuditController {
  constructor(
    private readonly platformDb: PlatformPrisma,
    private readonly appDb: AppPrisma,
  ) {}

  @Get('actions')
  async actions(@Query(new ZodPipe(auditActionsQuery)) q: AuditActionsQuery) {
    const cursorId = q.cursor ? BigInt(q.cursor) : null;
    const rows = await this.platformDb.client.actionLog.findMany({
      where: {
        ...(q.tenant_id ? { tenantId: q.tenant_id } : {}),
        ...(q.scope ? { actorScope: q.scope } : {}),
        ...(q.actor
          ? /^[0-9a-f-]{36}$/i.test(q.actor)
            ? { actorUserId: q.actor }
            : { actorEmail: { contains: q.actor, mode: 'insensitive' } }
          : {}),
        ...(q.q
          ? {
              OR: [
                { path: { contains: q.q, mode: 'insensitive' } },
                { route: { contains: q.q, mode: 'insensitive' } },
                { errorTitle: { contains: q.q, mode: 'insensitive' } },
                { ip: { contains: q.q } },
                ...(/^[0-9a-f-]{36}$/i.test(q.q) ? [{ requestId: q.q }] : []),
              ],
            }
          : {}),
        ...(q.only_errors === 'true' ? { status: { gte: 400 } } : {}),
        ...(q.from || q.to ? { at: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } } : {}),
        ...(cursorId ? { id: { lt: cursorId } } : {}),
      },
      orderBy: { id: 'desc' },
      take: q.limit + 1,
    });
    const hasMore = rows.length > q.limit;
    const data = hasMore ? rows.slice(0, q.limit) : rows;
    const tenantIds = [...new Set(data.map((r) => r.tenantId).filter((x): x is string => Boolean(x)))];
    const tenants = tenantIds.length
      ? await this.platformDb.client.tenant.findMany({ where: { id: { in: tenantIds } }, select: { id: true, tradeName: true, legalName: true } })
      : [];
    const nombre = new Map(tenants.map((t) => [t.id, t.tradeName ?? t.legalName]));
    return {
      data: data.map((r) => ({ ...r, id: String(r.id), tenant_name: r.tenantId ? (nombre.get(r.tenantId) ?? null) : null })),
      next_cursor: hasMore ? String(data[data.length - 1]!.id) : null,
    };
  }

  /** Una accion con los cambios fila a fila que causo (mismo request_id). */
  @Get('actions/:id')
  async action(@Param('id') id: string) {
    if (!/^\d+$/.test(id)) throw new NotFoundException();
    const row = await this.platformDb.client.actionLog.findUnique({ where: { id: BigInt(id) } });
    if (!row) throw new NotFoundException();
    let changes: unknown[] = [];
    if (row.tenantId && row.requestId) {
      changes = await this.appDb.tx({ tenantId: row.tenantId, actorType: 'system' }, (tx) =>
        tx.auditLog.findMany({ where: { requestId: row.requestId! }, orderBy: { id: 'asc' }, take: 200 }),
      );
    }
    // Acciones del portal admin: lo que los servicios anotaron alrededor del pedido.
    const platformChanges =
      row.actorScope === 'platform'
        ? await this.platformDb.client.platformAuditLog.findMany({
            where: {
              actorId: row.actorUserId,
              createdAt: { gte: new Date(row.at.getTime() - 5_000), lte: new Date(row.at.getTime() + 5_000) },
            },
            orderBy: { id: 'asc' },
            take: 50,
          })
        : [];
    return {
      ...row,
      id: String(row.id),
      changes: (changes as { id: bigint }[]).map((c) => ({ ...c, id: String(c.id) })),
      platform_changes: platformChanges.map((c) => ({ ...c, id: String(c.id) })),
    };
  }

  /** Cambios fila a fila de un cliente (historial de un registro, de un usuario o de un pedido). */
  @Get('changes')
  async changes(@Query(new ZodPipe(auditChangesQuery)) q: AuditChangesQuery) {
    const cursorId = q.cursor ? BigInt(q.cursor) : null;
    return this.appDb.tx({ tenantId: q.tenant_id, actorType: 'system' }, async (tx) => {
      const rows = await tx.auditLog.findMany({
        where: {
          ...(q.entity ? { entity: q.entity } : {}),
          ...(q.entity_id ? { entityId: q.entity_id } : {}),
          ...(q.actor_user_id ? { actorUserId: q.actor_user_id } : {}),
          ...(q.request_id ? { requestId: q.request_id } : {}),
          ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } } : {}),
          ...(cursorId ? { id: { lt: cursorId } } : {}),
        },
        orderBy: { id: 'desc' },
        take: q.limit + 1,
      });
      const hasMore = rows.length > q.limit;
      const data = hasMore ? rows.slice(0, q.limit) : rows;
      const userIds = [...new Set(data.map((r) => r.actorUserId).filter((x): x is string => Boolean(x)))];
      const users = userIds.length ? await tx.user.findMany({ where: { id: { in: userIds } }, select: { id: true, email: true, fullName: true } }) : [];
      const porId = new Map(users.map((u) => [u.id, u]));
      const entities = await tx.auditLog.groupBy({ by: ['entity'], _count: { _all: true } });
      return {
        data: data.map((r) => ({ ...r, id: String(r.id), actor: r.actorUserId ? (porId.get(r.actorUserId) ?? null) : null })),
        next_cursor: hasMore ? String(data[data.length - 1]!.id) : null,
        entities: entities.map((e) => ({ entity: e.entity, count: e._count._all })),
      };
    });
  }
}
