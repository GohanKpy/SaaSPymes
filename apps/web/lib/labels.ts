// Diccionario unico de la interfaz (auditoria de paneles 2026-09-05, fase 0).
// Regla: ningun codigo interno (root, pending, panel, bot, price...) llega a
// la pantalla; todo pasa por aca. Voseo con acentos.
import type { BadgeTone } from './ui';

export const ROLE_LABEL: Record<string, string> = {
  root: 'dueño',
  admin: 'administrador',
  staff: 'personal',
  agent: 'agente',
};

export function roleLabel(role: string | null | undefined): string {
  return (role && ROLE_LABEL[role]) || 'usuario';
}

export const APPOINTMENT_STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  pending: { label: 'a confirmar', tone: 'amber' },
  confirmed: { label: 'confirmado', tone: 'emerald' },
  completed: { label: 'atendido', tone: 'sky' },
  cancelled: { label: 'cancelado', tone: 'slate' },
  no_show: { label: 'no vino', tone: 'red' },
};

export const CONVERSATION_STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  bot_active: { label: 'bot activo', tone: 'violet' },
  paused: { label: 'bot pausado', tone: 'amber' },
  agent: { label: 'con agente', tone: 'sky' },
  inactive: { label: 'inactiva', tone: 'slate' },
  closed: { label: 'resuelta', tone: 'emerald' },
};

export const INVOICE_STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  draft: { label: 'borrador', tone: 'slate' },
  issuing: { label: 'emitiendo…', tone: 'amber' },
  approved: { label: 'aprobada', tone: 'emerald' },
  rejected: { label: 'rechazada por SIFEN', tone: 'red' },
  cancelled: { label: 'anulada', tone: 'slate' },
  credited: { label: 'acreditada', tone: 'sky' },
};

export const QUOTE_STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  draft: { label: 'borrador', tone: 'slate' },
  sent: { label: 'enviado', tone: 'sky' },
  accepted: { label: 'aceptado', tone: 'emerald' },
  rejected: { label: 'rechazado', tone: 'red' },
  invoiced: { label: 'facturado', tone: 'violet' },
};

export const TENANT_STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  trial: { label: 'en prueba', tone: 'amber' },
  active: { label: 'activo', tone: 'emerald' },
  suspended: { label: 'suspendido', tone: 'red' },
  closed: { label: 'cerrado', tone: 'slate' },
};

/** Origen de un turno o de un mensaje. */
export const SOURCE_LABEL: Record<string, string> = {
  panel: 'cargado a mano',
  bot: 'por el bot',
  webchat: 'chat de prueba',
  whatsapp: 'WhatsApp',
  public: 'reserva web',
};

/** Quien escribio un mensaje de la bandeja. */
export const SENDER_LABEL: Record<string, string> = {
  customer: 'cliente',
  bot: 'bot',
  agent: 'vos',
  system: 'sistema',
};

export function statusOf<T extends Record<string, { label: string; tone: BadgeTone }>>(
  map: T,
  code: string | null | undefined,
): { label: string; tone: BadgeTone } {
  return (code && map[code]) || { label: code ?? '—', tone: 'slate' };
}

/** Nombres de campo de la API en lenguaje del usuario (para errores 422). */
const FIELD_LABEL: Record<string, string> = {
  price: 'precio',
  name: 'nombre',
  first_name: 'nombre',
  last_name: 'apellido',
  full_name: 'nombre completo',
  email: 'email',
  phone_e164: 'celular',
  phone: 'teléfono',
  category_id: 'categoría',
  service_id: 'servicio',
  customer_id: 'cliente',
  branch_id: 'sucursal',
  employee_id: 'empleado',
  starts_at: 'fecha y hora',
  duration_min: 'duración',
  meeting_min: 'duración de la reunión',
  tax_rate: 'IVA',
  quantity: 'cantidad',
  unit_price: 'precio unitario',
  items: 'ítems',
  ruc: 'RUC',
  doc_number: 'número de documento',
  birth_date: 'fecha de nacimiento',
  ci_number: 'cédula',
  ips_number: 'número de IPS',
  hire_date: 'fecha de ingreso',
  salary: 'salario',
  legal_name: 'razón social',
  trade_name: 'nombre de fantasía',
  timbrado: 'timbrado',
  establishment: 'establecimiento',
  point: 'punto de expedición',
  phone_number_id: 'identificador del número de WhatsApp',
  access_token: 'token de acceso',
  openai_api_key: 'llave de OpenAI (empieza con sk-)',
  anthropic_api_key: 'llave de Anthropic (empieza con sk-ant-)',
  verify_token: 'token de verificación',
  new_password: 'contraseña nueva',
  current_password: 'contraseña actual',
  body: 'mensaje',
  due_at: 'vencimiento',
  reason: 'motivo',
  code: 'código',
  monthly_price: 'precio mensual',
  max_users: 'máximo de usuarios',
  max_branches: 'máximo de sucursales',
};

/**
 * Mensaje de error para mostrar: el titulo del servidor mas los campos
 * (traducidos) si es una validacion. Nunca "Error" a secas.
 */
export function errorMessage(e: unknown, fallback = 'No se pudo completar la acción. Probá de nuevo.'): string {
  if (e && typeof e === 'object') {
    const problem = (e as { problem?: { title?: string; errors?: Record<string, string[]> } }).problem;
    const title = problem?.title ?? (e as { message?: string }).message;
    if (problem?.errors && Object.keys(problem.errors).length > 0) {
      const campos = Object.keys(problem.errors)
        .map((k) => FIELD_LABEL[k] ?? k.replace(/_/g, ' '))
        .join(', ');
      return `Revisá estos datos: ${campos}.`;
    }
    if (title && title !== 'Error') return title;
  }
  return fallback;
}
