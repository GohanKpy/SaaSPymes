'use client';

import { useEffect, useState } from 'react';

import { api } from './api';

/** Lo que el panel necesita saber del negocio logueado (GET /tenant). */
export interface TenantInfo {
  id: string;
  legalName: string;
  tradeName: string | null;
  timezone: string;
  /** Cuenta en desarrollo (check DEV en el portal admin, 2026-09-08): comprobantes simulados. */
  devMode: boolean;
  currentPlan: { code: string; name: string } | null;
}

/**
 * Datos del negocio; devMode vale false hasta que carga. `enabled` = false
 * pospone la consulta (el layout la hace recien con la sesion lista: antes
 * daba un 401 en consola y un refresh de mas).
 */
export function useTenantInfo(enabled = true): { tenant: TenantInfo | null; devMode: boolean } {
  const [tenant, setTenant] = useState<TenantInfo | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    api<TenantInfo>('/tenant')
      .then((t) => {
        if (alive) setTenant(t);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [enabled]);
  return { tenant, devMode: tenant?.devMode ?? false };
}
