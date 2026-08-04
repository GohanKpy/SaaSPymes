import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import {
  createPrismaClient,
  tenantTx,
  type PrismaClient,
  type TenantContext,
  type TenantTx,
} from '@pymes/db';
import type { Env } from '@pymes/shared';

import { ENV } from '../env.module';

@Injectable()
export class PlatformPrisma implements OnModuleDestroy {
  readonly client: PrismaClient;

  constructor(@Inject(ENV) env: Env) {
    this.client = createPrismaClient(env.PLATFORM_DATABASE_URL);
  }

  /**
   * Aprovisionamiento de tenants: platform_ops escribiendo en `app` CON el
   * contexto del tenant nuevo fijado, para que RLS y auditoria apliquen igual.
   */
  tx<T>(ctx: TenantContext, fn: (tx: TenantTx) => Promise<T>): Promise<T> {
    return tenantTx(this.client, ctx, fn);
  }

  onModuleDestroy(): Promise<void> {
    return this.client.$disconnect();
  }
}
