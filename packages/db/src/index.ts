// @pymes/db — cliente Prisma, scoping por tenant y helpers de RLS.
// El contrato RLS (doc 03 §1): cada unidad de trabajo abre transaccion y fija
// app.tenant_id con SET LOCAL; sin eso la base no entrega ninguna fila.
import { PrismaClient, Prisma } from '@prisma/client';

export * from '@prisma/client';

/**
 * Cliente Prisma. Las transacciones interactivas (tenantTx) tienen un tope
 * de 20 s (el default de 5 s cortaba la siembra de la suite de aislamiento y
 * dejaria caer una emision de factura si SIFEN tarda).
 */
export function createPrismaClient(url: string): PrismaClient {
  return new PrismaClient({ datasourceUrl: url, transactionOptions: { maxWait: 10_000, timeout: 20_000 } });
}

/** Cliente transaccional dentro de tenantTx (sin $transaction anidado). */
export type TenantTx = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

export interface TenantContext {
  tenantId: string;
  /** app.users.id del actor; alimenta los triggers de auditoria. */
  userId?: string;
  /** user | bot | system | platform (default 'user' en el trigger). */
  actorType?: 'user' | 'bot' | 'system' | 'platform';
  /** Auditoria de seguridad (2026-09-07): desde donde y en que pedido HTTP. */
  ip?: string;
  requestId?: string;
  userAgent?: string;
}

/**
 * Ejecuta `fn` dentro de una transaccion con el contexto RLS fijado via
 * SET LOCAL (set_config(..., true)): expira solo al cerrar la transaccion.
 * TODA lectura/escritura de datos de tenants pasa por aca (doc 05 §2).
 */
export async function tenantTx<T>(
  prisma: PrismaClient,
  ctx: TenantContext,
  fn: (tx: TenantTx) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${ctx.tenantId}, true)`;
    if (ctx.userId) {
      await tx.$executeRaw`SELECT set_config('app.user_id', ${ctx.userId}, true)`;
    }
    if (ctx.actorType) {
      await tx.$executeRaw`SELECT set_config('app.actor_type', ${ctx.actorType}, true)`;
    }
    // Los triggers de auditoria copian esto en cada fila que cambia.
    if (ctx.ip) await tx.$executeRaw`SELECT set_config('app.ip', ${ctx.ip}, true)`;
    if (ctx.requestId) await tx.$executeRaw`SELECT set_config('app.request_id', ${ctx.requestId}, true)`;
    if (ctx.userAgent) await tx.$executeRaw`SELECT set_config('app.user_agent', ${ctx.userAgent.slice(0, 300)}, true)`;
    return fn(tx as TenantTx);
  });
}

export { Prisma };
