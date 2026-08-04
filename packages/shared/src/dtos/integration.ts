import { z } from 'zod';

// Solo root del tenant toca integraciones; la API jamas devuelve secretos
// (doc 04 §3.3). Lo secreto viaja cifrado a integration_credentials.

export const whatsappIntegrationPut = z
  .object({
    phone_number_id: z.string().min(1).max(64),
    access_token: z.string().min(1),
    verify_token: z.string().min(1).max(128),
  })
  .strict();
export type WhatsappIntegrationPut = z.infer<typeof whatsappIntegrationPut>;

export const smtpIntegrationPut = z
  .object({
    host: z.string().min(1).max(253),
    port: z.number().int().min(1).max(65535).default(587),
    username: z.string().min(1).max(200),
    password: z.string().min(1),
    from_email: z.email(),
  })
  .strict();
export type SmtpIntegrationPut = z.infer<typeof smtpIntegrationPut>;

export const sifenIntegrationPut = z
  .object({
    timbrado: z.string().regex(/^\d{8}$/, 'timbrado de 8 digitos'),
    establishment: z.string().regex(/^\d{3}$/, '3 digitos, ej. 001'),
    expedition_point: z.string().regex(/^\d{3}$/, '3 digitos, ej. 001'),
    // El certificado .p12 real llega con la integracion definitiva; la
    // passphrase ya viaja cifrada para dejar el circuito listo.
    cert_passphrase: z.string().optional(),
  })
  .strict();
export type SifenIntegrationPut = z.infer<typeof sifenIntegrationPut>;

export interface IntegrationStatus {
  type: 'whatsapp' | 'smtp' | 'sifen' | 'google_calendar' | 'payment';
  configured: boolean;
  is_active: boolean;
  public_config: Record<string, unknown>;
}
