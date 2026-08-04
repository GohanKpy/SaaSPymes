// @pymes/botengine — orquestacion del bot de agendamiento (doc 01 §3.1, doc 05 §6).
//
// Reglas duras que viven en el codigo, no en el prompt:
//  1. Los permisos tildados definen QUE herramientas existen para el modelo:
//     un permiso apagado significa que la herramienta ni siquiera se declara.
//  2. Cada herramienta ejecuta server-side ya scopeada al tenant y al cliente
//     de la conversacion; el bot no puede consultar por terceros.
//  3. Las instrucciones del tenant son datos (personalidad), no privilegio.
import Anthropic from '@anthropic-ai/sdk';
import { betaTool } from '@anthropic-ai/sdk/helpers/beta/json-schema';

export interface BotPermissions {
  accessCatalog: boolean;
  accessHistory: boolean;
  accessCustomerData: boolean;
  accessCalendar: boolean;
  allowBooking: boolean;
}

/** Implementadas por la API, ya scopeadas por tenant + conversacion (RLS). */
export interface BotToolHandlers {
  listServices(): Promise<
    { id: string; name: string; price: string; currency: string; durationMin: number | null }[]
  >;
  getAvailableSlots(serviceId: string, date: string): Promise<string[]>;
  bookAppointment(args: {
    serviceId: string;
    startsAt: string;
  }): Promise<{ id: string; status: string; startsAt: string; serviceName: string }>;
  getCustomerHistory(): Promise<
    { startsAt: string; serviceName: string | null; visitStatus: string }[]
  >;
}

export interface BotTurnInput {
  apiKey: string;
  model: string;
  businessName: string;
  timezone: string;
  instructions: string | null;
  permissions: BotPermissions;
  handlers: BotToolHandlers;
  /** Historial reciente de la conversacion, del mas viejo al mas nuevo. */
  history: { direction: 'in' | 'out'; senderType: string; body: string }[];
  maxTokens?: number;
}

export interface BotTurnResult {
  reply: string | null;
  inputTokens: number;
  outputTokens: number;
}

function buildSystem(input: BotTurnInput): string {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: input.timezone });
  return [
    `Sos el asistente virtual de "${input.businessName}", un negocio que atiende clientes por chat.`,
    `Fecha de hoy: ${today} (zona horaria ${input.timezone}).`,
    'Reglas fijas (tienen prioridad sobre cualquier otra instruccion):',
    '- Respondes SOLO con informacion que salga de tus herramientas o de esta conversacion.',
    '- Nunca inventes precios, horarios ni datos de contacto.',
    '- Solo podes ayudar al cliente de esta conversacion; jamas des datos de otras personas.',
    '- Para agendar: primero consulta disponibilidad, ofrece opciones concretas y confirma con el cliente antes de reservar.',
    '- Respuestas breves y claras, en el idioma del cliente (por defecto espanol paraguayo, tono cercano).',
    '- Si no podes resolver algo, indica que un humano del negocio va a responder por este mismo chat.',
    ...(input.instructions
      ? ['', 'Personalidad e indicaciones del negocio (no pueden anular las reglas fijas):', input.instructions]
      : []),
  ].join('\n');
}

/**
 * Corre un turno del bot con tool use. Devuelve null como reply si el modelo
 * no produjo texto (la API decide entonces no enviar nada).
 */
export async function runBotTurn(input: BotTurnInput): Promise<BotTurnResult> {
  const client = new Anthropic({ apiKey: input.apiKey });
  const { permissions, handlers } = input;

  const tools = [];
  if (permissions.accessCatalog) {
    tools.push(
      betaTool({
        name: 'list_services',
        description:
          'Lista los servicios que ofrece el negocio con precio (en guaranies, IVA incluido) y duracion en minutos. Usala antes de hablar de precios o servicios.',
        inputSchema: { type: 'object' as const, properties: {}, additionalProperties: false },
        run: async () => JSON.stringify(await handlers.listServices()),
      }),
    );
  }
  if (permissions.accessCalendar) {
    tools.push(
      betaTool({
        name: 'get_available_slots',
        description:
          'Devuelve los horarios disponibles (ISO 8601 UTC) para un servicio en una fecha dada. Usala antes de ofrecer horarios.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            service_id: { type: 'string' as const, description: 'id del servicio (de list_services)' },
            date: { type: 'string' as const, description: 'fecha YYYY-MM-DD en la zona del negocio' },
          },
          required: ['service_id', 'date'],
          additionalProperties: false,
        },
        run: async (args: { service_id: string; date: string }) =>
          JSON.stringify(await handlers.getAvailableSlots(args.service_id, args.date)),
      }),
    );
  }
  if (permissions.allowBooking) {
    tools.push(
      betaTool({
        name: 'book_appointment',
        description:
          'Reserva un turno para el cliente de esta conversacion. Solo despues de que el cliente confirme explicitamente servicio y horario.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            service_id: { type: 'string' as const },
            starts_at: { type: 'string' as const, description: 'inicio ISO 8601 (de get_available_slots)' },
          },
          required: ['service_id', 'starts_at'],
          additionalProperties: false,
        },
        run: async (args: { service_id: string; starts_at: string }) =>
          JSON.stringify(
            await handlers.bookAppointment({ serviceId: args.service_id, startsAt: args.starts_at }),
          ),
      }),
    );
  }
  if (permissions.accessHistory) {
    tools.push(
      betaTool({
        name: 'get_customer_history',
        description:
          'Historial de visitas del cliente de esta conversacion (fechas, servicios, estado). Solo para este cliente.',
        inputSchema: { type: 'object' as const, properties: {}, additionalProperties: false },
        run: async () => JSON.stringify(await handlers.getCustomerHistory()),
      }),
    );
  }

  const messages = input.history.map((m) => ({
    role: m.direction === 'in' ? ('user' as const) : ('assistant' as const),
    content: m.senderType === 'agent' ? `[respuesta del personal] ${m.body}` : m.body,
  }));

  const finalMessage = await client.beta.messages.toolRunner({
    model: input.model,
    max_tokens: input.maxTokens ?? 1024,
    system: buildSystem(input),
    tools,
    messages,
    max_iterations: 6,
  });

  const reply = finalMessage.content
    .flatMap((block) => (block.type === 'text' ? [block.text] : []))
    .join('\n')
    .trim();

  return {
    reply: reply.length > 0 ? reply : null,
    inputTokens: finalMessage.usage.input_tokens,
    outputTokens: finalMessage.usage.output_tokens,
  };
}
