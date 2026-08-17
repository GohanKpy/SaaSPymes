import { Inject, Injectable, Logger } from '@nestjs/common';
import { DEFAULT_BASE_PROMPT, runBotTurn, type BotToolHandlers } from '@pymes/botengine';
import type { Env } from '@pymes/shared';

import { AppPrisma } from '../prisma/app-prisma.service';
import { dvRuc } from '../common/ruc';
import { ENV } from '../env.module';
import { GoogleCalendarService } from '../integrations/google-calendar.service';
import { BotEngineService } from '../platform/bot-engine.service';
import {
  AppointmentsService,
  DEFAULT_DURATION_MIN,
  type BranchSchedule,
} from '../scheduling/appointments.service';
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

// Los avisos al cliente (presupuesto agotado, fallo del proveedor), el
// debounce y el tope horario se configuran desde el panel admin (regla: nada
// funcional hardcodeado); los defaults viven en bot-engine.service.

/** Para matchear slugs/nombres que el modelo manda en vez del UUID. */
const normalizar = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

@Injectable()
export class BotService {
  private readonly logger = new Logger('Bot');
  private readonly pending = new Map<string, NodeJS.Timeout>();
  // Tope HORARIO de IA por tenant (auditoria 2026-08-07): freno a bucles o
  // abuso que quemarian el presupuesto mensual en minutos. En memoria, igual
  // que el bloqueo de login: suficiente para la instancia unica de fase 1.
  private readonly hourly = new Map<string, { hourStart: number; tokens: number }>();

