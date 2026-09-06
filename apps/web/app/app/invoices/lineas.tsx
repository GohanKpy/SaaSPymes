'use client';

import { Field, buttonGhost, inputClass, money } from '../../../lib/ui';

// Constructor de lineas compartido por facturas y presupuestos (fase 2
// auditoria de paneles 2026-09-05): antes la factura solo aceptaba un item
// con cantidad 1 aunque el servidor ya soportaba varios, y el total con IVA
// no se veia hasta guardar.

export interface ServicioOption {
  id: string;
  name: string;
  price: string;
  taxRate?: number;
  kind?: string;
}

export interface Linea {
  service_id: string;
  description: string;
  quantity: string;
  unit_price: string;
  tax_rate: '10' | '5' | '0';
}

export const LINEA_VACIA: Linea = { service_id: '', description: '', quantity: '1', unit_price: '', tax_rate: '10' };

/** Precio unitario efectivo de la linea (del catalogo o libre). */
export function precioLinea(l: Linea, services: ServicioOption[]): number {
  if (l.service_id) return Number(services.find((s) => s.id === l.service_id)?.price ?? 0);
  return Number(String(l.unit_price).replace(/\./g, '')) || 0;
}

export function ivaLinea(l: Linea, services: ServicioOption[]): number {
  const s = l.service_id ? services.find((x) => x.id === l.service_id) : undefined;
  return s?.taxRate ?? Number(l.tax_rate);
}

/** Totales en vivo. Los precios en Paraguay incluyen el IVA: se desglosa, no se suma. */
export function totales(lines: Linea[], services: ServicioOption[]) {
  let total = 0;
  let iva = 0;
  for (const l of lines) {
    const qty = Number(l.quantity) || 0;
    const sub = precioLinea(l, services) * qty;
    const rate = ivaLinea(l, services);
    total += sub;
    if (rate > 0) iva += (sub * rate) / (100 + rate);
  }
  return { total: Math.round(total), iva: Math.round(iva) };
}

/** Convierte las lineas al payload que espera el servidor (que recalcula todo igual). */
export function aItems(lines: Linea[]) {
  return lines
    .filter((l) => l.service_id || (l.description.trim() && l.unit_price))
    .map((l) =>
      l.service_id
        ? { service_id: l.service_id, quantity: Number(l.quantity) || 1 }
        : {
            description: l.description.trim(),
            unit_price: String(l.unit_price).replace(/\./g, ''),
            quantity: Number(l.quantity) || 1,
            tax_rate: Number(l.tax_rate),
          },
    );
}

export function LineasEditor({
  lines,
  services,
  onChange,
}: {
  lines: Linea[];
  services: ServicioOption[];
  onChange: (lines: Linea[]) => void;
}) {
  const set = (i: number, patch: Partial<Linea>) => onChange(lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const { total, iva } = totales(lines, services);

  return (
    <div className="space-y-2">
      {lines.map((l, i) => {
        const sub = precioLinea(l, services) * (Number(l.quantity) || 0);
        return (
          <div key={i} className="flex flex-wrap items-end gap-2 rounded-md border border-slate-100 bg-slate-50/50 p-2">
            <div className="min-w-[220px] flex-1">
              <Field label={i === 0 ? 'Ítem (del catálogo o libre)' : ''}>
                <select className={inputClass} value={l.service_id} onChange={(e) => set(i, { service_id: e.target.value })}>
                  <option value="">— ítem libre (escribí abajo) —</option>
                  {services.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({money(s.price)})
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            {!l.service_id && (
              <>
                <div className="min-w-[180px] flex-1">
                  <Field label={i === 0 ? 'Descripción' : ''}>
                    <input className={inputClass} placeholder="Ej: Shampoo 500 ml" value={l.description} onChange={(e) => set(i, { description: e.target.value })} />
                  </Field>
                </div>
                <Field label={i === 0 ? 'Precio (Gs)' : ''}>
                  <input className={`${inputClass} w-28`} inputMode="numeric" placeholder="50000" value={l.unit_price} onChange={(e) => set(i, { unit_price: e.target.value })} />
                </Field>
                <Field label={i === 0 ? 'IVA' : ''}>
                  <select className={`${inputClass} w-24`} value={l.tax_rate} onChange={(e) => set(i, { tax_rate: e.target.value as Linea['tax_rate'] })}>
                    <option value="10">10%</option>
                    <option value="5">5%</option>
                    <option value="0">Exento</option>
                  </select>
                </Field>
              </>
            )}
            <Field label={i === 0 ? 'Cant.' : ''}>
              <input className={`${inputClass} w-20`} type="number" min="0.5" step="0.5" value={l.quantity} onChange={(e) => set(i, { quantity: e.target.value })} />
            </Field>
            <div className="w-28 pb-2 text-right text-sm tabular-nums text-slate-700">{sub > 0 ? money(sub) : <span className="text-slate-300">—</span>}</div>
            <button
              type="button"
              className={`${buttonGhost} px-2`}
              aria-label="Quitar línea"
              disabled={lines.length === 1}
              onClick={() => onChange(lines.filter((_, idx) => idx !== i))}
            >
              ×
            </button>
          </div>
        );
      })}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" className={buttonGhost} onClick={() => onChange([...lines, LINEA_VACIA])}>
          + Otra línea
        </button>
        <p className="text-sm">
          <span className="text-slate-500">IVA incluido {money(iva)} · </span>
          <b>Total {money(total)}</b>
        </p>
      </div>
    </div>
  );
}
