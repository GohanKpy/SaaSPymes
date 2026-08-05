import { Body, Controller, Get, NotFoundException, Patch, Req } from '@nestjs/common';
import { tenantSelfPatch, type EffectiveFeature, type TenantSelfPatch } from '@pymes/shared';
import type { FastifyRequest } from 'fastify';

import { Prisma } from '@pymes/db';

import { Roles, type AuthRequest } from '../auth/decorators';
import { FeaturesService } from '../auth/features.service';
import { tenantCtx } from '../common/tenant-ctx';
import { ZodPipe } from '../common/zod.pipe';
import { AppPrisma } from '../prisma/app-prisma.service';

@Controller('tenant')
export class TenantController {
  constructor(
    private readonly appDb: AppPrisma,
    private readonly features: FeaturesService,
  ) {}

  @Get()
  async get(@Req() req: FastifyRequest & AuthRequest) {
    const { tenantId } = tenantCtx(req);
    // control.tenants no lleva RLS; app_rw tiene SELECT y el id sale del token.
    const tenant = await this.appDb.client.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        legalName: true,
        tradeName: true,
        ruc: true,
        status: true,
        timezone: true,
        branding: true,
        currentPlan: { select: { code: true, name: true } },
      },
    });
    if (!tenant) throw new NotFoundException();
    return tenant;
  }

  @Patch()
  @Roles('root')
  async patch(
    @Body(new ZodPipe(tenantSelfPatch)) dto: TenantSelfPatch,
    @Req() req: FastifyRequest & AuthRequest,
  ) {
    const ctx = tenantCtx(req);
    const tenant = await this.appDb.client.tenant.update({
      where: { id: ctx.tenantId },
      data: {
        legalName: dto.legal_name,
        tradeName: dto.trade_name,
        ruc: dto.ruc,
        timezone: dto.timezone,
        branding: dto.branding as Prisma.InputJsonValue | undefined,
      },
      // Mismo select que el GET: los campos CRM del dueño del sistema
      // (contacto, notas internas; ADR 0005) jamas salen por el scope tenant.
      select: {
        id: true,
        legalName: true,
        tradeName: true,
        ruc: true,
        status: true,
        timezone: true,
        branding: true,
        currentPlan: { select: { code: true, name: true } },
      },
    });
    await this.appDb.tx(ctx, (tx) =>
      tx.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorUserId: ctx.userId,
          action: 'tenant.update',
          entity: 'tenants',
          entityId: ctx.tenantId,
          after: dto as object,
        },
      }),
    );
    return tenant;
  }

  /** Features efectivas para que la UI muestre u oculte modulos (doc 04 §3.2). */
  @Get('features')
  features_(@Req() req: FastifyRequest & AuthRequest): Promise<EffectiveFeature[]> {
    return this.features.effective(tenantCtx(req).tenantId);
  }
}
