import { z } from 'zod';

// Motor del bot gestionado desde el panel de plataforma (ADR 0003).
// Las llaves son write-only: se mandan solo al cargar o rotar.
export const botEngineSettingsPut = z
  .object({
    provider: z.enum(['openai', 'anthropic']),
    model: z.string().max(100).nullable().optional(),
    openai_api_key: z.string().min(10).optional(),
    anthropic_api_key: z.string().min(10).optional(),
  })
  .strict();
export type BotEngineSettingsPut = z.infer<typeof botEngineSettingsPut>;

export interface BotEngineSettingsView {
  provider: 'openai' | 'anthropic';
  model: string | null;
  /** Solo presencia, jamas el valor. */
  keys: { openai: boolean; anthropic: boolean };
  /** 'panel' si hay registro en base; 'env' si rige el fallback de entorno. */
  source: 'panel' | 'env';
}
