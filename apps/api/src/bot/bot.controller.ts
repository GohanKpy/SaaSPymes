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
    const { settings, usage, timezone } = await this.appDb.tx(ctx, async (tx) => {
      const s = await tx.botSettings.upsert({
        where: { tenantId: ctx.tenantId },
        update: {},
        create: { tenantId: ctx.tenantId },
      });
      const tenant = await tx.tenant.findUnique({
        where: { id: ctx.tenantId },
        select: { timezone: true },
      });
      const tz = tenant?.timezone ?? 'America/Asuncion';
      const period = new Date().toLocaleDateString('en-CA', { timeZone: tz }).slice(0, 7);
      const u = await tx.botUsageMonthly.findUnique({
        where: { tenantId_period: { tenantId: ctx.tenantId, period } },
      });
      return { settings: s, usage: { period, row: u }, timezone: tz };
    });
    const spent = Number(usage.row?.inputTokens ?? 0n) + Number(usage.row?.outputTokens ?? 0n);
    // engine_available: el panel avisa si falta configurar el motor (ADR 0003).
    return {
      ...settings,
      engine_available: await this.bot.isEnabled(),
      usage: {
        period: usage.period,
        timezone,
        input_tokens: Number(usage.row?.inputTokens ?? 0n),
        output_tokens: Number(usage.row?.outputTokens ?? 0n),
        turns: usage.row?.turns ?? 0,
        budget: settings.monthlyTokenBudget,
        exhausted: spent >= settings.monthlyTokenBudget,
      },
    };
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
          instructionsOverride: dto.instructions_override,
          accessCatalog: dto.access_catalog,
          accessHistory: dto.access_history,
          accessCustomerData: dto.access_customer_data,
          accessCalendar: dto.access_calendar,
          allowBooking: dto.allow_booking,
          autoConfirmBookings: dto.auto_confirm_bookings,
          // monthly_token_budget se gestiona desde el portal admin (ADR 0006)
          updatedBy: ctx.userId,
        },
        create: { tenantId: ctx.tenantId, updatedBy: ctx.userId },
      }),
    );
  }
}
