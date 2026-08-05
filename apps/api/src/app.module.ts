import { Module } from '@nestjs/common';
import { createInvoicingProvider } from '@pymes/invoicing';
import type { Env } from '@pymes/shared';

import { AuthModule } from './auth/auth.module';
import { BotController } from './bot/bot.controller';
import { CatalogController } from './catalog/catalog.controller';
import { CryptoService } from './common/crypto.service';
import { BotService } from './conversations/bot.service';
import { ConversationsController } from './conversations/conversations.controller';
import { ConversationsService } from './conversations/conversations.service';
import { WaSenderService } from './conversations/wa-sender.service';
import { TenantEventsService } from './conversations/events.service';
import { WebhooksController } from './conversations/webhooks.controller';
import { CustomersController } from './crm/customers.controller';
import { CustomersService } from './crm/customers.service';
import { ENV, EnvModule } from './env.module';
import { HealthController } from './health.controller';
import { IntegrationsController } from './integrations/integrations.controller';
import { InvoicesController } from './invoicing/invoices.controller';
import { INVOICING_PROVIDER, InvoicesService } from './invoicing/invoices.service';
import { KudeService } from './invoicing/kude.service';
import { PlatformModule } from './platform/platform.module';
import { PrismaModule } from './prisma/prisma.module';
import { AppointmentsController } from './scheduling/appointments.controller';
import { AppointmentsService } from './scheduling/appointments.service';
import { BranchesController } from './tenant/branches.controller';
import { TenantController } from './tenant/tenant.controller';
import { UsersController } from './tenant/users.controller';

@Module({
  imports: [EnvModule, PrismaModule, AuthModule, PlatformModule],
  controllers: [
    HealthController,
    TenantController,
    BranchesController,
    UsersController,
    CustomersController,
    CatalogController,
    AppointmentsController,
    BotController,
    ConversationsController,
    WebhooksController,
    IntegrationsController,
    InvoicesController,
  ],
  providers: [
    CryptoService,
    CustomersService,
    AppointmentsService,
    ConversationsService,
    WaSenderService,
    TenantEventsService,
    BotService,
    InvoicesService,
    KudeService,
    {
      provide: INVOICING_PROVIDER,
      useFactory: (env: Env) => createInvoicingProvider(env.INVOICING_PROVIDER),
      inject: [ENV],
    },
  ],
})
export class AppModule {}
