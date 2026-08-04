import { z } from 'zod';

/** Casillas de permisos del bot (doc 05 §6): definen que herramientas existen. */
export const botSettingsPatch = z
  .object({
    enabled: z.boolean(),
    instructions_text: z.string().max(20000).nullable(),
    access_catalog: z.boolean(),
    access_history: z.boolean(),
    access_customer_data: z.boolean(),
    access_calendar: z.boolean(),
    allow_booking: z.boolean(),
    auto_confirm_bookings: z.boolean(),
    monthly_token_budget: z.number().int().min(0),
  })
  .partial()
  .strict();
export type BotSettingsPatch = z.infer<typeof botSettingsPatch>;
