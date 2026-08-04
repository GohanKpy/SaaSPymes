import { Inject, Injectable, Logger } from '@nestjs/common';
import { runBotTurn, type BotToolHandlers } from '@pymes/botengine';
import type { Env } from '@pymes/shared';

import { AppPrisma } from '../prisma/app-prisma.service';
import { ENV } from '../env.module';
import { BotEngineService } from '../platform/bot-engine.service';
import { AppointmentsService } from '../scheduling/appointments.service';
import { serializeMessage } from './conversations.service';
import { TenantEventsService } from './events.service';

/**
 * Bot de agendamiento (doc 01 §3.1): corre tras cada mensaje entrante cuando
 * la conversacion esta en bot_active y el tenant lo habilito. Hoy ejecuta
 * in-process; el pase a cola SQS + worker llega con el hardening de fase 2.
 * Sin ANTHROPIC_API_KEY el bot queda apagado y el chat sigue funcionando
 * en modo humano.
 */
@Injectable()
export class BotService {
  private readonly logger = new Logger('Bot');

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly appDb: AppPrisma,
    private readonly events: TenantEventsService,
    private readonly appointments: AppointmentsService,
    private readonly engine: BotEngineService,
  ) {}

  /** Config viva del motor (ADR 0003): panel manda, env es fallback. */
  async isEnabled(): Promise<boolean> {
    const config = await this.engine.getConfig();
    return Boolean(config.apiKey);
  }

  async respond(tenantId: string, conversationId: string): Promise<void> {
    const engineConfig = await this.engine.getConfig();
    const apiKey = engineConfig.apiKey;
    if (!apiKey) return;
    const ctx = { tenantId, actorType: 'bot' as const };

    try {
      const context = await this.appDb.tx(ctx, async (tx) => {
        const conversation = await tx.conversation.findFirst({ where: { id: conversationId } });
        const settings = await tx.botSettings.findUnique({ where: { tenantId } });
        if (!conversation || conversation.status !== 'bot_active' || !settings?.enabled) {
          return null;
        }
        const tenant = await tx.tenant.findUnique({
          where: { id: tenantId },
          select: { legalName: true, tradeName: true, timezone: true },
        });
        const history = await tx.message.findMany({
          where: { conversationId },
          orderBy: { id: 'desc' },
          take: 20,
        });
        return { conversation, settings, tenant, history: history.reverse() };
      });
      if (!context) return;
      const { conversation, settings, tenant, history } = context;

      const timezone = tenant?.timezone ?? 'America/Asuncion';
      const handlers = this.buildHandlers(
        tenantId,
        conversation.id,
        settings.autoConfirmBookings,
        timezone,
      );
      const result = await runBotTurn({
        provider: engineConfig.provider,
        apiKey,
        model: engineConfig.model,
        businessName: tenant?.tradeName ?? tenant?.legalName ?? 'el negocio',
        timezone,
        instructions: settings.instructionsText,
        permissions: settings,
        handlers,
        history: history.map((m) => ({
          direction: m.direction as 'in' | 'out',
          senderType: m.senderType,
          body: m.body,
        })),
      });

      if (!result.reply) return;
      const stored = await this.appDb.tx(ctx, async (tx) => {
        const message = await tx.message.create({
          data: {
            tenantId,
            conversationId,
            direction: 'out',
            senderType: 'bot',
            body: result.reply as string,
            status: 'sent',
          },
        });
        await tx.conversation.update({
          where: { id: conversationId },
          data: { lastMessageAt: message.createdAt },
        });
        return message;
      });
      this.events.emit(tenantId, 'message.new', serializeMessage(stored));
    } catch (error) {
      // El bot jamas tumba el pipeline de chat: se loguea y el panel decide.
      this.logger.error(
        `bot fallo tenant=${tenantId} conv=${conversationId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /** Herramientas scopeadas server-side (doc 05 §6): tenant + conversacion. */
  private buildHandlers(
    tenantId: string,
    conversationId: string,
    autoConfirm: boolean,
    timezone: string,
  ): BotToolHandlers {
    const ctx = { tenantId, actorType: 'bot' as const };
    const horaLocal = (iso: string) =>
      new Date(iso).toLocaleTimeString('es-PY', {
        timeZone: timezone,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
    return {
      listServices: () =>
        this.appDb.tx(ctx, async (tx) => {
          const services = await tx.service.findMany({
            where: { deletedAt: null, isActive: true, bookableByBot: true },
            select: { id: true, name: true, price: true, currency: true, durationMin: true },
          });
          return services.map((s) => ({ ...s, price: s.price.toString() }));
        }),

      getAvailableSlots: async (serviceId, date) => {
        // Errores accionables: el modelo debe poder corregirse solo
        // (ej. si invento un service_id en lugar de consultar list_services).
        const service = await this.appDb.tx(ctx, (tx) =>
          tx.service.findFirst({ where: { id: serviceId, deletedAt: null } }).catch(() => null),
        );
        if (!service) {
          throw new Error(
            `service_id '${serviceId}' inexistente: obtene el id real con list_services`,
          );
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          throw new Error(`date '${date}' invalida: usa formato YYYY-MM-DD`);
        }
        const branch = await this.mainBranch(tenantId);
        const slots = await this.appointments.availability(ctx, {
          branch_id: branch,
          service_id: serviceId,
          date,
        });
        return slots.map((iso) => ({ iso, hora_local: horaLocal(iso) }));
      },

      bookAppointment: async ({ serviceId, startsAt }) => {
        const branch = await this.mainBranch(tenantId);
        return this.appDb.tx(ctx, async (tx) => {
          const conversation = await tx.conversation.findFirst({ where: { id: conversationId } });
          if (!conversation) throw new Error('conversacion inexistente');
          let customerId = conversation.customerId;
          if (!customerId) {
            const customer = await tx.customer.create({
              data: {
                tenantId,
                firstName: 'Cliente',
                lastName: conversation.phoneE164,
                phoneE164: conversation.phoneE164,
              },
            });
            customerId = customer.id;
            await tx.conversation.update({ where: { id: conversationId }, data: { customerId } });
          }
          const appointment = await this.appointments.createInTx(
            tx,
            ctx,
            { branch_id: branch, customer_id: customerId, service_id: serviceId, starts_at: startsAt },
            'bot',
            autoConfirm,
          );
          this.events.emit(tenantId, 'conversation.updated', {
            id: conversationId,
            appointment_id: appointment.id,
          });
          return {
            id: appointment.id,
            status: appointment.status,
            startsAt: appointment.startsAt.toISOString(),
            horaLocal: horaLocal(appointment.startsAt.toISOString()),
            serviceName: appointment.service?.name ?? '',
          };
        });
      },

      getCustomerHistory: () =>
        this.appDb.tx(ctx, async (tx) => {
          const conversation = await tx.conversation.findFirst({ where: { id: conversationId } });
          if (!conversation?.customerId) return [];
          const rows = await tx.$queryRaw<
            { starts_at: Date; service_name: string | null; visit_status: string }[]
          >`
            SELECT starts_at, service_name, visit_status
            FROM app.customer_history
            WHERE customer_id = ${conversation.customerId}::uuid
            ORDER BY starts_at DESC LIMIT 20`;
          return rows.map((r) => ({
            startsAt: r.starts_at.toISOString(),
            serviceName: r.service_name,
            visitStatus: r.visit_status,
          }));
        }),
    };
  }

  private async mainBranch(tenantId: string): Promise<string> {
    const branch = await this.appDb.tx({ tenantId, actorType: 'bot' }, (tx) =>
      tx.branch.findFirst({ where: { deletedAt: null }, orderBy: { isMain: 'desc' } }),
    );
    if (!branch) throw new Error('el tenant no tiene sucursales');
    return branch.id;
  }
}
