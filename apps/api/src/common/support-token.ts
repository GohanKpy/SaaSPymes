import { createHash } from 'node:crypto';

// Token de soporte (2026-09-22, ADR 0014): el cliente lo genera y se lo da
// al soporte. Se guarda hasheado con el id del negocio como sal; el valor
// solo se muestra al generarlo.

/** Token inicial provisorio para todos los clientes (decision de Johan 2026-09-22). */
export const INITIAL_SUPPORT_TOKEN = '1111';

export function hashSupportToken(tenantId: string, token: string): string {
  return createHash('sha256').update(`${tenantId}:${token.trim()}`).digest('hex');
}

export function vistaToken(
  tenantId: string,
  t: { supportTokenHash: string | null; supportTokenExpiresAt: Date | null; supportTokenCreatedAt: Date | null } | null,
) {
  const vencido = Boolean(t?.supportTokenExpiresAt && t.supportTokenExpiresAt.getTime() < Date.now());
  return {
    active: Boolean(t?.supportTokenHash) && !vencido,
    expired: vencido,
    is_initial: Boolean(t?.supportTokenHash) && t?.supportTokenHash === hashSupportToken(tenantId, INITIAL_SUPPORT_TOKEN),
    expires_at: t?.supportTokenExpiresAt?.toISOString() ?? null,
    created_at: t?.supportTokenCreatedAt?.toISOString() ?? null,
  };
}
