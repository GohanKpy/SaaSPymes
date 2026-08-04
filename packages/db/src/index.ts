// @pymes/db — cliente Prisma, scoping por tenant y helpers de RLS.
// El contrato RLS (doc 03 §1): cada unidad de trabajo abre transaccion y fija
// app.tenant_id con SET LOCAL; sin eso la base no entrega ninguna fila.
import { PrismaClient, Prisma } from '@prisma/client';

export * from '@prisma/client';

export function createPrismaClient(url: string): PrismaClient {
  return new PrismaClient({ datasourceUrl: url });
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
    return fn(tx as TenantTx);
  });
}

export { Prisma };
