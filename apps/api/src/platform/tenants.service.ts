import { randomBytes } from 'node:crypto';

import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { hash } from '@node-rs/argon2';
import type { TenantCreate, TenantPatch } from '@pymes/shared';

import { Prisma } from '@pymes/db';

import { FeaturesService } from '../auth/features.service';
import { PlatformPrisma } from '../prisma/platform-prisma.service';

// Parametros Argon2id del doc 05 §3.
export const ARGON2_OPTIONS = { memoryCost: 65536, timeCost: 3, parallelism: 4 } as const;

@Injectable()
export class TenantsService {
  constructor(
    private readonly platformDb: PlatformPrisma,
    private readonly features: FeaturesService,
  ) {}

  list() {
    return this.platformDb.client.tenant.findMany({
      include: { currentPlan: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Ficha completa para el portal admin: datos CRM + usuarios del tenant. */
  async get(id: string) {
    const tenant = await this.platformDb.client.tenant.findUnique({
      where: { id },
      include: {
        currentPlan: true,
        featureOverrides: { include: { feature: true } },
      },
    });
    if (!tenant) throw new NotFoundException();
    // platform_ops lee app.users de todos los tenants (lo exige el login
    // multi-tenant), asi que el scope de la ficha se filtra aca, explicito.
    const { users, botBudget, botUsage } = await this.platformDb.tx(
      { tenantId: id, actorType: 'platform' },
      async (tx) => {
        const list = await tx.user.findMany({
          where: { tenantId: id, deletedAt: null },
          select: {
            id: true,
            email: true,
            fullName: true,
            role: true,
            isActive: true,
            lastLoginAt: true,
          },
          orderBy: { createdAt: 'asc' },
        });
        const settings = await tx.botSettings.findUnique({ where: { tenantId: id } });
        const period = new Date()
          .toLocaleDateString('en-CA', { timeZone: tenant.timezone })
          .slice(0, 7);
        const usage = await tx.botUsageMonthly.findUnique({
          where: { tenantId_period: { tenantId: id, period } },
        });
        return {
          users: list,
          botBudget: settings?.monthlyTokenBudget ?? null,
          botUsage: {
            period,
            input_tokens: Number(usage?.inputTokens ?? 0n),
            output_tokens: Number(usage?.outputTokens ?? 0n),
            turns: usage?.turns ?? 0,
          },
        };
      },
    );
    return { ...tenant, users, bot_budget: botBudget, bot_usage: botUsage };
  }

  /** Presupuesto mensual de IA del tenant: decision del dueño del sistema (ADR 0006). */
  async setBotBudget(id: string, budget: number, actorId: string, ip: string) {
    const tenant = await this.platformDb.client.tenant.findUnique({ where: { id } });
    if (!tenant) throw new NotFoundException();
    await this.platformDb.tx({ tenantId: id, actorType: 'platform' }, (tx) =>
      tx.botSettings.upsert({
        where: { tenantId: id },
        update: { monthlyTokenBudget: budget },
        create: { tenantId: id, monthlyTokenBudget: budget },
      }),
    );
    await this.audit(actorId, 'tenant.bot_budget', id, ip, { monthly_token_budget: budget });
    return { monthly_token_budget: budget };
  }

  /**
   * Alta de tenant (doc 08 §3 recorrido 1): tenant + sucursal principal +
   * usuario root + bot_settings, todo bajo el contexto RLS del tenant nuevo.
   * Devuelve la password temporal UNA sola vez.
   */
  async create(dto: TenantCreate, actorId: string, ip: string) {
    const plan = await this.platformDb.client.plan.findUnique({ where: { code: dto.plan_code } });
    if (!plan) throw new UnprocessableEntityException({ title: 'Plan inexistente' });

    const tenant = await this.platformDb.client.tenant.create({
      data: {
        legalName: dto.legal_name,
        tradeName: dto.trade_name,
        ruc: dto.ruc,
        timezone: dto.timezone,
        currentPlanId: plan.id,
        contactName: dto.contact_name,
        contactEmail: dto.contact_email,
        contactPhone: dto.contact_phone,
        notes: dto.notes,
      },
    });

    const tempPassword = randomBytes(9).toString('base64url');
    const passwordHash = await hash(tempPassword, ARGON2_OPTIONS);

    await this.platformDb.tx(
      { tenantId: tenant.id, actorType: 'platform' },
      async (tx) => {
        await tx.branch.create({
          data: { tenantId: tenant.id, name: dto.branch_name, isMain: true },
        });
        await tx.user.create({
          data: {
            tenantId: tenant.id,
            email: dto.root_email,
            passwordHash,
            fullName: dto.root_full_name,
            role: 'root',
          },
        });
        await tx.botSettings.create({ data: { tenantId: tenant.id } });
      },
    );

    await this.audit(actorId, 'tenant.create', tenant.id, ip, { legal_name: dto.legal_name });
    return { tenant, root_email: dto.root_email, temp_password: tempPassword };
  }

  async patch(id: string, dto: TenantPatch, actorId: string, ip: string) {
    const existing = await this.platformDb.client.tenant.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException();

    let currentPlanId = existing.currentPlanId;
    if (dto.plan_code) {
      const plan = await this.platformDb.client.plan.findUnique({ where: { code: dto.plan_code } });
      if (!plan) throw new UnprocessableEntityException({ title: 'Plan inexistente' });
      currentPlanId = plan.id;
    }

    const tenant = await this.platformDb.client.tenant.update({
      where: { id },
      data: {
        legalName: dto.legal_name,
        tradeName: dto.trade_name,
        ruc: dto.ruc,
        status: dto.status,
        timezone: dto.timezone,
        currentPlanId,
        contactName: dto.contact_name,
        contactEmail: dto.contact_email,
        contactPhone: dto.contact_phone,
        notes: dto.notes,
      },
    });
    this.features.invalidate(id);

    const action = dto.status === 'suspended' ? 'tenant.suspend' : 'tenant.update';
    await this.audit(actorId, action, id, ip, dto as Record<string, unknown>);
    return tenant;
  }

  /**
   * Reinicio de contraseña de un usuario del tenant desde el portal admin
   * (ADR 0005): genera una temporal que se muestra UNA sola vez y revoca
   * todas las sesiones activas del usuario. Queda auditado sin secretos.
   */
  async resetUserPassword(tenantId: string, userId: string, actorId: string, ip: string) {
    const tempPassword = randomBytes(9).toString('base64url');
    const passwordHash = await hash(tempPassword, ARGON2_OPTIONS);

    const email = await this.platformDb.tx(
      { tenantId, actorType: 'platform' },
      async (tx) => {
        // tenantId explicito: platform_ops ve usuarios de todos los tenants,
        // y esta operacion debe quedar clavada al tenant de la URL.
        const user = await tx.user.findFirst({
          where: { id: userId, tenantId, deletedAt: null },
        });
        if (!user) throw new NotFoundException();
        await tx.user.update({ where: { id: userId }, data: { passwordHash } });
        await tx.refreshToken.updateMany({
          where: { userId, tenantId, userScope: 'tenant', revokedAt: null },
          data: { revokedAt: new Date() },
        });
        return user.email;
      },
    );

    await this.audit(actorId, 'tenant.reset_user_password', tenantId, ip, {
      user_id: userId,
      email,
    });
    return { email, temp_password: tempPassword };
  }

  private audit(
    actorId: string,
    action: string,
    entityId: string,
    ip: string,
    detail?: Record<string, unknown>,
  ) {
    return this.platformDb.client.platformAuditLog.create({
      data: { actorId, action, entity: 'tenants', entityId, ip, detail: (detail ?? {}) as Prisma.InputJsonValue },
    });
  }
}
