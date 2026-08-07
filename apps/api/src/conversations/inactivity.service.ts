import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { runSummary } from '@pymes/botengine';

import { AppPrisma } from '../prisma/app-prisma.service';
import { BotEngineService } from '../platform/bot-engine.service';
import { TenantEventsService } from './events.service';

const SWEEP_INTERVAL_MS = 10 * 60_000;
const INACTIVITY_MS = 2 * 3600_000;

/**
 * Conversaciones inactivas (pedido 2026-08-07): sin mensajes por 2 horas =>
 * status 'inactive'. Si el tenant activo los resumenes (opt-in, consume
 * tokens del presupuesto), se genera un resumen de seguimiento que queda en
 * la ficha del cliente. Corre in-process cada 10 min; pasa al worker/SQS
 * con el hardening de fase 2 (#19).
 */
@Injectable()
export class InactivityService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Inactivity');
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly appDb: AppPrisma,
    private readonly engine: BotEngineService,
    private readonly events: TenantEventsService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.sweep(), SWEEP_INTERVAL_MS);
    // Primer barrido poco despues de arrancar: lo acumulado durante un
    // deploy/reinicio no espera al proximo intervalo.
    setTimeout(() => void this.sweep(), 30_000);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async sweep(): Promise<void> {
    if (this.running) return; // un barrido a la vez
    this.running = true;
    try {
      // control.tenants no lleva RLS: es la lista para iterar por tenant.
      const tenants = await this.appDb.client.tenant.findMany({
        where: { status: { in: ['trial', 'active'] } },
        select: { id: true, tradeName: true, legalName: true },
      });
      for (const tenant of tenants) {
        await this.sweepTenant(tenant.id, tenant.tradeName ?? tenant.legalName).catch((error) => {
          this.logger.error(
            `barrido fallo tenant=${tenant.id}`,
            error instanceof Error ? error.stack : String(error),
          );
        });
      }
    } finally {
      this.running = false;
    }
  }

  private async sweepTenant(tenantId: string, businessName: string): Promise<void> {
    const ctx = { tenantId, actorType: 'system' as const };
    const cutoff = new Date(Date.now() - INACTIVITY_MS);

    const stale = await this.appDb.tx(ctx, (tx) =>
      tx.conversation.findMany({
        where: {
          status: { in: ['bot_active', 'paused', 'agent'] },
          lastMessageAt: { not: null, lt: cutoff },
        },
        take: 50,
      }),
    );
    if (stale.length === 0) return;

    const settings = await this.appDb.tx(ctx, (tx) =>
      tx.botSettings.findUnique({ where: { tenantId } }),
    );

    for (const conversation of stale) {
      await this.appDb.tx(ctx, (tx) =>
        tx.conversation.update({ where: { id: conversation.id }, data: { status: 'inactive' } }),
      );
      this.events.emit(tenantId, 'conversation.updated', { id: conversation.id, status: 'inactive' });

      if (!settings?.summariesEnabled || !conversation.customerId) continue;
      await this.summarize(tenantId, businessName, conversation.id, conversation.customerId).catch(
        (error) => {
          this.logger.warn(
            `resumen fallo conv=${conversation.id}: ${error instanceof Error ? error.message : error}`,
          );
        },
      );
    }
  }

  private async summarize(
    tenantId: string,
    businessName: string,
    conversationId: string,
    customerId: string,
  ): Promise<void> {
    const config = await this.engine.getConfig();
    if (!config.apiKey) return;
    const ctx = { tenantId, actorType: 'system' as const };

    // Presupuesto del tenant (ADR 0006): el resumen tambien respeta el corte.
    const period = new Date().toLocaleDateString('en-CA').slice(0, 7);
    const settings = await this.appDb.tx(ctx, (tx) =>
      tx.botSettings.findUnique({ where: { tenantId } }),
    );
    const usage = await this.appDb.tx(ctx, (tx) =>
      tx.botUsageMonthly.findUnique({ where: { tenantId_period: { tenantId, period } } }),
    );
    const spent = Number(usage?.inputTokens ?? 0n) + Number(usage?.outputTokens ?? 0n);
    if (settings && spent >= settings.monthlyTokenBudget) return;

    const history = await this.appDb.tx(ctx, (tx) =>
      tx.message.findMany({
        where: { conversationId },
        orderBy: { id: 'desc' },
        take: 30,
      }),
    );
    if (history.length < 2) return;

    const result = await runSummary({
      provider: config.provider,
      apiKey: config.apiKey,
      model: config.model,
      businessName,
      history: history.reverse().map((m) => ({
        direction: m.direction as 'in' | 'out',
        senderType: m.senderType,
        body: m.body,
      })),
    });

    await this.appDb.tx(ctx, async (tx) => {
      await tx.botUsageMonthly.upsert({
        where: { tenantId_period: { tenantId, period } },
        create: {
          tenantId,
          period,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          turns: 1,
        },
        update: {
          inputTokens: { increment: result.inputTokens },
          outputTokens: { increment: result.outputTokens },
          turns: { increment: 1 },
          updatedAt: new Date(),
        },
      });
      if (result.reply) {
        await tx.customer.update({
          where: { id: customerId },
          data: { lastConversationSummary: result.reply, lastSummaryAt: new Date() },
        });
      }
    });
    this.logger.log(`resumen guardado tenant=${tenantId} conv=${conversationId}`);
  }
}
