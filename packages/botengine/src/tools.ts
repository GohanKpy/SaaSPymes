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

/**
 * Implementadas por la API, ya scopeadas por tenant + conversacion (RLS).
 * Contrato SOLO en hora local del negocio: los modelos chicos confunden UTC
 * con hora local si ven ambas, asi que el ISO/UTC jamas sale del servidor.
 */
export interface BotToolHandlers {
  listServices(): Promise<
    {
      id: string;
      name: string;
      categoria: string | null;
      descripcion: string | null;
      price: string;
      currency: string;
      durationMin: number | null;
      /** true = se puede agendar por chat; false = solo informativo. */
      agendable: boolean;
    }[]
  >;
  /** Horarios libres del dia (hora local); si no hay, incluye la proxima fecha con disponibilidad. */
  getAvailableSlots(
    serviceId: string,
    date: string,
  ): Promise<{
    date: string;
    horarios_disponibles: string[];
    proxima_fecha_con_horarios?: string;
    horarios_de_proxima_fecha?: string[];
  }>;
  bookAppointment(args: {
    serviceId: string;
    date: string;
    horaLocal: string;
  }): Promise<{
    id: string;
    status: string;
    date: string;
    horaLocal: string;
    serviceName: string;
  }>;
  getCustomerHistory(): Promise<
    { startsAt: string; serviceName: string | null; visitStatus: string }[]
  >;
  /** Registra/actualiza el nombre del cliente de la conversacion en la agenda. */
  saveCustomerName(fullName: string): Promise<{ saved: boolean; detail: string }>;
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
        'Lista TODOS los servicios del negocio con precio (guaranies, IVA incluido), descripcion y el campo agendable: true = se puede reservar por chat; false = solo se informa y se ofrece derivar o agendar una reunion. Usala SIEMPRE antes de hablar de precios o de que ofrece el negocio.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      run: async () => JSON.stringify(await handlers.listServices()),
    });
  }
  if (permissions.accessCalendar) {
    tools.push({
      name: 'get_available_slots',
      description:
        'Devuelve los horarios libres (hora local del negocio, formato HH:MM) para un servicio en una fecha dada. Si esa fecha no tiene horarios, la respuesta incluye la proxima fecha con disponibilidad y sus horarios: ofrecelos. SIEMPRE llama primero a list_services y usa el id exacto que devuelve; nunca inventes un service_id.',
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
        'Reserva un turno para el cliente de esta conversacion. Solo despues de que el cliente confirme explicitamente servicio y horario. Antes de reservar consulta get_available_slots en este mismo turno: hora_local debe ser exactamente uno de los horarios que devolvio para esa fecha.',
      parameters: {
        type: 'object',
        properties: {
          service_id: { type: 'string', description: 'id del servicio (de list_services)' },
          date: { type: 'string', description: 'fecha YYYY-MM-DD en la zona del negocio' },
          hora_local: {
            type: 'string',
            description: 'hora local HH:MM, uno de los horarios de get_available_slots',
          },
        },
        required: ['service_id', 'date', 'hora_local'],
        additionalProperties: false,
      },
      run: async (args) =>
        JSON.stringify(
          await handlers.bookAppointment({
            serviceId: args.service_id ?? '',
            date: args.date ?? '',
            horaLocal: args.hora_local ?? '',
          }),
        ),
    });
  }
  if (permissions.accessCustomerData) {
    tools.push({
      name: 'save_customer_name',
      description:
        'Registra al cliente de esta conversacion en la agenda del negocio con su nombre. Usala SOLO despues de que el cliente CONFIRME su nombre completo (pregunta "¿Tu nombre completo es ...?" antes). Nunca pises un nombre ya registrado: si la herramienta responde que ya estaba agendado, no insistas.',
      parameters: {
        type: 'object',
        properties: {
          full_name: {
            type: 'string',
            description: 'nombre y apellido tal como los confirmo el cliente',
          },
        },
        required: ['full_name'],
        additionalProperties: false,
      },
      run: async (args) => JSON.stringify(await handlers.saveCustomerName(args.full_name ?? '')),
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
