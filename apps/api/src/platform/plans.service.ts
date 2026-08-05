import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@pymes/db';
import type { FeatureCreate, OverridePut, PlanCreate, PlanUpdate } from '@pymes/shared';

import { FeaturesService } from '../auth/features.service';
import { PlatformPrisma } from '../prisma/platform-prisma.service';

@Injectable()
export class PlansService {
  constructor(
    private readonly platformDb: PlatformPrisma,
    private readonly features: FeaturesService,
  ) {}

  listPlans() {
    return this.platformDb.client.plan.findMany({
      include: { planFeatures: { include: { feature: true } } },
      orderBy: { sortOrder: 'asc' },
    });
  }

  listFeatures() {
    return this.platformDb.client.feature.findMany({ orderBy: { code: 'asc' } });
  }

  async createFeature(dto: FeatureCreate, actorId: string, ip: string) {
    const feature = await this.platformDb.client.feature.create({
      data: { code: dto.code, name: dto.name },
    });
    await this.audit(actorId, 'feature.create', 'features', feature.id, ip);
    return feature;
  }

  async createPlan(dto: PlanCreate, actorId: string, ip: string) {
    const plan = await this.platformDb.client.plan.create({
      data: {
        code: dto.code,
        name: dto.name,
        monthlyPrice: dto.monthly_price,
        currency: dto.currency,
        maxUsers: dto.max_users,
        maxBranches: dto.max_branches,
        isActive: dto.is_active,
        sortOrder: dto.sort_order,
      },
    });
    await this.setPlanFeatures(plan.id, dto.feature_codes);
    await this.audit(actorId, 'plan.create', 'plans', plan.id, ip);
    this.features.invalidate();
    return this.getPlan(plan.id);
  }

  async updatePlan(id: string, dto: PlanUpdate, actorId: string, ip: string) {
    const existing = await this.platformDb.client.plan.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException();
    await this.platformDb.client.plan.update({
      where: { id },
      data: {
        code: dto.code,
        name: dto.name,
        monthlyPrice: dto.monthly_price,
        currency: dto.currency,
        maxUsers: dto.max_users,
        maxBranches: dto.max_branches,
        isActive: dto.is_active,
        sortOrder: dto.sort_order,
      },
    });
    if (dto.feature_codes) await this.setPlanFeatures(id, dto.feature_codes);
    await this.audit(actorId, 'plan.update', 'plans', id, ip);
    // Cambiar un plan afecta a los tenants al instante (doc 08 §5).
    this.features.invalidate();
    return this.getPlan(id);
  }

  private async getPlan(id: string) {
    return this.platformDb.client.plan.findUnique({
      where: { id },
      include: { planFeatures: { include: { feature: true } } },
    });
  }

  private async setPlanFeatures(planId: string, codes: string[]): Promise<void> {
    const features = await this.platformDb.client.feature.findMany({
      where: { code: { in: codes } },
    });
    if (features.length !== codes.length) {
      throw new UnprocessableEntityException({ title: 'Alguna feature no existe' });
    }
    await this.platformDb.client.planFeature.deleteMany({ where: { planId } });
    await this.platformDb.client.planFeature.createMany({
      data: features.map((f) => ({ planId, featureId: f.id })),
    });
  }

  /** Acuerdos a medida con nota obligatoria (doc 04 §3.11). */
  async putOverride(tenantId: string, dto: OverridePut, actorId: string, ip: string) {
    const feature = await this.platformDb.client.feature.findUnique({
      where: { code: dto.feature_code },
    });
    if (!feature) throw new UnprocessableEntityException({ title: 'Feature inexistente' });
    const tenant = await this.platformDb.client.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException();

    const override = await this.platformDb.client.tenantFeatureOverride.upsert({
      where: { tenantId_featureId: { tenantId, featureId: feature.id } },
      update: {
        enabled: dto.enabled,
        extraFee: dto.extra_fee,
        limits: (dto.limits ?? undefined) as Prisma.InputJsonValue | undefined,
        note: dto.note,
        createdBy: actorId,
      },
      create: {
        tenantId,
        featureId: feature.id,
        enabled: dto.enabled,
        extraFee: dto.extra_fee,
        limits: (dto.limits ?? undefined) as Prisma.InputJsonValue | undefined,
        note: dto.note,
        createdBy: actorId,
      },
    });
    await this.audit(actorId, 'override.put', 'tenant_feature_overrides', override.id, ip);
    this.features.invalidate(tenantId);
    return override;
  }

  /** Quitar un acuerdo a medida: la feature vuelve a heredarse del plan. */
  async removeOverride(tenantId: string, featureCode: string, actorId: string, ip: string) {
    const feature = await this.platformDb.client.feature.findUnique({
      where: { code: featureCode },
    });
    if (!feature) throw new UnprocessableEntityException({ title: 'Feature inexistente' });
    await this.platformDb.client.tenantFeatureOverride.deleteMany({
      where: { tenantId, featureId: feature.id },
    });
    await this.audit(actorId, 'override.delete', 'tenant_feature_overrides', tenantId, ip);
    this.features.invalidate(tenantId);
    return { removed: true };
  }

  private audit(actorId: string, action: string, entity: string, entityId: string, ip: string) {
    return this.platformDb.client.platformAuditLog.create({
      data: { actorId, action, entity, entityId, ip },
    });
  }
}
