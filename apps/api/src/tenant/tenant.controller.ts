import { randomInt } from 'node:crypto';

import { Body, Controller, Delete, Get, HttpCode, NotFoundException, Patch, Post, Put, Req } from '@nestjs/common';
import {
  supportTokenCreate,
  tenantSelfPatch,
  tenantSettingsPut,
  type EffectiveFeature,
  type SupportTokenCreate,
  type TenantSelfPatch,
  type TenantSettingsPut,
} from '@pymes/shared';
import type { FastifyRequest } from 'fastify';

import { Prisma } from '@pymes/db';

import { Roles, type AuthRequest } from '../auth/decorators';
import { hashSupportToken, vistaToken } from '../common/support-token';
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
        devMode: true,
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
        devMode: dto.dev_mode,
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
        devMode: true,
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
  /** Ajustes del negocio (2026-09-07): cierre de la cuenta mensual y anticipacion de recurrentes. */
  @Get('settings')
  async settings(@Req() req: FastifyRequest & AuthRequest) {
    const ctx = tenantCtx(req);
    const row = await this.appDb.tx(ctx, (tx) => tx.tenantSettings.findUnique({ where: { tenantId: ctx.tenantId } }));
    return {
      monthly_close_day: row?.monthlyCloseDay ?? 1,
      monthly_auto_invoice: row?.monthlyAutoInvoice ?? false,
      recurring_lead_days: row?.recurringLeadDays ?? 7,
      allow_negative_stock: row?.allowNegativeStock ?? false,
      low_stock_alerts: row?.lowStockAlerts ?? true,
    };
  }

  @Put('settings')
  @Roles('root', 'admin')
  async putSettings(@Body(new ZodPipe(tenantSettingsPut)) dto: TenantSettingsPut, @Req() req: FastifyRequest & AuthRequest) {
    const ctx = tenantCtx(req);
    const row = await this.appDb.tx(ctx, (tx) =>
      tx.tenantSettings.upsert({
        where: { tenantId: ctx.tenantId },
        update: {
          monthlyCloseDay: dto.monthly_close_day,
          monthlyAutoInvoice: dto.monthly_auto_invoice,
          recurringLeadDays: dto.recurring_lead_days,
          allowNegativeStock: dto.allow_negative_stock,
          lowStockAlerts: dto.low_stock_alerts,
          updatedBy: ctx.userId,
        },
        create: {
          tenantId: ctx.tenantId,
          monthlyCloseDay: dto.monthly_close_day ?? 1,
          monthlyAutoInvoice: dto.monthly_auto_invoice ?? false,
          recurringLeadDays: dto.recurring_lead_days ?? 7,
          allowNegativeStock: dto.allow_negative_stock ?? false,
          lowStockAlerts: dto.low_stock_alerts ?? true,
          updatedBy: ctx.userId,
        },
      }),
    );
    return {
      monthly_close_day: row.monthlyCloseDay,
      monthly_auto_invoice: row.monthlyAutoInvoice,
      recurring_lead_days: row.recurringLeadDays,
      allow_negative_stock: row.allowNegativeStock,
      low_stock_alerts: row.lowStockAlerts,
    };
  }

  // ---------------- token de soporte (2026-09-22, ADR 0014) ----------------

  /** Estado del token (nunca su valor): vigente, vencido, inicial 1111 o sin token. */
  @Get('support-token')
  @Roles('root', 'admin')
  async supportToken(@Req() req: FastifyRequest & AuthRequest) {
    const { tenantId } = tenantCtx(req);
    const t = await this.appDb.client.tenant.findUnique({
      where: { id: tenantId },
      select: { supportTokenHash: true, supportTokenExpiresAt: true, supportTokenCreatedAt: true },
    });
    return vistaToken(tenantId, t);
  }

  /** Genera un token nuevo (6 digitos) con vencimiento; se muestra UNA vez. */
  @Post('support-token')
  @Roles('root', 'admin')
  async createSupportToken(@Body(new ZodPipe(supportTokenCreate)) dto: SupportTokenCreate, @Req() req: FastifyRequest & AuthRequest) {
    const ctx = tenantCtx(req);
    const token = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const expiresAt = new Date(Date.now() + dto.hours * 3600 * 1000);
    await this.appDb.client.tenant.update({
      where: { id: ctx.tenantId },
      data: {
        supportTokenHash: hashSupportToken(ctx.tenantId, token),
        supportTokenExpiresAt: expiresAt,
        supportTokenCreatedAt: new Date(),
        supportTokenCreatedBy: ctx.userId ?? null,
      },
    });
    await this.appDb.tx(ctx, (tx) =>
      tx.auditLog.create({
        data: { tenantId: ctx.tenantId, actorUserId: ctx.userId, action: 'tenant.support_token_created', entity: 'tenants', entityId: ctx.tenantId, ip: req.ip },
      }),
    );
    return { token, expires_at: expiresAt.toISOString() };
  }

  /** Revoca el token: nadie de la plataforma puede entrar hasta generar otro. */
  @Delete('support-token')
  @Roles('root', 'admin')
  @HttpCode(204)
  async revokeSupportToken(@Req() req: FastifyRequest & AuthRequest) {
    const ctx = tenantCtx(req);
    await this.appDb.client.tenant.update({
      where: { id: ctx.tenantId },
      data: { supportTokenHash: null, supportTokenExpiresAt: null, supportTokenCreatedAt: null, supportTokenCreatedBy: null },
    });
    await this.appDb.tx(ctx, (tx) =>
      tx.auditLog.create({
        data: { tenantId: ctx.tenantId, actorUserId: ctx.userId, action: 'tenant.support_token_revoked', entity: 'tenants', entityId: ctx.tenantId, ip: req.ip },
      }),
    );
  }

  @Get('features')
  features_(@Req() req: FastifyRequest & AuthRequest): Promise<EffectiveFeature[]> {
    return this.features.effective(tenantCtx(req).tenantId);
  }
}
