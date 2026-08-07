import { Module } from '@nestjs/common';

import { CryptoService } from '../common/crypto.service';
import { BotEngineService } from './bot-engine.service';
import { PlatformNetworkGuard } from './platform-network.guard';
import { PlatformController } from './platform.controller';
import { PlansService } from './plans.service';
import { PlatformUsersService } from './platform-users.service';
import { SecuritySettingsService } from './security-settings.service';
import { TenantsService } from './tenants.service';

@Module({
  controllers: [PlatformController],
  providers: [
    TenantsService,
    PlatformUsersService,
    PlansService,
    BotEngineService,
    SecuritySettingsService,
    CryptoService,
    PlatformNetworkGuard,
  ],
  exports: [BotEngineService, SecuritySettingsService],
})
export class PlatformModule {}
