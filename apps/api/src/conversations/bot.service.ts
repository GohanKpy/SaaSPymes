import { Inject, Injectable, Logger } from '@nestjs/common';
import { runBotTurn, type BotToolHandlers } from '@pymes/botengine';
import type { Env } from '@pymes/shared';

import { AppPrisma } from '../prisma/app-prisma.service';
import { ENV } from '../env.module';
import { BotEngineService } from '../platform/bot-engine.service';
import { AppointmentsService } from '../scheduling/appointments.service';
import { serializeMessage } from './conversations.service';
import { TenantEventsService } from './events.service';
import { WaSenderService } from './wa-sender.service';

/**
 * Bot de agendamiento (doc 01 §3.1): corre tras cada mensaje entrante cuando
 * la conversacion esta en bot_active y el tenant lo habilito. Hoy ejecuta
 * in-process; el pase a cola SQS + worker llega con el hardening de fase 2.
 * Sin llave configurada (panel, ADR 0003; env como fallback) el bot queda
 * apagado y el chat sigue funcionando en modo humano.
 */
/** Aviso unico al agotar el presupuesto mensual de IA (doc 05 §6.4). */
const BUDGET_NOTICE =
  'Gracias por escribirnos. En este momento una persona del negocio va a continuar la conversacion por este mismo chat.';

@Injectable()
export class BotService {
  private readonly logger = new Logger('Bot');

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly appDb: AppPrisma,
    private readonly events: TenantEventsService,
    private readonly appointments: AppointmentsService,
    private readonly engine: BotEngineService,
    private readonly waSender: WaSenderService,
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

      // Presupuesto mensual de tokens (doc 05 §6.4, ADR 0006): al agotarse,
      // el bot responde un aviso generico UNA vez y deja el resto al humano.
      const period = new Date().toLocaleDateString('en-CA', { timeZone: timezone }).slice(0, 7);
      const usage = await this.appDb.tx(ctx, (tx) =>
        tx.botUsageMonthly.findUnique({ where: { tenantId_period: { tenantId, period } } }),
      );
      const spent = Number(usage?.inputTokens ?? 0n) + Number(usage?.outputTokens ?? 0n);
      if (spent >= settings.monthlyTokenBudget) {
        this.logger.warn(
          `presupuesto IA agotado tenant=${tenantId} periodo=${period} gastado=${spent} presupuesto=${settings.monthlyTokenBudget}`,
        );
        const lastBot = [...history].reverse().find((m) => m.senderType === 'bot');
        if (lastBot?.body !== BUDGET_NOTICE) {
          await this.storeBotReply(tenantId, conversationId, BUDGET_NOTICE);
        }
        return;
      }
      const handlers = this.withToolLogging(
        conversation.id,
        this.buildHandlers(tenantId, conversation.id, settings.autoConfirmBookings, timezone),
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

      // El consumo se registra aunque el modelo no haya producido texto:
      // los tokens ya se gastaron (ADR 0006).
      await this.appDb.tx(ctx, (tx) =>
        tx.botUsageMonthly.upsert({
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
        }),
      );

      if (!result.reply) return;
      await this.storeBotReply(tenantId, conversationId, result.reply);
    } catch (error) {
      // El bot jamas tumba el pipeline de chat: se loguea y el panel decide.
      this.logger.error(
        `bot fallo tenant=${tenantId} conv=${conversationId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /** Persiste una respuesta del bot, la empuja por SSE y la despacha a
   *  WhatsApp real si la integracion del tenant esta en modo live. */
  private async storeBotReply(
    tenantId: string,
    conversationId: string,
    body: string,
  ): Promise<void> {
    const ctx = { tenantId, actorType: 'bot' as const };
    const stored = await this.appDb.tx(ctx, async (tx) => {
      const message = await tx.message.create({
        data: { tenantId, conversationId, direction: 'out', senderType: 'bot', body, status: 'sent' },
      });
      await tx.conversation.update({
        where: { id: conversationId },
        data: { lastMessageAt: message.createdAt },
      });
      return message;
    });
    this.events.emit(tenantId, 'message.new', serializeMessage(stored));
    this.waSender.dispatch(tenantId, conversationId, stored.id);
  }

  /**
   * Deja rastro de cada tool call del bot (nombre, argumentos, resultado o
   * error): sin esto, un fallo de reserva es invisible porque el error solo
   * viaja de vuelta al modelo.
   */
  private withToolLogging(conversationId: string, handlers: BotToolHandlers): BotToolHandlers {
    const wrap =
      <A extends unknown[], R>(name: string, fn: (...args: A) => Promise<R>) =>
      async (...args: A): Promise<R> => {
        const rendered = JSON.stringify(args);
        try {
          const result = await fn(...args);
          this.logger.log(`tool=${name} conv=${conversationId} args=${rendered} ok`);
          return result;
        } catch (error) {
          this.logger.warn(
            `tool=${name} conv=${conversationId} args=${rendered} error="${error instanceof Error ? error.message : String(error)}"`,
          );
          throw error;
        }
      };
    return {
      listServices: wrap('list_services', handlers.listServices),
      getAvailableSlots: wrap('get_available_slots', handlers.getAvailableSlots),
      bookAppointment: wrap('book_appointment', handlers.bookAppointment),
      getCustomerHistory: wrap('get_customer_history', handlers.getCustomerHistory),
    };
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
        return slots.map(horaLocal);
      },

      bookAppointment: async ({ serviceId, date, horaLocal: horaPedida }) => {
        // Los modelos a veces fabrican valores desde el texto del chat en vez
        // de re-consultar las herramientas: cada validacion devuelve un error
        // accionable para que el modelo se corrija solo. El contrato es SOLO
        // hora local; el instante UTC lo resuelve el servidor buscando el
        // slot real, asi un modelo confundido no puede reservar fuera de hora.
        const service = await this.appDb.tx(ctx, (tx) =>
          tx.service.findFirst({ where: { id: serviceId, deletedAt: null } }).catch(() => null),
        );
        if (!service) {
          throw new Error(
            `service_id '${serviceId}' inexistente: obtene el id real con list_services en este mismo turno`,
          );
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          throw new Error(`date '${date}' invalida: usa formato YYYY-MM-DD`);
        }
        const horaMatch = /^(\d{1,2})[:.h](\d{2})$/.exec(horaPedida.trim());
        if (!horaMatch?.[1] || !horaMatch[2]) {
          throw new Error(
            `hora_local '${horaPedida}' invalida: usa el formato HH:MM tal como lo devuelve get_available_slots`,
          );
        }
        const hora = `${horaMatch[1].padStart(2, '0')}:${horaMatch[2]}`;
        const branch = await this.mainBranch(tenantId);
        const open = await this.appointments.availability(ctx, {
          branch_id: branch,
          service_id: serviceId,
          date,
        });
        const slot = open.find((iso) => horaLocal(iso) === hora);
        if (!slot) {
          const vigentes = open.map(horaLocal).join(', ') || 'ninguno';
          throw new Error(
            `las ${hora} del ${date} no esta disponible; horarios vigentes: ${vigentes}. Ofrece al cliente estas opciones.`,
          );
        }
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
            { branch_id: branch, customer_id: customerId, service_id: serviceId, starts_at: slot },
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
            date,
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
