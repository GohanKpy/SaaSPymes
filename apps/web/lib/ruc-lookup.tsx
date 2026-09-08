'use client';

import { useEffect, useRef, useState } from 'react';

import { api } from './api';
import { Badge, type BadgeTone } from './ui';

// Padron RUC de la DNIT (ADR 0012, pedido de Johan 2026-09-08): al tipear un
// RUC en clientes o facturas se consulta la copia local del padron y se
// completan razon social y DV. Igual que en Unbox: debounce, se descartan las
// respuestas viejas, el DV oficial siempre manda y la razon social se pisa
// solo si el campo esta vacio o tiene lo que el sistema completo antes.

export interface RucLookup {
  found: boolean;
  ruc: string;
  dv: string | null;
  razon_social: string | null;
  estado: string | null;
  ruc_anterior: string | null;
}

const DEBOUNCE_MS = 500;
const MIN_DIGITS = 5;

/** '80.012.345-6' -> '80012345' (sin DV); '' si todavia no hay algo consultable. */
export function rucConsultable(input: string): string {
  const base = (input.split('-')[0] ?? '').replace(/[^0-9a-zA-Z]/g, '').toUpperCase();
  return base.length >= MIN_DIGITS && /^\d{3,8}[A-Z]?$/.test(base) ? base : '';
}

/** Consulta el padron con debounce mientras se tipea. `enabled` = false apaga la consulta (documento que no es RUC). */
export function useRucLookup(
  input: string,
  enabled = true,
): { data: RucLookup | null; loading: boolean } {
  const [data, setData] = useState<RucLookup | null>(null);
  const [loading, setLoading] = useState(false);
  const ruc = enabled ? rucConsultable(input) : '';
  const ultimo = useRef<string>('');

  useEffect(() => {
    if (!ruc) {
      ultimo.current = '';
      setData(null);
      setLoading(false);
      return;
    }
    if (ruc === ultimo.current) return;
    setLoading(true);
    const t = setTimeout(() => {
      ultimo.current = ruc;
      api<RucLookup>(`/ruc/${encodeURIComponent(ruc)}`)
        .then((r) => {
          if (ultimo.current === ruc) setData(r);
        })
        .catch(() => {
          if (ultimo.current === ruc) setData(null);
        })
        .finally(() => {
          if (ultimo.current === ruc) setLoading(false);
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [ruc]);

  return { data: ruc ? data : null, loading: Boolean(ruc) && loading };
}

/**
 * Autocompletado: consulta el padron y, cuando encuentra el RUC, llama a
 * `onFill` con razon social y DV oficiales. La razon social solo se pisa si
 * el campo esta vacio o tiene lo que este mismo hook completo antes; si el
 * usuario escribio otra cosa, `sugerencia` trae el nombre del padron para
 * que el formulario ofrezca "usar".
 */
export function useRucAutofill(opts: {
  ruc: string;
  enabled: boolean;
  legalName: string;
  onFill: (patch: { legal_name: string; ruc_dv: string }) => void;
}): {
  lookup: RucLookup | null;
  loading: boolean;
  sugerencia: string | null;
  usarSugerencia: () => void;
} {
  const { data, loading } = useRucLookup(opts.ruc, opts.enabled);
  const completado = useRef<string>('');
  const onFill = useRef(opts.onFill);
  onFill.current = opts.onFill;
  const legalName = opts.legalName.trim();

  useEffect(() => {
    if (!data?.found || !data.razon_social) return;
    const actual = legalName;
    if (
      actual === '' ||
      actual === completado.current ||
      actual.toUpperCase() === data.razon_social.toUpperCase()
    ) {
      completado.current = data.razon_social;
      onFill.current({ legal_name: data.razon_social, ruc_dv: data.dv ?? '' });
    }
    // Solo cuando llega una respuesta nueva: el nombre se lee en ese momento.
  }, [data]);

  const distinto = Boolean(
    data?.found &&
    data.razon_social &&
    legalName &&
    legalName.toUpperCase() !== data.razon_social.toUpperCase(),
  );
  return {
    lookup: data,
    loading,
    sugerencia: distinto ? data!.razon_social : null,
    usarSugerencia: () => {
      if (!data?.razon_social) return;
      completado.current = data.razon_social;
      onFill.current({ legal_name: data.razon_social, ruc_dv: data.dv ?? '' });
    },
  };
}

export const ESTADO_RUC: Record<string, { label: string; tone: BadgeTone }> = {
  ACTIVO: { label: 'Activo en la DNIT', tone: 'emerald' },
  'SUSPENSION TEMPORAL': { label: 'Suspensión temporal', tone: 'amber' },
  BLOQUEADO: { label: 'Bloqueado en la DNIT', tone: 'red' },
  CANCELADO: { label: 'RUC cancelado', tone: 'red' },
  'CANCELADO DEFINITIVO': { label: 'Cancelado definitivo', tone: 'red' },
};

/** Estado del RUC segun el padron: verde si esta activo, aviso si no; nada si todavia no se consulto. */
export function RucEstado({
  lookup,
  loading,
  sugerencia,
  onUsar,
}: {
  lookup: RucLookup | null;
  loading: boolean;
  sugerencia?: string | null;
  onUsar?: () => void;
}) {
  if (loading)
    return <span className="text-xs text-slate-400">Buscando en el padrón de la DNIT…</span>;
  if (!lookup) return null;
  if (!lookup.found) return <Badge tone="slate">No figura en el padrón de la DNIT</Badge>;
  const estado = ESTADO_RUC[lookup.estado ?? ''] ?? {
    label: lookup.estado ?? 'Estado desconocido',
    tone: 'amber' as BadgeTone,
  };
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Badge tone={estado.tone}>{estado.label}</Badge>
      {sugerencia && onUsar && (
        <span className="text-xs text-slate-600">
          El padrón dice «{sugerencia}».{' '}
          <button type="button" className="font-medium text-sky-700 underline" onClick={onUsar}>
            Usar ese nombre
          </button>
        </span>
      )}
    </span>
  );
}
