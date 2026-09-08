import { Module } from '@nestjs/common';

import { CryptoService } from '../common/crypto.service';
import { AssistantService } from './assistant.service';
import { BotEngineService } from './bot-engine.service';
import { PlatformNetworkGuard } from './platform-network.guard';
import { PlatformController } from './platform.controller';
import { PlansService } from './plans.service';
import { AuditController } from './audit.controller';
import { GoogleOauthService } from './google-oauth.service';
import { MailSettingsService } from './mail-settings.service';
import { MailerService } from '../common/mailer.service';
import { PlatformUsersService } from './platform-users.service';
import { RucPadronService } from './ruc-padron.service';
import { SecuritySettingsService } from './security-settings.service';
import { TenantsService } from './tenants.service';

@Module({
  controllers: [PlatformController, AuditController],
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
    RucPadronService,
    CryptoService,
    PlatformNetworkGuard,
  ],
  exports: [BotEngineService, SecuritySettingsService, GoogleOauthService, MailSettingsService, MailerService, RucPadronService],
})
export class PlatformModule {}
