import { Injectable } from '@nestjs/common';
import type { EffectiveFeature } from '@pymes/shared';

import { PlatformPrisma } from '../prisma/platform-prisma.service';

const CACHE_TTL_MS = 30_000;

/**
 * Resolucion de features efectivas (doc 02): override del tenant si existe,
 * si no lo que diga su plan. Cachea 30 s: cambiar un plan afecta a los
 * tenants "al instante" (doc 08) sin martillar la base en cada request.
 */
@Injectable()
export class FeaturesService {
  private readonly cache = new Map<string, { at: number; features: EffectiveFeature[] }>();

  constructor(private readonly platform: PlatformPrisma) {}

  async effective(tenantId: string): Promise<EffectiveFeature[]> {
    const hit = this.cache.get(tenantId);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.features;

    const [allFeatures, tenant, overrides] = await Promise.all([
      this.platform.client.feature.findMany(),
      this.platform.client.tenant.findUnique({
        where: { id: tenantId },
        include: { currentPlan: { include: { planFeatures: true } } },
      }),
      this.platform.client.tenantFeatureOverride.findMany({ where: { tenantId } }),
    ]);

    const planFeatures = new Map(
      (tenant?.currentPlan?.planFeatures ?? []).map((pf) => [pf.featureId, pf]),
    );
    const overrideByFeature = new Map(overrides.map((o) => [o.featureId, o]));

    const features: EffectiveFeature[] = allFeatures.map((f) => {
      const override = overrideByFeature.get(f.id);
      const plan = planFeatures.get(f.id);
      if (override) {
        return {
          code: f.code,
          name: f.name,
          enabled: override.enabled,
          source: 'override',
          limits: (override.limits ?? plan?.limits ?? {}) as Record<string, unknown>,
        };
      }
      return {
        code: f.code,
        name: f.name,
        enabled: plan !== undefined,
        source: 'plan',
        limits: (plan?.limits ?? {}) as Record<string, unknown>,
      };
    });

    this.cache.set(tenantId, { at: Date.now(), features });
    return features;
  }

  async isEnabled(tenantId: string, code: string): Promise<boolean> {
    const features = await this.effective(tenantId);
    return features.some((f) => f.code === code && f.enabled);
  }

  invalidate(tenantId?: string): void {
    if (tenantId) this.cache.delete(tenantId);
    else this.cache.clear();
  }
}
