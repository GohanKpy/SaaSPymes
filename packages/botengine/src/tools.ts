// Definicion de herramientas del bot, agnostica al proveedor (ADR 0002).
// Reglas duras que viven en el codigo, no en el prompt (doc 05 §6):
//  1. Los permisos tildados definen QUE herramientas existen: un permiso
//     apagado significa que la herramienta ni siquiera se declara.
//  2. Cada herramienta ejecuta server-side ya scopeada al tenant y al
//     cliente de la conversacion; el bot no puede consultar por terceros.

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
  getAvailableSlots(
    serviceId: string,
    date: string,
  ): Promise<{ iso: string; hora_local: string }[]>;
  bookAppointment(args: {
    serviceId: string;
    startsAt: string;
  }): Promise<{
    id: string;
    status: string;
    startsAt: string;
    horaLocal: string;
    serviceName: string;
  }>;
  getCustomerHistory(): Promise<
    { startsAt: string; serviceName: string | null; visitStatus: string }[]
  >;
}

export interface JsonSchema {
  type: 'object';
  properties: Record<string, { type: string; description?: string }>;
  required?: string[];
  additionalProperties: false;
}

export interface ToolDef {
  name: string;
  description: string;
  parameters: JsonSchema;
  run: (args: Record<string, string>) => Promise<string>;
}

export function buildBotTools(permissions: BotPermissions, handlers: BotToolHandlers): ToolDef[] {
  const tools: ToolDef[] = [];

  if (permissions.accessCatalog) {
    tools.push({
      name: 'list_services',
      description:
        'Lista los servicios que ofrece el negocio con precio (en guaranies, IVA incluido) y duracion en minutos. Usala antes de hablar de precios o servicios.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      run: async () => JSON.stringify(await handlers.listServices()),
    });
  }
  if (permissions.accessCalendar) {
    tools.push({
      name: 'get_available_slots',
      description:
        'Devuelve los horarios disponibles para un servicio en una fecha dada: hora_local es la hora de Paraguay para mostrar al cliente; iso es el valor para book_appointment. SIEMPRE llama primero a list_services y usa el id exacto que devuelve; nunca inventes un service_id.',
      parameters: {
        type: 'object',
        properties: {
          service_id: { type: 'string', description: 'id del servicio (de list_services)' },
          date: { type: 'string', description: 'fecha YYYY-MM-DD en la zona del negocio' },
        },
        required: ['service_id', 'date'],
        additionalProperties: false,
      },
      run: async (args) =>
        JSON.stringify(await handlers.getAvailableSlots(args.service_id ?? '', args.date ?? '')),
    });
  }
  if (permissions.allowBooking) {
    tools.push({
      name: 'book_appointment',
      description:
        'Reserva un turno para el cliente de esta conversacion. Solo despues de que el cliente confirme explicitamente servicio y horario. Usa el service_id de list_services y el campo iso del slot elegido de get_available_slots.',
      parameters: {
        type: 'object',
        properties: {
          service_id: { type: 'string' },
          starts_at: { type: 'string', description: 'inicio ISO 8601 (de get_available_slots)' },
        },
        required: ['service_id', 'starts_at'],
        additionalProperties: false,
      },
      run: async (args) =>
        JSON.stringify(
          await handlers.bookAppointment({
            serviceId: args.service_id ?? '',
            startsAt: args.starts_at ?? '',
          }),
        ),
    });
  }
  if (permissions.accessHistory) {
    tools.push({
      name: 'get_customer_history',
      description:
        'Historial de visitas del cliente de esta conversacion (fechas, servicios, estado). Solo para este cliente.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      run: async () => JSON.stringify(await handlers.getCustomerHistory()),
    });
  }
  return tools;
}
