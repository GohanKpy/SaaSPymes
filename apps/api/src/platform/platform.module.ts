import { Module } from '@nestjs/common';

import { PlatformController } from './platform.controller';
import { PlansService } from './plans.service';
import { TenantsService } from './tenants.service';

@Module({
  controllers: [PlatformController],
  providers: [TenantsService, PlansService],
})
export class PlatformModule {}
