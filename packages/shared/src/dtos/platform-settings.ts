import { z } from 'zod';

// Motor del bot gestionado desde el panel de plataforma (ADR 0003).
// Las llaves son write-only: se mandan solo al cargar o rotar.
export const botEngineSettingsPut = z
  .object({
    provider: z.enum(['openai', 'anthropic']),
    model: z.string().max(100).nullable().optional(),
    openai_api_key: z.string().min(10).optional(),
    anthropic_api_key: z.string().min(10).optional(),
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
