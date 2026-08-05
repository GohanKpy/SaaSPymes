import { z } from 'zod';

// Variables de entorno del laboratorio local y de AWS (docs/plan/11 §3).
// Regla de portabilidad: endpoints, buckets, colas y hosts SIEMPRE por variable,
// nunca fijos en el codigo. El pase a AWS es solo un cambio de valores.

/** URL http(s) o cadena vacia: los endpoints de emuladores van vacios en AWS. */
const emptyableUrl = z
  .string({ error: 'requerida (vacia en AWS, con URL del emulador en local)' })
  .refine((v) => v === '' || /^https?:\/\/.+/.test(v), {
    message: 'debe ser una URL http(s) o cadena vacia',
  });

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // Puerto de la API (no es un host externo; configurable igual).
  API_PORT: z.coerce.number().int().positive().default(3001),

  // PostgreSQL: en local apunta al contenedor `db`, en AWS a RDS.
  // DATABASE_URL conecta como app_rw (requests de tenants, RLS siempre);
  // PLATFORM_DATABASE_URL como platform_ops (login, panel admin, webhooks).
  // MIGRATOR_DATABASE_URL existe solo para la CLI de migraciones: no es de runtime.
  DATABASE_URL: z.string().min(1),
  PLATFORM_DATABASE_URL: z.string().min(1),

  // Claves RS256 de JWT (doc 05 §3), PEM en base64. En AWS: SSM SecureString.
  JWT_PRIVATE_KEY_BASE64: z.string().min(1),
  JWT_PUBLIC_KEY_BASE64: z.string().min(1),

  // Webhooks de WhatsApp (doc 04 §3.10): firma HMAC y handshake de Meta.
  META_APP_SECRET: z.string().min(1),
  META_VERIFY_TOKEN: z.string().min(1),
  // Base de Graph API para el envio saliente; en el laboratorio se puede
  // apuntar a un fake-server (doc 11 §4) sin tocar codigo.
  WA_GRAPH_BASE_URL: z.string().url().default('https://graph.facebook.com/v21.0'),

  // Restriccion por IP de la superficie de plataforma (ADR 0004).
  // Lista de IPs/CIDRs separadas por comas; vacia = sin restriccion.
  PLATFORM_ALLOWED_IPS: z.string().optional(),

  // Origenes del panel web para CORS con credenciales (cookie de refresh).
  // Admite lista separada por comas; en desarrollo la API ademas acepta
  // cualquier host en el puerto del panel.
  WEB_ORIGIN: z.string().min(1),

  // S3 / MinIO. En AWS el endpoint va vacio y el SDK usa el real.
  S3_ENDPOINT: emptyableUrl,
  S3_FORCE_PATH_STYLE: z.enum(['true', 'false']).transform((v) => v === 'true'),

  // SQS / ElasticMQ. En AWS el endpoint va vacio.
  SQS_ENDPOINT: emptyableUrl,

  // Credenciales AWS: de juguete en local; en AWS las provee el rol IAM.
  AWS_ACCESS_KEY_ID: z.string().min(1),
  AWS_SECRET_ACCESS_KEY: z.string().min(1),

  // CryptoService: implementacion local o KMS (docs/plan/11 §1).
  CRYPTO_PROVIDER: z.enum(['local', 'kms']),
  // Clave del proveedor local (AES-256-GCM). Irrelevante con kms.
  CRYPTO_LOCAL_KEY_BASE64: z.string().optional(),

  // SMTP saliente: Mailpit en local, el SMTP del tenant en produccion.
  SMTP_HOST: z.string().min(1),

  // WhatsApp Cloud API: servidor falso en local, Graph API en produccion.
  WHATSAPP_API_URL: z.url(),

  // InvoicingProvider: fake en local; sandbox o proveedor real despues.
  INVOICING_PROVIDER: z.string().min(1),

  // Motor del bot multi-proveedor (ADR 0002): OpenAI o Anthropic por config.
  // Sin la clave del proveedor elegido, el bot queda apagado y el chat sigue
  // en modo humano.
  BOT_PROVIDER: z.enum(['anthropic', 'openai']).default('openai'),
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  // Opcional: por defecto el modelo economico del proveedor elegido.
  BOT_MODEL: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

const envSchemaChecked = envSchema.refine(
  (e) => e.CRYPTO_PROVIDER !== 'local' || (e.CRYPTO_LOCAL_KEY_BASE64 ?? '').length > 0,
  { message: 'CRYPTO_LOCAL_KEY_BASE64 es obligatoria con CRYPTO_PROVIDER=local' },
);

/**
 * Valida el entorno al arranque. Si falta o es invalida alguna variable,
 * lanza con el detalle de todas las fallas: la app NO debe arrancar
 * con configuracion incompleta (docs/plan/11 §6).
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchemaChecked.safeParse(source);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(
      `Configuracion de entorno invalida o incompleta (ver .env.local.example):\n${detail}`,
    );
  }
  return parsed.data;
}
