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
  DATABASE_URL: z.string().min(1),

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

  // SMTP saliente: Mailpit en local, el SMTP del tenant en produccion.
  SMTP_HOST: z.string().min(1),

  // WhatsApp Cloud API: servidor falso en local, Graph API en produccion.
  WHATSAPP_API_URL: z.url(),

  // InvoicingProvider: fake en local; sandbox o proveedor real despues.
  INVOICING_PROVIDER: z.string().min(1),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Valida el entorno al arranque. Si falta o es invalida alguna variable,
 * lanza con el detalle de todas las fallas: la app NO debe arrancar
 * con configuracion incompleta (docs/plan/11 §6).
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
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
