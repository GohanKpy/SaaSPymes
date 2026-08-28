'use client';

import { useCallback, useEffect, useState } from 'react';

import { API_URL, api, getToken } from '../../../lib/api';
import { Field, buttonClass, buttonGhost, dt, inputClass, money } from '../../../lib/ui';

interface Quote {
  id: string;
  number: number;
  status: string;
  total: string;
  validUntil: string | null;
  createdAt: string;
  invoiceId: string | null;
  customer: { firstName: string; lastName: string | null };
}
interface Option {
  id: string;
  name?: string;
  price?: string;
  firstName?: string;
  lastName?: string | null;
}
interface Line {
  service_id: string;
  description: string;
  quantity: string;
  unit_price: string;
}

const EMPTY_LINE: Line = { service_id: '', description: '', quantity: '1', unit_price: '' };

const STATUS_LABEL: Record<string, string> = {
  draft: 'borrador',
  sent: 'enviado',
  accepted: 'aceptado',
  rejected: 'rechazado',
  invoiced: 'facturado',
};

/** Presupuestos formales (P1): cotiza, manda el PDF y convierte en factura. */
export function QuotesSection({
  customers,
  services,
  branchId,
  onError,
  onInvoiced,
}: {
  customers: Option[];
  services: Option[];
  branchId: string | undefined;
  onError: (msg: string) => void;
  onInvoiced: () => void;
}) {
  const [rows, setRows] = useState<Quote[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<Line[]>([EMPTY_LINE]);

  const load = useCallback(() => {
    void api<Quote[]>('/quotes').then(setRows).catch(() => undefined);
  }, []);
  useEffect(() => load(), [load]);

  function setLine(i: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const items = lines
      .filter((l) => l.service_id || (l.description.trim() && l.unit_price))
      .map((l) =>
        l.service_id
          ? { service_id: l.service_id, quantity: Number(l.quantity) || 1 }
          : {
              description: l.description.trim(),
              unit_price: l.unit_price,
              quantity: Number(l.quantity) || 1,
            },
      );
    if (items.length === 0) {
      onError('Agrega al menos un item al presupuesto');
      return;
    }
    try {
      await api('/quotes', {
        method: 'POST',
        json: {
          customer_id: customerId,
          branch_id: branchId,
          valid_until: validUntil || undefined,
          notes: notes.trim() || undefined,
          items,
        },
      });
      setCustomerId('');
      setValidUntil('');
      setNotes('');
      setLines([EMPTY_LINE]);
      load();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Error');
    }
  }

  async function setStatus(q: Quote, status: string) {
    try {
      await api(`/quotes/${q.id}`, { method: 'PATCH', json: { status } });
      load();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Error');
    }
  }

  async function convert(q: Quote) {
    if (!confirm(`¿Convertir el presupuesto P-${String(q.number).padStart(4, '0')} en factura?`)) return;
    try {
      await api(`/quotes/${q.id}/invoice`, { method: 'POST', json: {} });
      load();
      onInvoiced();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Error');
    }
  }

  async function remove(q: Quote) {
    if (!confirm('¿Borrar este borrador de presupuesto?')) return;
    try {
      await api(`/quotes/${q.id}`, { method: 'DELETE' });
      load();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Error');
    }
  }

  // El PDF exige el Bearer token: blob + pestana nueva (mismo camino que el KuDE).
  async function openPdf(q: Quote) {
    try {
      const res = await fetch(`${API_URL}/api/v1/quotes/${q.id}/pdf`, {
        headers: { Authorization: `Bearer ${getToken() ?? ''}` },
      });
      if (!res.ok) throw new Error('No se pudo generar el PDF');
      const url = URL.createObjectURL(await res.blob());
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Error');
    }
  }

  const badge = (s: string) =>
    s === 'accepted' || s === 'invoiced'
      ? 'bg-emerald-100 text-emerald-700'
      : s === 'rejected'
        ? 'bg-red-100 text-red-700'
        : s === 'sent'
          ? 'bg-amber-100 text-amber-700'
          : 'bg-slate-100 text-slate-600';

  const vencido = (q: Quote) =>
    q.validUntil && !['invoiced', 'rejected'].includes(q.status) && new Date(q.validUntil) < new Date();

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">Presupuestos</h2>
      <p className="text-xs text-slate-500">
        Cotiza sin compromiso fiscal: arma el presupuesto, descargalo en PDF para mandarlo al
        cliente y, si lo acepta, convertilo en factura con un clic.
      </p>

      <form className="space-y-3 rounded-lg border border-slate-200 bg-white p-4" onSubmit={(e) => void create(e)}>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Field label="Cliente">
            <select className={inputClass} value={customerId} onChange={(e) => setCustomerId(e.target.value)} required>
              <option value="">Elegir…</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.firstName} {c.lastName}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Valido hasta (opcional)">
            <input className={inputClass} type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
          </Field>
          <div className="col-span-2">
            <Field label="Observaciones (salen en el PDF)">
              <input className={inputClass} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
          </div>
        </div>

        <div className="space-y-2">
          {lines.map((l, i) => (
            <div key={i} className="flex flex-wrap items-end gap-2">
              <div className="min-w-[220px] flex-1">
                <Field label={i === 0 ? 'Item (del catalogo o libre)' : ''}>
                  <select className={inputClass} value={l.service_id} onChange={(e) => setLine(i, { service_id: e.target.value })}>
                    <option value="">— item libre —</option>
                    {services.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({money(s.price ?? 0)})
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              {!l.service_id && (
                <>
                  <div className="min-w-[180px] flex-1">
                    <Field label={i === 0 ? 'Descripcion' : ''}>
                      <input className={inputClass} value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} />
                    </Field>
                  </div>
                  <Field label={i === 0 ? 'Precio (Gs)' : ''}>
                    <input className={`${inputClass} w-28`} value={l.unit_price} onChange={(e) => setLine(i, { unit_price: e.target.value })} />
                  </Field>
                </>
              )}
              <Field label={i === 0 ? 'Cant.' : ''}>
                <input className={`${inputClass} w-20`} type="number" min="0.5" step="0.5" value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} />
              </Field>
              {lines.length > 1 && (
                <button type="button" className={buttonGhost} onClick={() => setLines((prev) => prev.filter((_, idx) => idx !== i))}>
                  ×
                </button>
              )}
            </div>
          ))}
          <button type="button" className={buttonGhost} onClick={() => setLines((prev) => [...prev, EMPTY_LINE])}>
            + otra linea
          </button>
        </div>

        <button className={buttonClass}>Crear presupuesto</button>
      </form>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="text-left text-slate-500">
            <tr>
              <th className="p-2">Numero</th>
              <th>Cliente</th>
              <th>Total</th>
              <th>Estado</th>
              <th>Valido hasta</th>
              <th>Fecha</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((q) => (
              <tr key={q.id} className="border-t border-slate-100">
                <td className="p-2 font-mono text-xs">P-{String(q.number).padStart(4, '0')}</td>
                <td>
                  {q.customer.firstName} {q.customer.lastName}
                </td>
                <td>{money(q.total)}</td>
                <td>
                  <span className={`rounded px-2 py-0.5 text-xs ${badge(q.status)}`}>
                    {STATUS_LABEL[q.status] ?? q.status}
                  </span>
                  {vencido(q) && <span className="ml-1 text-xs font-medium text-red-600">vencido</span>}
                </td>
                <td>{q.validUntil ? new Date(q.validUntil).toLocaleDateString('es-PY', { timeZone: 'UTC' }) : '—'}</td>
                <td>{dt(q.createdAt)}</td>
                <td className="space-x-1 p-2 text-right">
                  <button className={buttonGhost} onClick={() => void openPdf(q)}>
                    PDF
                  </button>
                  {q.status === 'draft' && (
                    <button className={buttonGhost} onClick={() => void setStatus(q, 'sent')}>
                      Marcar enviado
                    </button>
                  )}
                  {q.status === 'sent' && (
                    <>
                      <button className={buttonGhost} onClick={() => void setStatus(q, 'accepted')}>
                        Aceptado
                      </button>
                      <button className={buttonGhost} onClick={() => void setStatus(q, 'rejected')}>
                        Rechazado
                      </button>
                    </>
                  )}
                  {['draft', 'sent', 'accepted'].includes(q.status) && (
                    <button className={buttonClass} onClick={() => void convert(q)}>
                      Facturar
                    </button>
                  )}
                  {q.status === 'draft' && (
                    <button
                      className="rounded border border-red-200 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50"
                      onClick={() => void remove(q)}
                    >
                      Borrar
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="p-4 text-center text-slate-400">
                  Sin presupuestos todavia
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
