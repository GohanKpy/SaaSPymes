import { Body, Controller, Get, Patch, Req } from '@nestjs/common';
import { botSettingsPatch, type BotSettingsPatch } from '@pymes/shared';
import type { FastifyRequest } from 'fastify';

import { RequireFeature, Roles, type AuthRequest } from '../auth/decorators';
import { tenantCtx } from '../common/tenant-ctx';
import { ZodPipe } from '../common/zod.pipe';
import { BotService } from '../conversations/bot.service';
import { AppPrisma } from '../prisma/app-prisma.service';

@Controller('bot')
@RequireFeature('bot')
export class BotController {
  constructor(
    private readonly appDb: AppPrisma,
    private readonly bot: BotService,
  ) {}

  @Get('settings')
  async get(@Req() req: FastifyRequest & AuthRequest) {
    const ctx = tenantCtx(req);
    const settings = await this.appDb.tx(ctx, (tx) =>
      tx.botSettings.upsert({
        where: { tenantId: ctx.tenantId },
        update: {},
        create: { tenantId: ctx.tenantId },
      }),
    );
    // engine_available: el panel muestra si falta la clave de la API de Claude.
    return { ...settings, engine_available: this.bot.enabled };
  }

  /** Cada cambio queda auditado por el trigger de bot_settings (doc 03 §5). */
  @Patch('settings')
  @Roles('root', 'admin')
  patch(
    @Body(new ZodPipe(botSettingsPatch)) dto: BotSettingsPatch,
    @Req() req: FastifyRequest & AuthRequest,
  ) {
    const ctx = tenantCtx(req);
    return this.appDb.tx(ctx, (tx) =>
      tx.botSettings.upsert({
        where: { tenantId: ctx.tenantId },
        update: {
          enabled: dto.enabled,
          instructionsText: dto.instructions_text,
          accessCatalog: dto.access_catalog,
          accessHistory: dto.access_history,
          accessCustomerData: dto.access_customer_data,
          accessCalendar: dto.access_calendar,
          allowBooking: dto.allow_booking,
          autoConfirmBookings: dto.auto_confirm_bookings,
          monthlyTokenBudget: dto.monthly_token_budget,
          updatedBy: ctx.userId,
        },
        create: { tenantId: ctx.tenantId, updatedBy: ctx.userId },
      }),
    );
  }
}
