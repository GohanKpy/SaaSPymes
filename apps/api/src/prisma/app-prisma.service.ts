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
export class AppPrisma implements OnModuleDestroy {
  readonly client: PrismaClient;

  constructor(@Inject(ENV) env: Env) {
    this.client = createPrismaClient(env.DATABASE_URL);
  }

  /** Toda operacion de datos de tenant corre aca adentro (RLS + auditoria). */
  tx<T>(ctx: TenantContext, fn: (tx: TenantTx) => Promise<T>): Promise<T> {
    return tenantTx(this.client, ctx, fn);
  }

  onModuleDestroy(): Promise<void> {
    return this.client.$disconnect();
  }
}
