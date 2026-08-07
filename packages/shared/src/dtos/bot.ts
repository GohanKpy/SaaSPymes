import { z } from 'zod';

/** Casillas de permisos del bot (doc 05 §6): definen que herramientas existen. */
export const botSettingsPatch = z
  .object({
    enabled: z.boolean(),
    instructions_text: z.string().max(20000).nullable(),
    /** Consentimiento: sus instrucciones priman sobre la guia base (ADR 0008). */
    instructions_override: z.boolean(),
    access_catalog: z.boolean(),
    access_history: z.boolean(),
    access_customer_data: z.boolean(),
    access_calendar: z.boolean(),
    allow_booking: z.boolean(),
    auto_confirm_bookings: z.boolean(),
  })
  .partial()
  .strict();
export type BotSettingsPatch = z.infer<typeof botSettingsPatch>;

/**
 * El presupuesto mensual de tokens es control de costo del dueño del sistema
 * (doc 09 R9, ADR 0006): se edita solo desde el portal admin, no por el tenant.
 */
export const botBudgetPut = z
  .object({ monthly_token_budget: z.number().int().min(0) })
  .strict();
export type BotBudgetPut = z.infer<typeof botBudgetPut>;
