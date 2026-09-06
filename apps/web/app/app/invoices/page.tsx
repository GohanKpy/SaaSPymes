'use client';

import { useCallback, useEffect, useState } from 'react';

import { API_URL, api, getToken } from '../../../lib/api';
import { useAskText, useToast } from '../../../lib/feedback';
import { errorMessage } from '../../../lib/labels';
import {
  Badge,
  Card,
  EmptyRow,
  ErrorNote,
  Field,
  PageHeader,
  buttonClass,
  buttonDanger,
  buttonGhost,
  buttonSoft,
  dt,
  inputClass,
  money,
  tableCard,
  type BadgeTone,
} from '../../../lib/ui';

import { QuotesSection } from './quotes';

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
  const askText = useAskText();
  const toast = useToast();
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
    const reason = await askText({
      title: 'Anular factura',
      message: 'La anulación queda registrada y no se puede deshacer. Solo se puede anular dentro de las 48 horas de emitida.',
      label: 'Motivo de la anulación',
      placeholder: 'Ej: error en el cliente facturado',
      confirmLabel: 'Anular factura',
    });
    if (!reason) return;
    try {
      await api(`/invoices/${id}/cancel`, { method: 'POST', json: { reason } });
      toast.success('Factura anulada');
      load();
    } catch (e) {
      toast.error(errorMessage(e));
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

  const STATUS: Record<string, { label: string; tone: BadgeTone }> = {
    draft: { label: 'borrador', tone: 'slate' },
    approved: { label: 'aprobada', tone: 'emerald' },
    cancelled: { label: 'anulada', tone: 'red' },
    rejected: { label: 'rechazada', tone: 'red' },
    credited: { label: 'acreditada', tone: 'sky' },
  };

  const vuelto = paying ? Math.max(0, Number(payForm.recibido || 0) - saldo(paying)) : 0;
  const parcial = paying ? Math.max(0, saldo(paying) - Number(payForm.recibido || 0)) : 0;

  return (
    <div className="space-y-5">
      {paying && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm space-y-3 rounded-xl bg-white p-5 shadow-xl">
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
      <PageHeader
        title="Facturas"
        description="Emisión con proveedor SIFEN de laboratorio (fake): aprueba al instante con CDC sintético. Configurá timbrado/establecimiento/punto en Ajustes antes de emitir."
      />
      <ErrorNote error={error} />

      <Card title="Nueva factura">
      <form className="grid grid-cols-2 gap-3 md:grid-cols-3" onSubmit={(e) => void createDraft(e)}>
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
      </Card>

      <div className={tableCard}>
        <table className="tbl">
          <thead>
            <tr>
              <th>Numero</th>
              <th>Cliente</th>
              <th className="text-right">Total</th>
              <th>Estado</th>
              <th>Fecha</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((i) => (
              <tr key={i.id} className="hover:bg-slate-50">
                <td className="font-mono text-xs">
                  {i.docNumber ? `${i.establishment}-${i.expeditionPoint}-${i.docNumber}` : 'borrador'}
                </td>
                <td>
                  {i.customer.firstName} {i.customer.lastName}
                </td>
                <td className="text-right tabular-nums">{money(i.total)}</td>
                <td>
                  <span className="inline-flex items-center gap-1.5">
                    <Badge tone={STATUS[i.status]?.tone ?? 'amber'}>{STATUS[i.status]?.label ?? i.status}</Badge>
                    {i.status === 'approved' && saldo(i) > 0 && <Badge tone="amber">saldo {money(saldo(i))}</Badge>}
                  </span>
                </td>
                <td>{dt(i.createdAt)}</td>
                <td className="text-right">
                  <span className="inline-flex gap-1">
                    {i.status === 'draft' && (
                      <button className={buttonSoft} onClick={() => void issue(i.id)}>
                        Emitir
                      </button>
                    )}
                    {i.status === 'approved' && saldo(i) > 0 && (
                      <button className={buttonSoft} onClick={() => openPay(i)}>
                        Registrar pago
                      </button>
                    )}
                    {(i.status === 'approved' ? saldo(i) <= 0 : ['cancelled', 'credited'].includes(i.status)) && (
                      <button className={buttonGhost} onClick={() => void openKude(i.id)}>
                        KuDE (PDF)
                      </button>
                    )}
                    {i.status === 'approved' && (
                      <button className={buttonDanger} onClick={() => void cancel(i.id)}>
                        Anular
                      </button>
                    )}
                  </span>
                </td>
              </tr>
            ))}
            {rows.length === 0 && <EmptyRow colSpan={6}>Sin facturas todavía: creá el primer borrador arriba.</EmptyRow>}
          </tbody>
        </table>
      </div>

      <QuotesSection
        customers={customers}
        services={services}
        branchId={branches[0]?.id}
        onError={setError}
        onInvoiced={load}
      />
    </div>
  );
}
