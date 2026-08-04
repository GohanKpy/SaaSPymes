import { Module } from '@nestjs/common';

import { CryptoService } from '../common/crypto.service';
import { BotEngineService } from './bot-engine.service';
import { PlatformNetworkGuard } from './platform-network.guard';
import { PlatformController } from './platform.controller';
import { PlansService } from './plans.service';
import { TenantsService } from './tenants.service';

@Module({
  controllers: [PlatformController],
  providers: [TenantsService, PlansService, BotEngineService, CryptoService, PlatformNetworkGuard],
  exports: [BotEngineService],
})
export class PlatformModule {}
