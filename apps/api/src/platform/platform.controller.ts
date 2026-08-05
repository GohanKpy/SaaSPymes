import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Req, UseGuards } from '@nestjs/common';
import {
  botBudgetPut,
  botEngineSettingsPut,
  featureCreate,
  overridePut,
  planCreate,
  planUpdate,
  securitySettingsPut,
  tenantCreate,
  tenantPatch,
  uuid,
  type BotBudgetPut,
  type BotEngineSettingsPut,
  type FeatureCreate,
  type OverridePut,
  type PlanCreate,
  type PlanUpdate,
  type SecuritySettingsPut,
  type TenantCreate,
  type TenantPatch,
} from '@pymes/shared';
import type { FastifyRequest } from 'fastify';

import { PlatformRoles, type AuthRequest } from '../auth/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { BotEngineService } from './bot-engine.service';
import { PlatformNetworkGuard } from './platform-network.guard';
import { SecuritySettingsService } from './security-settings.service';
import { PlansService } from './plans.service';
import { TenantsService } from './tenants.service';

function actor(req: FastifyRequest & AuthRequest): string {
  return req.authUser?.sub ?? '';
}

// pagent ('agent') lee y da soporte; padmin ('admin') toca planes, precios,
// overrides y altas (doc 04 §3.11).
@Controller('platform')
@PlatformRoles('admin', 'agent')
@UseGuards(PlatformNetworkGuard)
export class PlatformController {
  constructor(
    private readonly tenants: TenantsService,
    private readonly plans: PlansService,
    private readonly botEngine: BotEngineService,
    private readonly security: SecuritySettingsService,
  ) {}

  /** Motor del bot (ADR 0003): ver estado sin secretos. */
  @Get('settings/bot')
  botSettings() {
    return this.botEngine.view();
  }

  /** Modulo de seguridad: valores del bloqueo de login. */
  @Get('settings/security')
  securitySettings() {
    return this.security.view();
  }

  @Put('settings/security')
  @PlatformRoles('admin')
  putSecuritySettings(
    @Body(new ZodPipe(securitySettingsPut)) dto: SecuritySettingsPut,
    @Req() req: FastifyRequest & AuthRequest,
  ) {
    return this.security.save(dto, actor(req), req.ip);
  }

  /** Rotacion de llaves / cambio de modelo o proveedor: solo padmin. */
  @Put('settings/bot')
  @PlatformRoles('admin')
  putBotSettings(
    @Body(new ZodPipe(botEngineSettingsPut)) dto: BotEngineSettingsPut,
    @Req() req: FastifyRequest & AuthRequest,
  ) {
    return this.botEngine.save(dto, actor(req), req.ip);
  }

  @Get('tenants')
  listTenants() {
    return this.tenants.list();
  }

  @Get('tenants/:id')
  getTenant(@Param('id', new ZodPipe(uuid)) id: string) {
    return this.tenants.get(id);
  }

  @Post('tenants')
  @PlatformRoles('admin')
  createTenant(
    @Body(new ZodPipe(tenantCreate)) dto: TenantCreate,
    @Req() req: FastifyRequest & AuthRequest,
  ) {
    return this.tenants.create(dto, actor(req), req.ip);
  }

  @Patch('tenants/:id')
  @PlatformRoles('admin')
  patchTenant(
    @Param('id', new ZodPipe(uuid)) id: string,
    @Body(new ZodPipe(tenantPatch)) dto: TenantPatch,
    @Req() req: FastifyRequest & AuthRequest,
  ) {
    return this.tenants.patch(id, dto, actor(req), req.ip);
  }

  /** Presupuesto mensual de IA del tenant (ADR 0006): solo padmin. */
  @Put('tenants/:id/bot-budget')
  @PlatformRoles('admin')
  putBotBudget(
    @Param('id', new ZodPipe(uuid)) id: string,
    @Body(new ZodPipe(botBudgetPut)) dto: BotBudgetPut,
    @Req() req: FastifyRequest & AuthRequest,
  ) {
    return this.tenants.setBotBudget(id, dto.monthly_token_budget, actor(req), req.ip);
  }

  /** Reinicio de contraseña de un usuario del tenant (ADR 0005): solo padmin. */
  @Post('tenants/:id/users/:userId/reset-password')
  @PlatformRoles('admin')
  resetUserPassword(
    @Param('id', new ZodPipe(uuid)) id: string,
    @Param('userId', new ZodPipe(uuid)) userId: string,
    @Req() req: FastifyRequest & AuthRequest,
  ) {
    return this.tenants.resetUserPassword(id, userId, actor(req), req.ip);
  }

  @Put('tenants/:id/overrides')
  @PlatformRoles('admin')
  putOverride(
    @Param('id', new ZodPipe(uuid)) id: string,
    @Body(new ZodPipe(overridePut)) dto: OverridePut,
    @Req() req: FastifyRequest & AuthRequest,
  ) {
    return this.plans.putOverride(id, dto, actor(req), req.ip);
  }

  /** Quitar acuerdo a medida: la feature vuelve a heredar del plan. */
  @Delete('tenants/:id/overrides/:featureCode')
  @PlatformRoles('admin')
  removeOverride(
    @Param('id', new ZodPipe(uuid)) id: string,
    @Param('featureCode') featureCode: string,
    @Req() req: FastifyRequest & AuthRequest,
  ) {
    return this.plans.removeOverride(id, featureCode, actor(req), req.ip);
  }

  @Get('plans')
  listPlans() {
    return this.plans.listPlans();
  }

  @Post('plans')
  @PlatformRoles('admin')
  createPlan(
    @Body(new ZodPipe(planCreate)) dto: PlanCreate,
    @Req() req: FastifyRequest & AuthRequest,
  ) {
    return this.plans.createPlan(dto, actor(req), req.ip);
  }

  @Patch('plans/:id')
  @PlatformRoles('admin')
  updatePlan(
    @Param('id', new ZodPipe(uuid)) id: string,
    @Body(new ZodPipe(planUpdate)) dto: PlanUpdate,
    @Req() req: FastifyRequest & AuthRequest,
  ) {
    return this.plans.updatePlan(id, dto, actor(req), req.ip);
  }

  @Get('features')
  listFeatures() {
    return this.plans.listFeatures();
  }

  @Post('features')
  @PlatformRoles('admin')
  createFeature(
    @Body(new ZodPipe(featureCreate)) dto: FeatureCreate,
    @Req() req: FastifyRequest & AuthRequest,
  ) {
    return this.plans.createFeature(dto, actor(req), req.ip);
  }
}
