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

  async get(id: string) {
    const tenant = await this.platformDb.client.tenant.findUnique({
      where: { id },
      include: {
        currentPlan: true,
        featureOverrides: { include: { feature: true } },
      },
    });
    if (!tenant) throw new NotFoundException();
    return tenant;
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
      },
    });
    this.features.invalidate(id);

    const action = dto.status === 'suspended' ? 'tenant.suspend' : 'tenant.update';
    await this.audit(actorId, action, id, ip, dto as Record<string, unknown>);
    return tenant;
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
