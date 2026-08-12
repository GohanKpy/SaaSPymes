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
    /** Pedido especial o modalidad (ej. "prefiere por Meet"): va a notes. */
    nota?: string;
  }): Promise<{
    id: string;
    status: string;
    date: string;
    horaLocal: string;
    serviceName: string;
    /** 'servicio' = turno del servicio en si; 'reunion_inicial' = reunion para tratarlo. */
    tipo: 'servicio' | 'reunion_inicial';
  }>;
  getCustomerHistory(): Promise<
    { startsAt: string; serviceName: string | null; visitStatus: string }[]
  >;
  /** Registra/actualiza el nombre del cliente de la conversacion en la agenda. */
  saveCustomerName(fullName: string): Promise<{ saved: boolean; detail: string }>;
  /** Completa datos vacios de la ficha (email, nacimiento, direccion, documento). */
  saveCustomerData(args: {
    email?: string;
    fechaNacimiento?: string;
    direccion?: string;
    docTipo?: string;
    docNumero?: string;
  }): Promise<{ guardados: string[]; ignorados: string[] }>;
  /** Marca la conversacion como "necesita humano" en la bandeja del negocio. */
  requestHuman(motivo: string): Promise<{ marcada: boolean; detalle: string }>;
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
        'Lista TODOS los servicios del negocio con precio (guaranies, IVA incluido), descripcion y el campo agendable. TODO servicio se puede coordinar por chat: agendable=true reserva el servicio en si; agendable=false reserva una REUNION INICIAL (30 min por defecto) para tratarlo, con las mismas herramientas de horarios y reserva. Usala SIEMPRE antes de hablar de precios o de que ofrece el negocio.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      run: async () => JSON.stringify(await handlers.listServices()),
    });
  }
  if (permissions.accessCalendar) {
    tools.push({
      name: 'get_available_slots',
      description:
        'Devuelve los horarios libres (hora local del negocio, formato HH:MM) para un servicio en una fecha dada — para servicios con agendable=false son los horarios de su reunion inicial. Si esa fecha no tiene horarios, la respuesta incluye la proxima fecha con disponibilidad y sus horarios: ofrecelos. SIEMPRE llama primero a list_services y usa el id exacto que devuelve; nunca inventes un service_id.',
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
        'Reserva un turno para el cliente de esta conversacion. Solo despues de que el cliente confirme explicitamente servicio y horario. Antes de reservar consulta get_available_slots en este mismo turno: hora_local debe ser exactamente uno de los horarios que devolvio para esa fecha. Si el servicio tiene agendable=false, lo reservado es una REUNION INICIAL para tratarlo (la respuesta lo indica en tipo): confirmaselo asi al cliente. Si el cliente pidio una modalidad especial (ej. virtual/por Meet) o dejo un pedido puntual, registralo en nota Y ademas llama request_human para que el equipo lo coordine.',
      parameters: {
        type: 'object',
        properties: {
          service_id: { type: 'string', description: 'id del servicio (de list_services)' },
          date: { type: 'string', description: 'fecha YYYY-MM-DD en la zona del negocio' },
          hora_local: {
            type: 'string',
            description: 'hora local HH:MM, uno de los horarios de get_available_slots',
          },
          nota: {
            type: 'string',
            description:
              'opcional: modalidad o pedido especial del cliente (ej. "prefiere por Meet"); queda visible para el equipo en la reserva',
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
            nota: args.nota,
          }),
        ),
    });
  }
  if (permissions.accessCustomerData) {
    tools.push({
      name: 'save_customer_name',
      description:
        'Registra al cliente de esta conversacion en la agenda del negocio con su nombre. Si el cliente se presenta espontaneamente con nombre y apellido ("Soy Ana Benitez"), registralo directamente sin pedir confirmacion; confirma antes solo si el nombre es ambiguo o incompleto. Llamala UNA sola vez: si responde que ya estaba agendado, no insistas ni la repitas.',
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
    tools.push({
      name: 'save_customer_data',
      description:
        'Completa la ficha del cliente de esta conversacion con datos que el compartio: email, fecha de nacimiento, direccion o documento. Solo completa campos vacios (jamas pisa datos ya cargados). Usala apenas el cliente mencione uno de estos datos.',
      parameters: {
        type: 'object',
        properties: {
          email: { type: 'string', description: 'email del cliente' },
          fecha_nacimiento: { type: 'string', description: 'YYYY-MM-DD' },
          direccion: { type: 'string' },
          doc_tipo: { type: 'string', description: 'ci | ruc | pasaporte' },
          doc_numero: { type: 'string', description: 'numero de documento sin DV' },
        },
        additionalProperties: false,
      },
      run: async (args) =>
        JSON.stringify(
          await handlers.saveCustomerData({
            email: args.email,
            fechaNacimiento: args.fecha_nacimiento,
            direccion: args.direccion,
            docTipo: args.doc_tipo,
            docNumero: args.doc_numero,
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
  // Valvula de escape SIEMPRE disponible (unica tool sin permiso que la
  // apague, decision de auditoria 2026-08-07): si el bot le dice al cliente
  // que lo deriva a una persona, la bandeja TIENE que enterarse. Sin esto la
  // derivacion era una frase vacia y nadie atendia jamas.
  tools.push({
    name: 'request_human',
    description:
      'Marca esta conversacion como "necesita humano" en la bandeja del negocio para que una persona del equipo la atienda y le avisa en vivo. Usala SIEMPRE que le digas al cliente que le pasas la consulta a un companero, que alguien lo va a contactar o coordinar algo, o cuando pida hablar con una persona. Nunca prometas derivacion sin llamarla.',
    parameters: {
      type: 'object',
      properties: {
        motivo: {
          type: 'string',
          description: 'motivo breve para el equipo (ej. "pide hablar con una persona", "coordinar link de Meet")',
        },
      },
      required: ['motivo'],
      additionalProperties: false,
    },
    run: async (args) => JSON.stringify(await handlers.requestHuman(args.motivo ?? '')),
  });
  return tools;
}
