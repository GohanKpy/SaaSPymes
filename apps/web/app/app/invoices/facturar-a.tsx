'use client';

import { useEffect, useState } from 'react';

import { api } from '../../../lib/api';
import type { PickedCustomer } from '../../../lib/customer-picker';
import { dvRuc } from '../../../lib/ruc';
import { Field, inputClass } from '../../../lib/ui';

// "Facturar a" (pedido de Johan 2026-09-07): un cliente puede pedir la factura
// a su nombre, a nombre de su empresa o de otra persona, y cada vez a uno
// distinto. Aca se elige entre las identidades guardadas en su ficha, su
// documento propio, o se cargan datos nuevos (que se pueden guardar en la
// ficha). Si el cliente no tiene nada cargado, pide los datos directamente.

export interface FiscalId {
  id: string;
  docType: string;
  docNumber: string;
  rucDv: string | null;
  legalName: string;
  isDefault: boolean;
}

export interface BillingNuevo {
  doc_type: 'ruc' | 'ci' | 'pasaporte';
  doc_number: string;
  ruc_dv: string;
  legal_name: string;
  save_to_customer: boolean;
}

export type BillingChoice =
  | { kind: 'none' }
  | { kind: 'own' }
  | { kind: 'fiscal'; fiscal_id: string }
  | { kind: 'new'; billing: BillingNuevo };

export const DOC_LABEL: Record<string, string> = { ruc: 'RUC', ci: 'CI', pasaporte: 'Pasaporte' };

export const BILLING_NUEVO_VACIO: BillingNuevo = { doc_type: 'ruc', doc_number: '', ruc_dv: '', legal_name: '', save_to_customer: true };

/** Texto "RUC 80012345-7" para mostrar en listas. */
export function documentoTexto(docType: string | null | undefined, docNumber: string | null | undefined, dv: string | null | undefined): string {
  if (!docNumber) return '';
  return `${DOC_LABEL[docType ?? 'ci'] ?? (docType ?? '').toUpperCase()} ${docNumber}${dv ? `-${dv}` : ''}`;
}

/** Datos nuevos completos (documento y nombre). */
function nuevoCompleto(b: BillingNuevo): boolean {
  return b.doc_number.trim().length > 0 && b.legal_name.trim().length > 0;
}

/** Lo que va al servidor segun la eleccion. En modo desarrollo, datos nuevos incompletos = sin receptor. */
export function billingPayload(choice: BillingChoice, devMode = false): Record<string, unknown> {
  if (choice.kind === 'fiscal') return { fiscal_id: choice.fiscal_id };
  if (choice.kind === 'new') {
    const b = choice.billing;
    if (devMode && !nuevoCompleto(b)) return {};
    return {
      billing: {
        doc_type: b.doc_type,
        doc_number: b.doc_number.trim(),
        ...(b.doc_type === 'ruc' && b.ruc_dv ? { ruc_dv: b.ruc_dv } : {}),
        legal_name: b.legal_name.trim(),
        save_to_customer: b.save_to_customer,
      },
    };
  }
  return {};
}

/**
 * Se puede crear/guardar con esta eleccion (los datos nuevos tienen que estar
 * completos). En modo desarrollo (2026-09-08) todo vale: la factura es una
 * simulacion y puede salir sin receptor.
 */
export function billingCompleto(choice: BillingChoice, devMode = false): boolean {
  if (devMode) return true;
  if (choice.kind === 'none') return false;
  if (choice.kind === 'new') return nuevoCompleto(choice.billing);
  return true;
}

interface CustomerFiscal {
  id: string;
  firstName: string;
  lastName: string | null;
  docType: string | null;
  docNumber: string | null;
  rucDv: string | null;
  fiscalIds?: FiscalId[];
}

