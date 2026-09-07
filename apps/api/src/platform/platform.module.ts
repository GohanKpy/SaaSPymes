import { Module } from '@nestjs/common';

import { CryptoService } from '../common/crypto.service';
import { AssistantService } from './assistant.service';
import { BotEngineService } from './bot-engine.service';
import { PlatformNetworkGuard } from './platform-network.guard';
import { PlatformController } from './platform.controller';
import { PlansService } from './plans.service';
import { GoogleOauthService } from './google-oauth.service';
import { MailSettingsService } from './mail-settings.service';
import { MailerService } from '../common/mailer.service';
import { PlatformUsersService } from './platform-users.service';
import { SecuritySettingsService } from './security-settings.service';
import { TenantsService } from './tenants.service';

@Module({
  controllers: [PlatformController],
  providers: [
    TenantsService,
    PlatformUsersService,
    GoogleOauthService,
    PlansService,
    BotEngineService,
    AssistantService,
    SecuritySettingsService,
    MailSettingsService,
    MailerService,
    CryptoService,
    PlatformNetworkGuard,
  ],
  exports: [BotEngineService, SecuritySettingsService, GoogleOauthService, MailSettingsService, MailerService],
})
export class PlatformModule {}
