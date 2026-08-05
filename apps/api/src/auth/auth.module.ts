import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { PlatformModule } from '../platform/platform.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { FeaturesService } from './features.service';
import { FeatureGuard } from './guards/feature.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { JwtSigner } from './jwt.service';

// Guards globales en orden: JWT (capa 1) → rol (capa 2) → feature (capa 3).
@Global()
@Module({
  // PlatformModule provee la config viva del modulo de seguridad (lockout).
  imports: [PlatformModule],
  controllers: [AuthController],
  providers: [
    JwtSigner,
    AuthService,
    FeaturesService,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: FeatureGuard },
  ],
  exports: [JwtSigner, FeaturesService],
})
export class AuthModule {}