export function FacturarA({
  customer,
  value,
  onChange,
  devMode = false,
}: {
  customer: PickedCustomer | { id: string } | null;
  value: BillingChoice;
  onChange: (choice: BillingChoice) => void;
  /** Cuenta en desarrollo: los datos del receptor son opcionales. */
  devMode?: boolean;
}) {
  const [datos, setDatos] = useState<CustomerFiscal | null>(null);
  const customerId = customer?.id ?? null;

  useEffect(() => {
    setDatos(null);
    if (!customerId) {
      onChange({ kind: 'none' });
      return;
    }
    let alive = true;
    void api<CustomerFiscal>(`/customers/${customerId}`)
      .then((c) => {
        if (!alive) return;
        setDatos(c);
        // Eleccion inicial: la predeterminada de la ficha; si no, su documento; si no, cargar datos.
        const def = (c.fiscalIds ?? []).find((f) => f.isDefault) ?? (c.fiscalIds ?? [])[0];
        if (def) onChange({ kind: 'fiscal', fiscal_id: def.id });
        else if (c.docNumber) onChange({ kind: 'own' });
        else onChange({ kind: 'new', billing: { ...BILLING_NUEVO_VACIO, legal_name: `${c.firstName} ${c.lastName ?? ''}`.trim() } });
      })
      .catch(() => {
        if (alive) onChange({ kind: 'new', billing: BILLING_NUEVO_VACIO });
      });
    return () => {
      alive = false;
    };
  }, [customerId]);

  if (!customerId) return null;
  if (!datos) return <p className="text-xs text-slate-400">Buscando a nombre de quién factura…</p>;

  const guardadas = datos.fiscalIds ?? [];
  const propioYaGuardado = datos.docNumber ? guardadas.some((f) => f.docNumber === datos.docNumber && f.docType === (datos.docType ?? 'ci')) : true;
  const opciones = guardadas.length + (datos.docNumber && !propioYaGuardado ? 1 : 0);
  const nombreCliente = `${datos.firstName} ${datos.lastName ?? ''}`.trim();
  const nuevo = value.kind === 'new' ? value.billing : null;

  const setNuevo = (patch: Partial<BillingNuevo>) => {
    const base = nuevo ?? { ...BILLING_NUEVO_VACIO, legal_name: nombreCliente };
    const b = { ...base, ...patch };
    if (b.doc_type === 'ruc') b.ruc_dv = dvRuc(b.doc_number) ?? '';
    else b.ruc_dv = '';
    onChange({ kind: 'new', billing: b });
  };

  return (
    <div className="rounded-md border border-slate-200 bg-slate-50/60 p-3">
      <p className="text-sm font-medium text-slate-700">Facturar a{devMode ? '' : ' *'}</p>
      {opciones === 0 && devMode ? (
        <p className="mt-0.5 text-xs text-violet-700">
          Modo desarrollo: este cliente no tiene RUC ni razón social y la simulación puede salir igual. Si los cargás, se guardan en la ficha.
        </p>
      ) : opciones === 0 ? (
        <p className="mt-0.5 text-xs text-amber-700">Este cliente no tiene RUC ni razón social cargados: completalos acá para poder emitir la factura.</p>
      ) : (
        <p className="mt-0.5 text-xs text-slate-500">A nombre de quién sale la factura. Podés elegir otra persona o empresa en cada factura.</p>
      )}
      <div className="mt-2 space-y-1.5">
        {guardadas.map((f) => (
          <label key={f.id} className="flex cursor-pointer items-center gap-2 text-sm">
            <input type="radio" name="facturar-a" checked={value.kind === 'fiscal' && value.fiscal_id === f.id} onChange={() => onChange({ kind: 'fiscal', fiscal_id: f.id })} />
            <span className="font-medium">{f.legalName}</span>
            <span className="text-xs text-slate-500">{documentoTexto(f.docType, f.docNumber, f.rucDv)}</span>
            {f.isDefault && <span className="text-[10px] uppercase text-emerald-700">predeterminado</span>}
          </label>
        ))}
        {datos.docNumber && !propioYaGuardado && (
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input type="radio" name="facturar-a" checked={value.kind === 'own'} onChange={() => onChange({ kind: 'own' })} />
            <span className="font-medium">{nombreCliente}</span>
            <span className="text-xs text-slate-500">{documentoTexto(datos.docType ?? 'ci', datos.docNumber, datos.rucDv)} (documento de la ficha)</span>
          </label>
        )}
        {opciones > 0 && (
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input type="radio" name="facturar-a" checked={value.kind === 'new'} onChange={() => setNuevo({})} />
            <span>Otra persona o empresa…</span>
          </label>
        )}
      </div>
      {(value.kind === 'new' || opciones === 0) && (
        <div className="mt-3 grid gap-2 sm:grid-cols-[110px_1fr_70px]">
          <Field label="Documento">
            <select className={inputClass} value={nuevo?.doc_type ?? 'ruc'} onChange={(e) => setNuevo({ doc_type: e.target.value as BillingNuevo['doc_type'] })}>
              <option value="ruc">RUC</option>
              <option value="ci">Cédula</option>
              <option value="pasaporte">Pasaporte</option>
            </select>
          </Field>
          <Field label="Número *">
            <input className={inputClass} inputMode="numeric" placeholder={nuevo?.doc_type === 'ruc' ? '80012345 (sin el DV)' : '1234567'} value={nuevo?.doc_number ?? ''} onChange={(e) => setNuevo({ doc_number: e.target.value })} />
          </Field>
          {(nuevo?.doc_type ?? 'ruc') === 'ruc' ? (
            <Field label="DV">
              <input className={`${inputClass} bg-slate-100`} readOnly value={nuevo?.ruc_dv ?? ''} title="Se calcula solo" />
            </Field>
          ) : (
            <span />
          )}
          <div className="sm:col-span-3">
            <Field label="Razón social o nombre completo *">
              <input className={inputClass} placeholder="Ej: Estudio Creativo S.A." value={nuevo?.legal_name ?? ''} onChange={(e) => setNuevo({ legal_name: e.target.value })} />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm sm:col-span-3">
            <input type="checkbox" checked={nuevo?.save_to_customer ?? true} onChange={(e) => setNuevo({ save_to_customer: e.target.checked })} />
            Guardar en la ficha de {nombreCliente} para la próxima vez
          </label>
        </div>
      )}
    </div>
  );
}
