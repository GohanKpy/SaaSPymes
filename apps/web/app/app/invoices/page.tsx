'use client';

import { useCallback, useEffect, useState } from 'react';

import { API_URL, api, getToken } from '../../../lib/api';
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
  payments: { amount: string }[];
}

const pagado = (i: Invoice) => i.payments.reduce((s, p) => s + Number(p.amount), 0);
const saldo = (i: Invoice) => Number(i.total) - pagado(i);
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

  // El PDF exige el Bearer token: se baja como blob y se abre en otra pestana.
  async function openKude(id: string) {
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/v1/invoices/${id}/kude`, {
        headers: { Authorization: `Bearer ${getToken() ?? ''}` },
      });
      if (!res.ok) throw new Error('No se pudo generar el KuDE');
      const url = URL.createObjectURL(await res.blob());
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
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

  // Popup de pago: forma de pago + monto recibido con calculo de vuelto.
  const [paying, setPaying] = useState<Invoice | null>(null);
  const [payForm, setPayForm] = useState({ method: 'efectivo', recibido: '' });

  function openPay(inv: Invoice) {
    setPaying(inv);
    setPayForm({ method: 'efectivo', recibido: String(saldo(inv)) });
  }

  async function confirmPay() {
    if (!paying) return;
    const debido = saldo(paying);
    const recibido = Number(payForm.recibido || 0);
    // Se registra lo adeudado (o menos si es un pago parcial); el excedente
    // en efectivo es vuelto, no ingresa como pago.
    const amount = Math.min(recibido, debido);
    if (amount <= 0) return;
    try {
      await api(`/invoices/${paying.id}/payments`, {
        method: 'POST',
        json: { method: payForm.method, amount: String(amount) },
      });
      setPaying(null);
      load();
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

  const vuelto = paying ? Math.max(0, Number(payForm.recibido || 0) - saldo(paying)) : 0;
  const parcial = paying ? Math.max(0, saldo(paying) - Number(payForm.recibido || 0)) : 0;

  return (
    <div className="space-y-5">
      {paying && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm space-y-3 rounded-lg bg-white p-5 shadow-xl">
            <h3 className="font-semibold">Registrar pago</h3>
            <p className="text-sm text-slate-600">
              Factura {paying.establishment}-{paying.expeditionPoint}-{paying.docNumber} ·{' '}
              {paying.customer.firstName} {paying.customer.lastName}
              <br />
              Saldo a cobrar: <b>{money(saldo(paying))}</b>
            </p>
            <Field label="Forma de pago">
              <select className={inputClass} value={payForm.method} onChange={(e) => setPayForm({ ...payForm, method: e.target.value })}>
                <option value="efectivo">Efectivo</option>
                <option value="transferencia">Transferencia</option>
                <option value="tarjeta">Tarjeta</option>
                <option value="qr">QR</option>
                <option value="otro">Otro</option>
              </select>
            </Field>
            <Field label="Monto recibido (Gs)">
              <input
                className={inputClass}
                type="number"
                min={0}
                step={1000}
                value={payForm.recibido}
                onChange={(e) => setPayForm({ ...payForm, recibido: e.target.value })}
              />
            </Field>
            {vuelto > 0 && (
              <p className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-800">
                Vuelto a entregar: <b>{money(vuelto)}</b>
              </p>
            )}
            {parcial > 0 && (
              <p className="rounded bg-sky-50 px-3 py-2 text-sm text-sky-800">
                Pago parcial: quedara un saldo de <b>{money(parcial)}</b>
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button className={buttonGhost} onClick={() => setPaying(null)}>
                Cancelar
              </button>
              <button className={buttonClass} disabled={Number(payForm.recibido || 0) <= 0} onClick={() => void confirmPay()}>
                Confirmar pago
              </button>
            </div>
          </div>
        </div>
      )}
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
                  {i.status === 'approved' && saldo(i) > 0 && (
                    <button className={buttonGhost} onClick={() => openPay(i)}>
                      Registrar pago
                    </button>
                  )}
                  {i.status === 'approved' && (
                    <button className={buttonGhost} onClick={() => void cancel(i.id)}>
                      Anular
                    </button>
                  )}
                  {(i.status === 'approved' ? saldo(i) <= 0 : ['cancelled', 'credited'].includes(i.status)) && (
                    <button className={buttonGhost} onClick={() => void openKude(i.id)}>
                      KuDE (PDF)
                    </button>
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
