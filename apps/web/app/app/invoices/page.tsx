'use client';

import { useCallback, useEffect, useState } from 'react';

import { api } from '../../../lib/api';
import { ErrorNote, Field, buttonClass, buttonGhost, dt, inputClass, money } from '../../../lib/ui';

interface Invoice {
  id: string;
  status: string;
  docNumber: string | null;
  establishment: string | null;
  expeditionPoint: string | null;
  total: string;
  createdAt: string;
  customer: { firstName: string; lastName: string | null };
}
interface Option {
  id: string;
  name?: string;
  firstName?: string;
  lastName?: string | null;
}

export default function InvoicesPage() {
  const [rows, setRows] = useState<Invoice[]>([]);
  const [customers, setCustomers] = useState<Option[]>([]);
  const [services, setServices] = useState<Option[]>([]);
  const [branches, setBranches] = useState<Option[]>([]);
  const [form, setForm] = useState({ customer_id: '', service_id: '' });
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    void api<Invoice[]>('/invoices').then(setRows).catch((e) => setError(String(e.message)));
  }, []);
  useEffect(() => {
    load();
    void api<{ data: Option[] }>('/customers').then((r) => setCustomers(r.data)).catch(() => undefined);
    void api<Option[]>('/catalog/services').then(setServices).catch(() => undefined);
    void api<Option[]>('/branches').then(setBranches).catch(() => undefined);
  }, [load]);

  async function createDraft(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api('/invoices', {
        method: 'POST',
        json: {
          customer_id: form.customer_id,
          branch_id: branches[0]?.id,
          items: [{ service_id: form.service_id, quantity: 1 }],
        },
      });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  }

  async function issue(id: string) {
    setError(null);
    try {
      await api(`/invoices/${id}/issue`, { method: 'POST', json: {} });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  }

  async function cancel(id: string) {
    const reason = prompt('Motivo de anulacion (obligatorio):');
    if (!reason) return;
    try {
      await api(`/invoices/${id}/cancel`, { method: 'POST', json: { reason } });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  }

  async function pay(inv: Invoice) {
    const amount = prompt('Monto del pago (Gs):', inv.total);
    if (!amount) return;
    try {
      await api(`/invoices/${inv.id}/payments`, { method: 'POST', json: { method: 'efectivo', amount } });
      load();
      alert('Pago registrado');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  }

  const badge = (s: string) =>
    s === 'approved'
      ? 'bg-emerald-100 text-emerald-700'
      : s === 'draft'
        ? 'bg-slate-100 text-slate-600'
        : s === 'cancelled' || s === 'rejected'
          ? 'bg-red-100 text-red-700'
          : 'bg-amber-100 text-amber-700';

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold">Facturas</h1>
      <p className="text-xs text-slate-500">
        Emision con proveedor SIFEN de laboratorio (fake): aprueba al instante con CDC sintetico.
        Configura timbrado/establecimiento/punto en Ajustes antes de emitir.
      </p>
      <ErrorNote error={error} />

      <form className="grid grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-white p-4 md:grid-cols-3" onSubmit={(e) => void createDraft(e)}>
        <Field label="Cliente">
          <select className={inputClass} value={form.customer_id} onChange={(e) => setForm({ ...form, customer_id: e.target.value })} required>
            <option value="">Elegir…</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.firstName} {c.lastName}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Servicio">
          <select className={inputClass} value={form.service_id} onChange={(e) => setForm({ ...form, service_id: e.target.value })} required>
            <option value="">Elegir…</option>
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="flex items-end">
          <button className={buttonClass}>Crear borrador</button>
        </div>
      </form>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="text-left text-slate-500">
            <tr>
              <th className="p-2">Numero</th>
              <th>Cliente</th>
              <th>Total</th>
              <th>Estado</th>
              <th>Fecha</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((i) => (
              <tr key={i.id} className="border-t border-slate-100">
                <td className="p-2 font-mono text-xs">
                  {i.docNumber ? `${i.establishment}-${i.expeditionPoint}-${i.docNumber}` : 'borrador'}
                </td>
                <td>
                  {i.customer.firstName} {i.customer.lastName}
                </td>
                <td>{money(i.total)}</td>
                <td>
                  <span className={`rounded px-2 py-0.5 text-xs ${badge(i.status)}`}>{i.status}</span>
                </td>
                <td>{dt(i.createdAt)}</td>
                <td className="space-x-1 p-2 text-right">
                  {i.status === 'draft' && (
                    <button className={buttonGhost} onClick={() => void issue(i.id)}>
                      Emitir
                    </button>
                  )}
                  {i.status === 'approved' && (
                    <>
                      <button className={buttonGhost} onClick={() => void pay(i)}>
                        Registrar pago
                      </button>
                      <button className={buttonGhost} onClick={() => void cancel(i.id)}>
                        Anular
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
