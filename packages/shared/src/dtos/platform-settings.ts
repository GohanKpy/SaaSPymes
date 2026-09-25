import { z } from 'zod';

// Formato de las llaves (2026-09-24): el navegador autocompletaba el campo con
// la contrasena del panel y quedaba guardada como llave; ahora se rechaza.
export const openaiApiKey = z
  .string()
  .trim()
  .regex(/^sk-[A-Za-z0-9_-]{20,}$/, 'La llave de OpenAI empieza con "sk-"')
  .refine((v) => !v.startsWith('sk-ant-'), 'Esa es una llave de Anthropic, no de OpenAI');
export const anthropicApiKey = z
  .string()
  .trim()
  .regex(/^sk-ant-[A-Za-z0-9_-]{20,}$/, 'La llave de Anthropic empieza con "sk-ant-"');

// Motor del bot gestionado desde el panel de plataforma (ADR 0003).
// Las llaves son write-only: se mandan solo al cargar o rotar.
export const botEngineSettingsPut = z
  .object({
    provider: z.enum(['openai', 'anthropic']),
    model: z.string().max(100).nullable().optional(),
    openai_api_key: openaiApiKey.optional(),
    anthropic_api_key: anthropicApiKey.optional(),
    /** Guia de atencion estandar para todos los tenants (ADR 0008); null = default del sistema. */
    base_prompt: z.string().max(20000).nullable().optional(),
    /** Espera tras el ultimo mensaje del cliente antes de responder (0-120 s). */
    reply_debounce_seconds: z.number().int().min(0).max(120).optional(),
    /** Tope horario de IA por tenant = presupuesto mensual / este divisor. */
    hourly_budget_divisor: z.number().int().min(1).max(720).optional(),
    /** Aviso al cliente si el proveedor de IA falla; null = texto por defecto. */
    fallback_notice: z.string().min(10).max(500).nullable().optional(),
    /** Aviso al cliente al agotarse el presupuesto mensual; null = default. */
    budget_notice: z.string().min(10).max(500).nullable().optional(),
  })
  .strict();
export type BotEngineSettingsPut = z.infer<typeof botEngineSettingsPut>;

export interface BotEngineSettingsView {
  provider: 'openai' | 'anthropic';
  model: string | null;
  /** null = rige el prompt base por defecto del sistema. */
  base_prompt: string | null;
  reply_debounce_seconds: number;
  hourly_budget_divisor: number;
  /** null = rige el texto por defecto del sistema. */
  fallback_notice: string | null;
  budget_notice: string | null;
  /** Solo presencia, jamas el valor. */
  keys: { openai: boolean; anthropic: boolean };
  /** 'panel' si hay registro en base; 'env' si rige el fallback de entorno. */
  source: 'panel' | 'env';
}

/** App OAuth de Google del sistema (ADR 0007): una para toda la plataforma. */
export const googleOauthSettingsPut = z
  .object({
    client_id: z.string().min(10).max(200),
    /** Solo al cargar o rotar; ausente = mantener el guardado. */
    client_secret: z.string().min(10).max(200).optional(),
    /** Iniciar sesion con Google en los paneles (2026-09-22): misma app OAuth. */
    sign_in_enabled: z.boolean().optional(),
  })
  .strict();
export type GoogleOauthSettingsPut = z.infer<typeof googleOauthSettingsPut>;

export interface GoogleOauthSettingsView {
  client_id: string | null;
  /** Solo presencia, jamas el valor. */
  has_secret: boolean;
  sign_in_enabled: boolean;
}

/**
 * Asistente interno del portal admin (pedido 2026-09-02): chat de soporte
 * para operadores, alimentado con el manual del sistema. El historial viaja
 * completo desde el navegador (el server no guarda estado del chat).
 */
export const assistantAsk = z
  .object({
    messages: z
      .array(
        z
          .object({
            role: z.enum(['user', 'assistant']),
            content: z.string().min(1).max(4000),
          })
          .strict(),
      )
      .min(1)
      .max(40),
  })
  .strict()
  .refine((d) => d.messages[d.messages.length - 1]?.role === 'user', {
    message: 'el ultimo mensaje debe ser del usuario',
    path: ['messages'],
  });
export type AssistantAsk = z.infer<typeof assistantAsk>;

/** Correo saliente del sistema (2026-09-07): SMTP para resumenes y facturas por email. */
export const mailSettingsPut = z
  .object({
    host: z.string().min(1).max(200),
    port: z.number().int().min(1).max(65535).default(587),
    /** TLS implicito (465); false = STARTTLS o sin cifrado (Mailpit). */
    secure: z.boolean().default(false),
    user: z.string().max(200).optional(),
    /** Solo al cargar o rotar; ausente = mantener la guardada. */
    password: z.string().min(1).max(500).optional(),
    from_email: z.email(),
    from_name: z.string().max(120).optional(),
  })
  .strict();
export type MailSettingsPut = z.infer<typeof mailSettingsPut>;

export interface MailSettingsView {
  host: string | null;
  port: number | null;
  secure: boolean;
  user: string | null;
  from_email: string | null;
  from_name: string | null;
  /** Solo presencia, jamas el valor. */
  has_password: boolean;
  /** 'panel' si hay registro en base; 'env' si rige SMTP_HOST del entorno. */
  source: 'panel' | 'env';
}

/**
 * Padron RUC de la DNIT (ADR 0012): descarga programada del listado publico
 * de contribuyentes (10 zips) que alimenta el autocompletado de razon social
 * y DV en clientes y facturas. La DNIT lo publica los dias 1-2 de cada mes;
 * la corrida es mensual (dia y hora en America/Asuncion) y se recupera sola
 * si el proceso estaba caido cuando tocaba.
 */
export const rucPadronSettingsPut = z
  .object({
    enabled: z.boolean(),
    /** Pagina de la DNIT con los enlaces ruc0..ruc9.zip; null = la del sistema. */
    page_url: z.url().max(500).nullable().optional(),
    /** Dia del mes de la corrida (1-28 para que exista en todos los meses). */
    day_of_month: z.number().int().min(1).max(28),
    /** Hora local (America/Asuncion) de la corrida. */
    hour: z.number().int().min(0).max(23),
  })
  .strict();
export type RucPadronSettingsPut = z.infer<typeof rucPadronSettingsPut>;

export interface RucPadronRunView {
  id: string;
  started_at: string;
  finished_at: string | null;
  status: 'running' | 'ok' | 'error';
  triggered_by: 'cron' | 'manual' | 'startup';
  files_ok: number;
  rows_read: number;
  rows_changed: number;
  error: string | null;
}

export interface RucPadronSettingsView {
  enabled: boolean;
  page_url: string;
  page_url_default: string;
  day_of_month: number;
  hour: number;
  timezone: string;
  /** Contribuyentes cargados hoy en la base. */
  contribuyentes: number;
  last_ok_at: string | null;
  /** Proxima corrida programada; null si esta apagado. */
  next_run_at: string | null;
  running: boolean;
  /** Ultimas corridas, la mas reciente primero. */
  runs: RucPadronRunView[];
}
