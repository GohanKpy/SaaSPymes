import { Inject, Injectable, Logger } from '@nestjs/common';
import { DEFAULT_BASE_PROMPT, runBotTurn, type BotToolHandlers } from '@pymes/botengine';
import type { Env } from '@pymes/shared';

import { AppPrisma } from '../prisma/app-prisma.service';
import { dvRuc } from '../common/ruc';
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
/**
 * Rellena variables {{conocidas}} de las instrucciones con datos reales del
 * negocio y elimina las desconocidas: una plantilla pegada sin rellenar no
 * debe llegar al modelo con llaves crudas.
 */
function renderInstructions(
  text: string | null,
  vars: Record<string, string | null | undefined>,
): string | null {
  if (!text) return null;
  let out = text;
  for (const [key, value] of Object.entries(vars)) {
    out = out.replaceAll(`{{${key}}}`, value ?? '');
  }
  out = out.replace(/\{\{[^{}]{0,60}\}\}/g, '');
  const trimmed = out.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Aviso unico al agotar el presupuesto mensual de IA (doc 05 §6.4). */
const BUDGET_NOTICE =
  'Gracias por escribirnos. En este momento una persona del negocio va a continuar la conversacion por este mismo chat.';

// Debounce humano (pedido 2026-08-07): esperar tras el ULTIMO mensaje del
// cliente antes de responder, para contestar todo junto si escribe en rafaga.
const REPLY_DEBOUNCE_MS = 15_000;

@Injectable()
export class BotService {
  private readonly logger = new Logger('Bot');
  private readonly pending = new Map<string, NodeJS.Timeout>();

  /**
   * Programa la respuesta con debounce: cada mensaje nuevo del cliente
   * reinicia la ventana de 15 s; al dispararse, respond() lee el historial
   * completo y contesta todo lo acumulado en un solo mensaje.
   */
  scheduleRespond(tenantId: string, conversationId: string): void {
    const key = `${tenantId}:${conversationId}`;
    const existing = this.pending.get(key);
    if (existing) clearTimeout(existing);
    this.pending.set(
      key,
      setTimeout(() => {
        this.pending.delete(key);
        void this.respond(tenantId, conversationId);
      }, REPLY_DEBOUNCE_MS),
    );
  }

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
          select: { legalName: true, tradeName: true, timezone: true, branding: true },
        });
        const branch = await tx.branch.findFirst({
          where: { deletedAt: null },
          orderBy: { isMain: 'desc' },
        });
        const history = await tx.message.findMany({
          where: { conversationId },
          orderBy: { id: 'desc' },
          take: 20,
        });
        // Estado del cliente para el prompt (solo con el permiso de datos):
        // sin esto el bot no puede saber si debe pedir nombre o saludar.
        const customer = settings.accessCustomerData
          ? conversation.customerId
            ? await tx.customer.findFirst({ where: { id: conversation.customerId } })
            : await tx.customer.findFirst({
                where: { phoneE164: conversation.phoneE164, deletedAt: null },
              })
          : null;
        return { conversation, settings, tenant, branch, customer, history: history.reverse() };
      });
      if (!context) return;
      const { conversation, settings, tenant, branch, customer, history } = context;

      // Ya respondimos despues del ultimo mensaje del cliente (p. ej. un
      // timer viejo): no hay nada pendiente que contestar.
      const last = history[history.length - 1];
      if (!last || last.direction !== 'in') return;

      let customerContext: string | null = null;
      if (settings.accessCustomerData) {
        if (!customer) {
          customerContext =
            'El cliente AUN NO esta registrado en la agenda. En tu primera respuesta pedile con amabilidad su nombre y apellido (sin dejar de atender su consulta) y, cuando lo confirme, registralo con save_customer_name.';
        } else {
          const faltantes = [
            !customer.email && 'email',
            !customer.birthDate && 'fecha de nacimiento',
            !customer.docNumber && 'documento (CI o RUC)',
            !customer.address && 'direccion',
          ].filter(Boolean);
          const nombre = `${customer.firstName} ${customer.lastName ?? ''}`.trim();
          customerContext =
            customer.firstName === 'Cliente'
              ? 'El cliente esta agendado sin nombre real: pedile su nombre y apellido con naturalidad y registralo con save_customer_name.'
              : `Cliente registrado: ${nombre} (saludalo por su nombre).` +
                (faltantes.length > 0
                  ? ` Datos que FALTAN en su ficha: ${faltantes.join(', ')}. Pedi como maximo UNO por conversacion, en un momento natural, y guardalo con save_customer_data.`
                  : ' Su ficha esta completa: no pidas mas datos.');
        }
      }

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
      // La guia base (del panel admin o el default del sistema, ADR 0008) y
      // las indicaciones del tenant admiten variables {{...}} conocidas;
      // las desconocidas se eliminan para que el modelo no lea llaves crudas
      // (una plantilla pegada tal cual confundia al bot).
      const branding = (tenant?.branding ?? {}) as Record<string, unknown>;
      const vars = {
        nombre_negocio: tenant?.tradeName ?? tenant?.legalName,
        razon_social: tenant?.legalName,
        direccion: branch?.address,
        telefono: branch?.phone,
        actividad: typeof branding.actividad === 'string' ? branding.actividad : undefined,
        rubro: typeof branding.actividad === 'string' ? branding.actividad : undefined,
        email: typeof branding.email_facturacion === 'string' ? branding.email_facturacion : undefined,
      };
      const basePrompt = renderInstructions(engineConfig.basePrompt ?? DEFAULT_BASE_PROMPT, vars);
      const instructions = renderInstructions(settings.instructionsText, vars);

      const result = await runBotTurn({
        provider: engineConfig.provider,
        apiKey,
        model: engineConfig.model,
        businessName: tenant?.tradeName ?? tenant?.legalName ?? 'el negocio',
        timezone,
        basePrompt,
        instructions,
        instructionsPriority: settings.instructionsOverride,
        customerContext,
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
      saveCustomerName: wrap('save_customer_name', handlers.saveCustomerName),
      saveCustomerData: wrap('save_customer_data', handlers.saveCustomerData),
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
      // TODO el catalogo activo, no solo lo agendable: el bot tambien informa
      // precios de servicios que se contratan sin turno (flyer, logo, etc.).
      listServices: () =>
        this.appDb.tx(ctx, async (tx) => {
          const services = await tx.service.findMany({
            where: { deletedAt: null, isActive: true },
            select: {
              id: true,
              name: true,
              description: true,
              price: true,
              currency: true,
              durationMin: true,
              bookableByBot: true,
              category: { select: { name: true, sortOrder: true } },
            },
            orderBy: [{ category: { sortOrder: 'asc' } }, { name: 'asc' }],
          });
          return services.map((s) => ({
            id: s.id,
            name: s.name,
            categoria: s.category?.name ?? null,
            descripcion: s.description,
            price: s.price.toString(),
            currency: s.currency,
            durationMin: s.durationMin,
            agendable: s.bookableByBot,
          }));
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
        if (!service.bookableByBot) {
          throw new Error(
            `'${service.name}' no se agenda por chat (agendable=false): informa precio y detalles, y ofrece agendar una reunion (ej. diagnostico inicial) o derivar a un humano`,
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
        if (slots.length > 0) {
          return { date, horarios_disponibles: slots.map(horaLocal) };
        }
        // Dia sin horarios (ej. consulta de noche): buscar la proxima fecha
        // con disponibilidad para que el bot SIEMPRE tenga algo que ofrecer.
        for (let offset = 1; offset <= 14; offset++) {
          const next = new Date(`${date}T12:00:00Z`);
          next.setUTCDate(next.getUTCDate() + offset);
          const nextDate = next.toISOString().slice(0, 10);
          const nextSlots = await this.appointments.availability(ctx, {
            branch_id: branch,
            service_id: serviceId,
            date: nextDate,
          });
          if (nextSlots.length > 0) {
            return {
              date,
              horarios_disponibles: [],
              proxima_fecha_con_horarios: nextDate,
              horarios_de_proxima_fecha: nextSlots.map(horaLocal),
            };
          }
        }
        return { date, horarios_disponibles: [] };
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
        if (!service.bookableByBot) {
          throw new Error(
            `'${service.name}' no se agenda por chat (agendable=false): ofrece una reunion agendable o deriva a un humano`,
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

      saveCustomerName: async (fullName) => {
        const cleaned = fullName.trim().replace(/\s+/g, ' ');
        if (cleaned.length < 2 || cleaned.length > 200) {
          throw new Error('full_name invalido: envia el nombre tal como lo confirmo el cliente');
        }
        const [firstName, ...rest] = cleaned.split(' ');
        const lastName = rest.length > 0 ? rest.join(' ') : null;
        return this.appDb.tx(ctx, async (tx) => {
          const conversation = await tx.conversation.findFirst({ where: { id: conversationId } });
          if (!conversation) throw new Error('conversacion inexistente');

          // Cliente ya vinculado: solo se completa el placeholder del alta
          // automatica; un nombre cargado por el negocio jamas se pisa.
          if (conversation.customerId) {
            const existing = await tx.customer.findFirst({
              where: { id: conversation.customerId },
            });
            if (existing && existing.firstName !== 'Cliente') {
              return {
                saved: false,
                detail: `el cliente ya esta agendado como ${existing.firstName} ${existing.lastName ?? ''}`.trim(),
              };
            }
            if (existing) {
              await tx.customer.update({
                where: { id: existing.id },
                data: { firstName: firstName ?? cleaned, lastName },
              });
              return { saved: true, detail: `agendado como ${cleaned}` };
            }
          }

          // Sin vinculo: reusar la ficha del mismo telefono o crear una nueva.
          const byPhone = await tx.customer.findFirst({
            where: { phoneE164: conversation.phoneE164, deletedAt: null },
          });
          if (byPhone) {
            await tx.conversation.update({
              where: { id: conversationId },
              data: { customerId: byPhone.id },
            });
            if (byPhone.firstName === 'Cliente') {
              await tx.customer.update({
                where: { id: byPhone.id },
                data: { firstName: firstName ?? cleaned, lastName },
              });
              return { saved: true, detail: `agendado como ${cleaned}` };
            }
            return {
              saved: false,
              detail: `el cliente ya esta agendado como ${byPhone.firstName} ${byPhone.lastName ?? ''}`.trim(),
            };
          }
          const created = await tx.customer.create({
            data: {
              tenantId,
              firstName: firstName ?? cleaned,
              lastName,
              phoneE164: conversation.phoneE164,
            },
          });
          await tx.conversation.update({
            where: { id: conversationId },
            data: { customerId: created.id },
          });
          this.events.emit(tenantId, 'conversation.updated', { id: conversationId });
          return { saved: true, detail: `agendado como ${cleaned}` };
        });
      },

      saveCustomerData: async (args) => {
        return this.appDb.tx(ctx, async (tx) => {
          const conversation = await tx.conversation.findFirst({ where: { id: conversationId } });
          if (!conversation) throw new Error('conversacion inexistente');
          const customer = conversation.customerId
            ? await tx.customer.findFirst({ where: { id: conversation.customerId } })
            : await tx.customer.findFirst({
                where: { phoneE164: conversation.phoneE164, deletedAt: null },
              });
          if (!customer) {
            throw new Error(
              'el cliente aun no esta registrado: registralo primero con save_customer_name',
            );
          }

          const guardados: string[] = [];
          const ignorados: string[] = [];
          const data: Record<string, unknown> = {};

          if (args.email !== undefined && args.email.trim()) {
            const email = args.email.trim().toLowerCase();
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
              throw new Error(`email '${args.email}' invalido: confirmalo con el cliente`);
            }
            if (customer.email) ignorados.push('email (ya cargado)');
            else {
              data['email'] = email;
              guardados.push('email');
            }
          }
          if (args.fechaNacimiento !== undefined && args.fechaNacimiento.trim()) {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(args.fechaNacimiento.trim())) {
              throw new Error('fecha_nacimiento invalida: usa formato YYYY-MM-DD');
            }
            if (customer.birthDate) ignorados.push('fecha de nacimiento (ya cargada)');
            else {
              data['birthDate'] = new Date(`${args.fechaNacimiento.trim()}T00:00:00Z`);
              guardados.push('fecha de nacimiento');
            }
          }
          if (args.direccion !== undefined && args.direccion.trim()) {
            if (customer.address) ignorados.push('direccion (ya cargada)');
            else {
              data['address'] = args.direccion.trim().slice(0, 500);
              guardados.push('direccion');
            }
          }
          if (args.docNumero !== undefined && args.docNumero.trim()) {
            const tipo = (args.docTipo ?? 'ci').trim().toLowerCase();
            if (!['ci', 'ruc', 'pasaporte'].includes(tipo)) {
              throw new Error("doc_tipo invalido: usa 'ci', 'ruc' o 'pasaporte'");
            }
            if (customer.docNumber) ignorados.push('documento (ya cargado)');
            else {
              const numero = args.docNumero.replace(/[.\s-]/g, '');
              data['docType'] = tipo;
              data['docNumber'] = numero;
              if (tipo === 'ruc') data['rucDv'] = dvRuc(numero);
              guardados.push('documento');
            }
          }

          if (Object.keys(data).length > 0) {
            try {
              await tx.customer.update({ where: { id: customer.id }, data });
            } catch {
              throw new Error(
                'no se pudo guardar (posible dato duplicado con otro cliente): verifica con el cliente o deriva a un humano',
              );
            }
          }
          return { guardados, ignorados };
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
