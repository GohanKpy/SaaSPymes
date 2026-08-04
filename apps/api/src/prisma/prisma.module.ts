import { Global, Module } from '@nestjs/common';

import { AppPrisma } from './app-prisma.service';
import { PlatformPrisma } from './platform-prisma.service';

// Dos conexiones, dos roles (doc 03 §1 y §4):
// - AppPrisma (app_rw): requests de tenants, RLS siempre, via tenantTx.
// - PlatformPrisma (platform_ops): login, panel plataforma, webhooks;
//   politicas RLS explicitas, jamas BYPASSRLS.
@Global()
@Module({
  providers: [AppPrisma, PlatformPrisma],
  exports: [AppPrisma, PlatformPrisma],
})
export class PrismaModule {}
