import { z } from 'zod';

import { paginationQuery, phoneE164, uuid } from '../validators';

export const conversationListQuery = paginationQuery.extend({
  status: z.enum(['bot_active', 'paused', 'agent', 'closed']).optional(),
  q: z.string().max(120).optional(),
});
export type ConversationListQuery = z.infer<typeof conversationListQuery>;

export const agentMessageCreate = z
  .object({
    body: z.string().min(1).max(4096),
  })
  .strict();
export type AgentMessageCreate = z.infer<typeof agentMessageCreate>;

export const linkCustomerRequest = z.object({ customer_id: uuid }).strict();
export type LinkCustomerRequest = z.infer<typeof linkCustomerRequest>;

/**
 * Payload minimo del webhook de WhatsApp Cloud API (Meta) que procesamos.
 * El chat web de prueba emite exactamente esta forma firmada con el mismo
 * app secret: el pipeline que se testea es el real (doc 04 §3.10).
 */
export const waWebhookPayload = z.object({
  object: z.literal('whatsapp_business_account'),
  entry: z.array(
    z.object({
      id: z.string(),
      changes: z.array(
        z.object({
          field: z.literal('messages'),
          value: z.object({
            messaging_product: z.literal('whatsapp'),
            metadata: z.object({
              display_phone_number: z.string(),
              phone_number_id: z.string(),
            }),
            contacts: z
              .array(
                z.object({
                  profile: z.object({ name: z.string() }).partial(),
                  wa_id: z.string(),
                }),
              )
              .optional(),
            messages: z
              .array(
                z.object({
                  from: z.string(), // telefono del cliente sin '+'
                  id: z.string(), // wa_message_id, dedupe
                  timestamp: z.string(),
                  type: z.string(),
                  text: z.object({ body: z.string() }).optional(),
                }),
              )
              .optional(),
            statuses: z.array(z.unknown()).optional(),
          }),
        }),
      ),
    }),
  ),
});
export type WaWebhookPayload = z.infer<typeof waWebhookPayload>;

/** Cuerpo que envia el chat web de prueba para simular un cliente. */
export const webchatSend = z
  .object({
    phone_number_id: z.string().min(1),
    from_phone: phoneE164,
    from_name: z.string().min(1).max(120).optional(),
    body: z.string().min(1).max(4096),
  })
  .strict();
export type WebchatSend = z.infer<typeof webchatSend>;
