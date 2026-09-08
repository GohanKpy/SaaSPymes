// Definicion de herramientas del bot, agnostica al proveedor (ADR 0002).
// Reglas duras que viven en el codigo, no en el prompt (doc 05 §6):
//  1. Los permisos tildados definen QUE herramientas existen: un permiso
//     apagado significa que la herramienta ni siquiera se declara.
//  2. Cada herramienta ejecuta server-side ya scopeada al tenant y al
//     cliente de la conversacion; el bot no puede consultar por terceros.
//  3. Las descripciones son CONTRATO (que recibe, que devuelve), no un
//     manual de conversacion: las reglas de cuando y como usarlas viven en
//     buildSystem, una sola vez cada una (ADR 0011).

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
      /** Mismo nombre que el parametro service_id de las demas herramientas. */
      service_id: string;
      name: string;
      categoria: string | null;
      descripcion: string | null;
      price: string;
      currency: string;
      /** 'servicio' = trabajo con turno propio; 'item' = producto/venta (ADR 0009). */
      tipo: 'servicio' | 'item';
      /** Solo servicios: duracion de la tarea en minutos. */
      durationMin: number | null;
      /** Solo items: el negocio pide coordinar una reunion inicial para tratarlo. */
      requiereReunion: boolean;
      /** Solo items que requieren reunion: duracion en minutos; null = venta directa. */
      reunionInicialMin: number | null;
    }[]
  >;
  /** Horarios libres del dia (hora local); si no hay, incluye la proxima fecha con disponibilidad. */
  getAvailableSlots(
    serviceId: string,
    date: string,
    /** Solo horarios de ESTE empleado (nombre del EQUIPO), si el cliente lo pidio. */
    empleado?: string,
  ): Promise<{
    date: string;
    horarios_disponibles: string[];
    /** La misma lista partida: manana < 13:00 <= tarde (guia de lectura). */
    manana?: string[];
    tarde?: string[];
    proxima_fecha_con_horarios?: string;
    horarios_de_proxima_fecha?: string[];
  }>;
  bookAppointment(args: {
    serviceId: string;
    date: string;
    horaLocal: string;
    /** Pedido especial o modalidad (ej. "prefiere por Meet"): va a notes. */
    nota?: string;
    /** Empleado elegido por el cliente (nombre del EQUIPO); vacio = asigna el sistema. */
    empleado?: string;
  }): Promise<{
    id: string;
    status: string;
    date: string;
    horaLocal: string;
    serviceName: string;
    /** 'servicio' = turno del servicio en si; 'reunion_inicial' = reunion para tratarlo. */
    tipo: 'servicio' | 'reunion_inicial';
    /** Nombre del empleado asignado; null si el negocio no maneja empleados. */
    atendidoPor: string | null;
  }>;
  getCustomerHistory(): Promise<
    { startsAt: string; serviceName: string | null; visitStatus: string }[]
  >;
  /** Turnos PROXIMOS del cliente de esta conversacion (para cancelar/cambiar). */
  listMyAppointments(): Promise<
    {
      /** Mismo nombre que el parametro appointment_id de cancelar/cambiar. */
      appointment_id: string;
      date: string;
      horaLocal: string;
      serviceName: string | null;
      status: string;
      atendidoPor: string | null;
    }[]
  >;
  /** Cancela un turno propio y futuro del cliente de esta conversacion. */
  cancelAppointment(args: { appointmentId: string; motivo?: string }): Promise<{
    cancelado: boolean;
    detalle: string;
  }>;
  /** Mueve un turno propio y futuro a otra fecha/hora (misma logica que reservar). */
  rescheduleAppointment(args: {
    appointmentId: string;
    date: string;
    horaLocal: string;
    empleado?: string;
  }): Promise<{
    id: string;
    status: string;
    date: string;
    horaLocal: string;
    serviceName: string;
    atendidoPor: string | null;
    anterior: { date: string; horaLocal: string };
  }>;
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
        'Catalogo completo del negocio: service_id (el que usan las demas herramientas), nombre, categoria, descripcion, precio (guaranies, IVA incluido) y tipo. tipo="servicio": se reserva como turno de durationMin minutos. tipo="item": producto o venta; se coordina con una reunion inicial de reunionInicialMin minutos cuando requiereReunion es true.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      run: async () => JSON.stringify(await handlers.listServices()),
    });
  }
  if (permissions.accessCalendar) {
    tools.push({
      name: 'get_available_slots',
      description:
        'Horarios libres (hora local del negocio, HH:MM) de un servicio en una fecha, ya separados en manana y tarde. Para tipo="item" son los horarios de su reunion inicial. Si la fecha no tiene lugar, incluye la proxima fecha con horarios. Con empleado, devuelve solo los horarios de esa persona.',
      parameters: {
        type: 'object',
        properties: {
          service_id: { type: 'string', description: 'service_id tal cual lo devuelve list_services (nunca un numero de orden)' },
          date: { type: 'string', description: 'fecha YYYY-MM-DD en la zona del negocio' },
          empleado: {
            type: 'string',
            description: 'opcional: nombre del equipo si el cliente pidio a alguien; vacio = cualquiera del equipo',
          },
        },
        required: ['service_id', 'date'],
        additionalProperties: false,
      },
      run: async (args) =>
        JSON.stringify(
          await handlers.getAvailableSlots(args.service_id ?? '', args.date ?? '', args.empleado),
        ),
    });
  }
  if (permissions.allowBooking) {
    tools.push({
      name: 'book_appointment',
      description:
        'Reserva para el cliente de esta conversacion el servicio service_id en date a hora_local (uno de los horarios devueltos por get_available_slots para esa fecha y ese empleado). Devuelve id, estado, tipo (servicio o reunion_inicial) y quien atiende (atendidoPor): decíselo al cliente. Si el empleado pedido no esta libre a esa hora, el error trae sus otros horarios y quien mas podria atender: ofrecele eso.',
      parameters: {
        type: 'object',
        properties: {
          service_id: { type: 'string', description: 'service_id tal cual lo devuelve list_services (nunca un numero de orden)' },
          date: { type: 'string', description: 'fecha YYYY-MM-DD en la zona del negocio' },
          hora_local: {
            type: 'string',
            description: 'hora local HH:MM, uno de los horarios de get_available_slots',
          },
          nota: {
            type: 'string',
            description: 'opcional: modalidad o pedido especial del cliente',
          },
          empleado: {
            type: 'string',
            description: 'opcional: nombre del equipo si el cliente pidio a alguien; vacio = el sistema asigna al profesional libre con menos trabajo ese dia',
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
            empleado: args.empleado,
          }),
        ),
    });
  }
  if (permissions.allowBooking) {
    tools.push({
      name: 'list_my_appointments',
      description:
        'Turnos proximos del cliente de esta conversacion: appointment_id (el que usan cancelar y cambiar), fecha, hora local, servicio, estado y quien lo atiende.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      run: async () => JSON.stringify(await handlers.listMyAppointments()),
    });
    tools.push({
      name: 'cancel_appointment',
      description:
        'Cancela un turno futuro del cliente de esta conversacion por su id (de list_my_appointments).',
      parameters: {
        type: 'object',
        properties: {
          appointment_id: { type: 'string', description: 'appointment_id tal cual lo devuelve list_my_appointments (nunca un numero de orden)' },
          motivo: { type: 'string', description: 'opcional: motivo breve que dio el cliente' },
        },
        required: ['appointment_id'],
        additionalProperties: false,
      },
      run: async (args) =>
        JSON.stringify(
          await handlers.cancelAppointment({
            appointmentId: args.appointment_id ?? '',
            motivo: args.motivo,
          }),
        ),
    });
    tools.push({
      name: 'reschedule_appointment',
      description:
        'Mueve un turno futuro del cliente de esta conversacion (id de list_my_appointments) a date y hora_local (uno de los horarios de get_available_slots para el mismo servicio). Mantiene el profesional salvo que se indique otro en empleado.',
      parameters: {
        type: 'object',
        properties: {
          appointment_id: { type: 'string', description: 'appointment_id tal cual lo devuelve list_my_appointments (nunca un numero de orden)' },
          date: { type: 'string', description: 'nueva fecha YYYY-MM-DD en la zona del negocio' },
          hora_local: {
            type: 'string',
            description: 'nueva hora local HH:MM, uno de los horarios de get_available_slots',
          },
          empleado: {
            type: 'string',
            description: 'opcional: solo si el cliente pide cambiar de profesional',
          },
        },
        required: ['appointment_id', 'date', 'hora_local'],
        additionalProperties: false,
      },
      run: async (args) =>
        JSON.stringify(
          await handlers.rescheduleAppointment({
            appointmentId: args.appointment_id ?? '',
            date: args.date ?? '',
            horaLocal: args.hora_local ?? '',
            empleado: args.empleado,
          }),
        ),
    });
  }
  if (permissions.accessCustomerData) {
    tools.push({
      name: 'save_customer_name',
      description:
        'Registra el nombre y apellido del cliente de esta conversacion en la agenda del negocio. Una sola vez por conversacion; si ya estaba agendado lo informa y no pisa el nombre existente.',
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
        'Completa campos vacios de la ficha del cliente de esta conversacion (email, fecha de nacimiento, direccion, documento). No pisa datos ya cargados.',
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
      'Marca esta conversacion como "necesita humano" en la bandeja del negocio y avisa al equipo en vivo. Es la unica forma de derivar a una persona.',
    parameters: {
      type: 'object',
      properties: {
        motivo: {
          type: 'string',
          description: 'motivo breve para el equipo',
        },
      },
      required: ['motivo'],
      additionalProperties: false,
    },
    run: async (args) => JSON.stringify(await handlers.requestHuman(args.motivo ?? '')),
  });
  return tools;
}