  /**
   * Programa la respuesta con debounce (configurable en el panel admin):
   * cada mensaje nuevo del cliente reinicia la ventana; al dispararse,
   * respond() lee el historial completo y contesta todo junto.
   */
  scheduleRespond(tenantId: string, conversationId: string): void {
    void this.engine.getConfig().then((config) => {
      const key = `${tenantId}:${conversationId}`;
      const existing = this.pending.get(key);
      if (existing) clearTimeout(existing);
      this.pending.set(
        key,
        setTimeout(() => {
          this.pending.delete(key);
          void this.respond(tenantId, conversationId);
        }, config.replyDebounceMs),
      );
    });
  }

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly appDb: AppPrisma,
    private readonly events: TenantEventsService,
    private readonly appointments: AppointmentsService,
    private readonly engine: BotEngineService,
    private readonly waSender: WaSenderService,
    private readonly google: GoogleCalendarService,
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
        if (lastBot?.body !== engineConfig.budgetNotice) {
          await this.storeBotReply(tenantId, conversationId, engineConfig.budgetNotice);
        }
        return;
      }
      // Tope horario: un dia entero de presupuesto proporcional gastado en una
      // hora es un bucle o un abuso, no trafico real. Mismo tratamiento que un
      // fallo del proveedor: aviso unico + marca para la bandeja.
      if (
        this.hourlyCapReached(tenantId, settings.monthlyTokenBudget, engineConfig.hourlyBudgetDivisor)
      ) {
        this.logger.warn(`tope horario de IA alcanzado tenant=${tenantId}`);
        const lastBot = [...history].reverse().find((m) => m.senderType === 'bot');
        if (lastBot?.body !== engineConfig.fallbackNotice) {
          await this.storeBotReply(tenantId, conversationId, engineConfig.fallbackNotice);
        }
        await this.setNeedsHuman(tenantId, conversationId, true);
        return;
      }
      const handlers = this.withToolLogging(
        tenantId,
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

      let result;
      try {
        result = await runBotTurn({
          provider: engineConfig.provider,
          apiKey,
          model: engineConfig.model,
          businessName: tenant?.tradeName ?? tenant?.legalName ?? 'el negocio',
          timezone,
          businessHours: this.describeSchedule(branch?.schedule, timezone),
          // Equipo agendable (fase 3): unicos nombres validos para que el
          // cliente elija con quien atenderse.
          team: (await this.teamNames(tenantId)).join(', ') || null,
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
      } catch (error) {
        // Fallback seguro (auditoria 2026-08-07): timeout, 5xx o falta de
        // credito del proveedor ya agotaron el reintento del runner. Antes el
        // bot callaba y el cliente quedaba hablando solo.
        this.logger.error(
          `proveedor IA fallo tenant=${tenantId} conv=${conversationId}`,
          error instanceof Error ? error.stack : String(error),
        );
        const lastBot = [...history].reverse().find((m) => m.senderType === 'bot');
        if (lastBot?.body !== engineConfig.fallbackNotice) {
          await this.storeBotReply(tenantId, conversationId, engineConfig.fallbackNotice);
        }
        await this.setNeedsHuman(tenantId, conversationId, true);
        return;
      }

      this.addHourlyUsage(tenantId, result.inputTokens + result.outputTokens);

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
      // La marca "necesita humano" NO se limpia porque el bot siga
      // respondiendo: al cliente se le prometio una persona (por fallo del
      // proveedor o por request_human) y esa promesa se cumple recien cuando
      // un agente contesta (sendAsAgent la limpia).
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
   * Resumen legible del horario de atencion + proximos dias cerrados: ancla
   * al bot para no ofrecer dias cerrados ni inventar franjas (bateria de
   * testeo 2026-08-07, bugs 2 y 6). Los turnos reales siguen saliendo SOLO
   * de get_available_slots.
   */
  private describeSchedule(raw: unknown, timezone: string): string {
    const schedule = (raw ?? {}) as BranchSchedule;
    const DIAS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
    const lines: string[] = [];
    if (!schedule.week) {
      lines.push('- todos los dias de 08:00 a 18:00');
    } else {
      for (const dow of [1, 2, 3, 4, 5, 6, 0]) {
        const franjas = schedule.week[String(dow)] ?? [];
        lines.push(
          franjas.length === 0
            ? `- ${DIAS[dow]}: cerrado`
            : `- ${DIAS[dow]}: ${franjas.map((f) => `${f.from} a ${f.to}`).join(' y ')}`,
        );
      }
    }
    const hoy = new Date().toLocaleDateString('en-CA', { timeZone: timezone });
    const limite = new Date(Date.now() + 14 * 86_400_000).toLocaleDateString('en-CA', {
      timeZone: timezone,
    });
    const cerrados = (schedule.closed_dates ?? []).filter((d) => d >= hoy && d <= limite).sort();
    if (cerrados.length > 0) {
      const largo: Intl.DateTimeFormatOptions = {
        timeZone: timezone,
        weekday: 'long',
        day: 'numeric',
        month: 'long',
      };
      lines.push(
        `Fechas puntuales SIN atencion (no ofrecer turnos ni consultar esos dias): ${cerrados
          .map((d) => `${new Date(`${d}T12:00:00Z`).toLocaleDateString('es-PY', largo)} (${d})`)
          .join(', ')}.`,
      );
    }
    return lines.join('\n');
  }

  /**
   * Busca el servicio por UUID o, si el modelo mando un slug/nombre
   * ("mantenimiento-pc"), por nombre normalizado con match UNICO: evita
   * llamadas quemadas por IDs alucinados (bateria 2026-08-07, bug 4) sin
   * darle al modelo ninguna ambiguedad nueva.
   */
  private async resolveService(tenantId: string, rawId: string) {
    const ctx = { tenantId, actorType: 'bot' as const };
    const byId = await this.appDb
      .tx(ctx, (tx) => tx.service.findFirst({ where: { id: rawId, deletedAt: null } }))
      .catch(() => null);
    if (byId) return byId;
    const wanted = normalizar(rawId);
    if (!wanted) return null;
    const all = await this.appDb.tx(ctx, (tx) =>
      tx.service.findMany({ where: { deletedAt: null, isActive: true } }),
    );
    const matches = all.filter((s) => normalizar(s.name) === wanted);
    if (matches.length === 1 && matches[0]) {
      this.logger.log(`service_id '${rawId}' resuelto por nombre a ${matches[0].id}`);
      return matches[0];
    }
    return null;
  }

  /**
   * Busca un empleado agendable por nombre ("Maria", "Maria Gonzalez"):
   * match UNICO normalizado por nombre completo o solo nombre de pila.
   * Mismo criterio que resolveService: nada de ambiguedad para el modelo.
   */
  private async resolveEmployee(tenantId: string, raw: string) {
    const wanted = normalizar(raw);
    if (!wanted) return null;
    const all = await this.appDb.tx({ tenantId, actorType: 'bot' as const }, (tx) =>
      tx.employee.findMany({
        where: { deletedAt: null, isActive: true, bookable: true },
        select: { id: true, firstName: true, lastName: true },
      }),
    );
    const matches = all.filter(
      (e) =>
        normalizar(`${e.firstName} ${e.lastName}`) === wanted || normalizar(e.firstName) === wanted,
    );
    return matches.length === 1 ? (matches[0] ?? null) : null;
  }

  /** Nombres del equipo agendable, para el contexto del bot y sus errores. */
  private async teamNames(tenantId: string): Promise<string[]> {
    const rows = await this.appDb.tx({ tenantId, actorType: 'bot' as const }, (tx) =>
      tx.employee.findMany({
        where: { deletedAt: null, isActive: true, bookable: true },
        select: { firstName: true, lastName: true },
        orderBy: { firstName: 'asc' },
      }),
    );
    return rows.map((e) => `${e.firstName} ${e.lastName}`);
  }

  /** Tope por hora = presupuesto mensual / divisor del panel admin. Piso
   *  tecnico 30k tokens (~6 respuestas): una conversacion normal jamas debe
   *  chocar con este freno — es para bucles y abuso, no para clientes. */
  private hourlyCapReached(tenantId: string, monthlyBudget: number, divisor: number): boolean {
    const cap = Math.max(30_000, Math.floor(monthlyBudget / divisor));
    const entry = this.hourly.get(tenantId);
    if (!entry || Date.now() - entry.hourStart >= 3_600_000) return false;
    return entry.tokens >= cap;
  }

  private addHourlyUsage(tenantId: string, tokens: number): void {
    const now = Date.now();
    let entry = this.hourly.get(tenantId);
    if (!entry || now - entry.hourStart >= 3_600_000) entry = { hourStart: now, tokens: 0 };
    entry.tokens += tokens;
    this.hourly.set(tenantId, entry);
  }

  /** Marca/desmarca la conversacion como "necesita humano" y avisa a la
   *  bandeja por SSE. */
  private async setNeedsHuman(
    tenantId: string,
    conversationId: string,
    needsHuman: boolean,
  ): Promise<void> {
    await this.appDb.tx({ tenantId, actorType: 'bot' }, (tx) =>
      tx.conversation.update({ where: { id: conversationId }, data: { needsHuman } }),
    );
    this.events.emit(tenantId, 'conversation.updated', {
      id: conversationId,
      needs_human: needsHuman,
    });
  }

  /**
   * Deja rastro de cada tool call del bot (nombre, argumentos, resultado o
   * error): sin esto, un fallo de reserva es invisible porque el error solo
   * viaja de vuelta al modelo. Ademas del log del contenedor queda una fila
   * en app.bot_tool_calls (auditoria 2026-08-07): sobrevive al redeploy y es
   * consultable por tenant. El registro es best-effort: un fallo al auditar
   * jamas rompe la herramienta.
   */
  private withToolLogging(
    tenantId: string,
    conversationId: string,
    handlers: BotToolHandlers,
  ): BotToolHandlers {
    const persist = (tool: string, rendered: string, ok: boolean, detail: string, ms: number) =>
      this.appDb
        .tx({ tenantId, actorType: 'bot' }, (tx) =>
          tx.botToolCall.create({
            data: {
              tenantId,
              conversationId,
              tool,
              args: JSON.parse(rendered) as object,
              ok,
              detail: detail.slice(0, 2000),
              durationMs: ms,
            },
          }),
        )
        .catch((error: unknown) =>
          this.logger.warn(
            `no se pudo auditar tool=${tool} conv=${conversationId}: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
    const wrap =
      <A extends unknown[], R>(name: string, fn: (...args: A) => Promise<R>) =>
      async (...args: A): Promise<R> => {
        const rendered = JSON.stringify(args);
        const startedAt = Date.now();
        try {
          const result = await fn(...args);
          this.logger.log(`tool=${name} conv=${conversationId} args=${rendered} ok`);
          void persist(name, rendered, true, JSON.stringify(result), Date.now() - startedAt);
          return result;
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          this.logger.warn(
            `tool=${name} conv=${conversationId} args=${rendered} error="${detail}"`,
          );
          void persist(name, rendered, false, detail, Date.now() - startedAt);
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
      requestHuman: wrap('request_human', handlers.requestHuman),
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
      // TODO el catalogo activo: el bot tambien informa precios de items que
      // se venden sin turno (flyer, logo, etc.) y coordina su reunion inicial.
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
              kind: true,
              durationMin: true,
              requiresMeeting: true,
              meetingMin: true,
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
            tipo: s.kind as 'servicio' | 'item',
            durationMin: s.kind === 'servicio' ? s.durationMin : null,
            requiereReunion: s.kind === 'item' ? s.requiresMeeting : false,
            reunionInicialMin: s.kind === 'item' ? (s.meetingMin ?? DEFAULT_DURATION_MIN) : null,
          }));
        }),

      getAvailableSlots: async (serviceId, date, empleado) => {
        // Errores accionables: el modelo debe poder corregirse solo
        // (ej. si invento un service_id en lugar de consultar list_services).
        const service = await this.resolveService(tenantId, serviceId);
        if (!service) {
          throw new Error(
            `service_id '${serviceId}' inexistente: obtene el id real con list_services`,
          );
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          throw new Error(`date '${date}' invalida: usa formato YYYY-MM-DD`);
        }
        // Eleccion de profesional (fase 3): filtra a los horarios de ESE
        // empleado. Nombre no reconocido → error con el equipo real.
        let employeeId: string | undefined;
        if (empleado?.trim()) {
          const match = await this.resolveEmployee(tenantId, empleado);
          if (!match) {
            const equipo = (await this.teamNames(tenantId)).join(', ') || 'sin empleados cargados';
            throw new Error(`empleado '${empleado}' no reconocido; el equipo es: ${equipo}`);
          }
          employeeId = match.id;
        }
        const branch = await this.mainBranch(tenantId);
        const slots = await this.appointments.availability(ctx, {
          branch_id: branch,
          service_id: service.id,
          date,
          employee_id: employeeId,
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
            service_id: service.id,
            date: nextDate,
            employee_id: employeeId,
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

      bookAppointment: async ({ serviceId, date, horaLocal: horaPedida, nota, empleado }) => {
        // Los modelos a veces fabrican valores desde el texto del chat en vez
        // de re-consultar las herramientas: cada validacion devuelve un error
        // accionable para que el modelo se corrija solo. El contrato es SOLO
        // hora local; el instante UTC lo resuelve el servidor buscando el
        // slot real, asi un modelo confundido no puede reservar fuera de hora.
        const service = await this.resolveService(tenantId, serviceId);
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
        // Profesional pedido por el cliente (fase 3): la disponibilidad y la
        // reserva quedan atadas a ESE empleado.
        let employeeId: string | undefined;
        if (empleado?.trim()) {
          const match = await this.resolveEmployee(tenantId, empleado);
          if (!match) {
            const equipo = (await this.teamNames(tenantId)).join(', ') || 'sin empleados cargados';
            throw new Error(`empleado '${empleado}' no reconocido; el equipo es: ${equipo}`);
          }
          employeeId = match.id;
        }
        const hora = `${horaMatch[1].padStart(2, '0')}:${horaMatch[2]}`;
        const branch = await this.mainBranch(tenantId);
        const open = await this.appointments.availability(ctx, {
          branch_id: branch,
          service_id: service.id,
          date,
          employee_id: employeeId,
        });
        const slot = open.find((iso) => horaLocal(iso) === hora);
        if (!slot) {
          const vigentes = open.map(horaLocal).join(', ') || 'ninguno';
          throw new Error(
            `las ${hora} del ${date} no esta disponible; horarios vigentes: ${vigentes}. Ofrece al cliente estas opciones.`,
          );
        }
        const reserva = await this.appDb.tx(ctx, async (tx) => {
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
            {
              branch_id: branch,
              customer_id: customerId,
              service_id: service.id,
              employee_id: employeeId,
              starts_at: slot,
              // Modalidad o pedido especial del cliente, y si el producto es
              // un item (ADR 0009 fase 2), la marca de que esto es una
              // REUNION INICIAL para tratarlo (regla 2026-08-12): visible en
              // la Agenda para el equipo.
              notes:
                [
                  service.kind === 'item' ? `Reunion inicial por: ${service.name}` : null,
                  nota?.trim() || null,
                ]
                  .filter(Boolean)
                  .join(' — ')
                  .slice(0, 1000) || undefined,
            },
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
            tipo: service.kind === 'item' ? ('reunion_inicial' as const) : ('servicio' as const),
            atendidoPor: appointment.employee
              ? `${appointment.employee.firstName} ${appointment.employee.lastName}`
              : null,
          };
        });
        // Espejo a Google en segundo plano (ADR 0007): jamas frena la reserva.
        void this.google.pushAppointment(tenantId, reserva.id);
        return reserva;
      },

      saveCustomerName: async (fullName) => {
        const cleaned = fullName.trim().replace(/\s+/g, ' ');
        if (cleaned.length < 2 || cleaned.length > 200) {
          throw new Error('full_name invalido: envia el nombre tal como lo confirmo el cliente');
        }
        // El modelo a veces registra un relleno en vez de un nombre real
        // (visto 2026-08-17: "cliente no especificado"): se rechaza.
        if (/no especificado|sin nombre|desconocido|no dio|anonimo|^cliente\b/i.test(cleaned)) {
          throw new Error(
            'full_name invalido: registra SOLO el nombre real que el cliente dio; si no lo dio, no llames esta herramienta',
          );
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

      // La derivacion prometida se vuelve accion real: badge en bandeja +
      // aviso SSE (bateria 2026-08-07, bug 1). El motivo queda auditado en
      // bot_tool_calls via withToolLogging.
      requestHuman: async () => {
        await this.setNeedsHuman(tenantId, conversationId, true);
        return {
          marcada: true,
          detalle:
            'la conversacion ya figura como "necesita humano" en la bandeja; una persona del equipo la va a ver',
        };
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
