'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

import { api } from '../../../lib/api';
import { customerName } from '../../../lib/customer-picker';
import { useConfirm, useToast } from '../../../lib/feedback';
import { errorMessage } from '../../../lib/labels';
import { useTenantInfo } from '../../../lib/tenant';
import { Badge, Button, EmptyRow, Modal, buttonGhost, buttonSoft, dt, money, tableCard } from '../../../lib/ui';

import { FacturarA, billingCompleto, billingPayload, type BillingChoice } from './facturar-a';

// Cuentas del mes (pedido de Johan 2026-09-07): clientes con cuenta mensual
// que acumulan servicios y compras; aca se ve cuanto deben, se les manda el
// resumen y se factura todo de una vez (emitir + enviar por su canal).

interface Cuenta {
  customer: { id: string; firstName: string; lastName: string | null; phoneE164: string | null; email: string | null; billingMode: string; invoiceChannel: string };
  total: string;
  count: number;
  since: string | null;
}
interface Consumo {
  id: string;
  description: string;
  quantity: string;
  unitPrice: string;
  lineTotal: string;
  chargedOn: string;
  source: string;
  notes: string | null;
}
interface Statement {
  id: string;
  period: string;
  total: string;
  chargesCount: number;
  notifiedCustomerAt: string | null;
  notifiedOwnerAt: string | null;
  createdAt: string;
  customer: { id: string; firstName: string; lastName: string | null; invoiceChannel: string };
  invoice: { id: string; status: string; establishment: string | null; expeditionPoint: string | null; docNumber: string | null; total: string } | null;
}

const CANAL: Record<string, string> = { whatsapp: 'WhatsApp', email: 'email' };
const fecha = (iso: string) => new Date(iso).toLocaleDateString(undefined, { timeZone: 'UTC' });
const periodoLabel = (p: string) => {
  const [y, m] = p.split('-').map(Number);
  return new Date(Date.UTC(y ?? 2026, (m ?? 1) - 1, 1)).toLocaleDateString('es-PY', { timeZone: 'UTC', month: 'long', year: 'numeric' });
};

export function CuentasSection({ onVerFactura }: { onVerFactura: (invoiceId: string) => void }) {
  const toast = useToast();
  const { devMode } = useTenantInfo();
  const confirmar = useConfirm();
  const [cuentas, setCuentas] = useState<Cuenta[] | null>(null);
  const [statements, setStatements] = useState<Statement[]>([]);
  const [detalle, setDetalle] = useState<{ cuenta: Cuenta; consumos: Consumo[] } | null>(null);
  const [facturar, setFacturar] = useState<Cuenta | null>(null);
  const [billing, setBilling] = useState<BillingChoice>({ kind: 'none' });
  const [opciones, setOpciones] = useState({ issue: true, send: true });
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api<Cuenta[]>('/billing/accounts').then(setCuentas).catch((e) => toast.error(errorMessage(e)));
    void api<Statement[]>('/billing/statements').then(setStatements).catch(() => undefined);
  }, []);
  useEffect(() => load(), [load]);

  async function verDetalle(c: Cuenta) {
    try {
      const r = await api<{ charges: Consumo[] }>(`/billing/accounts/${c.customer.id}`);
      setDetalle({ cuenta: c, consumos: r.charges });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  async function anularConsumo(id: string) {
    const ok = await confirmar({ title: 'Anular este consumo', message: 'Se quita de la cuenta del cliente. No se puede deshacer.', confirmLabel: 'Anular' });
    if (!ok) return;
    try {
      await api(`/billing/charges/${id}`, { method: 'DELETE' });
      toast.success('Consumo anulado');
      if (detalle) await verDetalle(detalle.cuenta);
      load();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  /** Lo mismo que hace el cierre automatico, a pedido: resume el mes anterior, avisa y (si esta activado) factura. */
  async function cerrarMesAhora() {
    const ok = await confirmar({
      title: 'Cerrar el mes anterior ahora',
      message: 'Para cada cliente con consumos del mes pasado: se arma el resumen, se le envía por su canal, te queda una tarea y, si activaste "Facturar automáticamente", se emite y envía la factura. Lo del mes en curso no se toca.',
      confirmLabel: 'Cerrar el mes',
      tone: 'primary',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const r = await api<{ procesados: number }>('/billing/close-month', { method: 'POST', json: {} });
      toast.success(r.procesados === 0 ? 'No había cuentas del mes anterior para cerrar' : `Cierre hecho: ${r.procesados} cliente${r.procesados === 1 ? '' : 's'}`);
      load();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function enviarResumen(c: Cuenta) {
    setBusy(true);
    try {
      const r = await api<{ ok: boolean; channel: string; detail?: string }>(`/billing/accounts/${c.customer.id}/notify`, { method: 'POST', json: {} });
      if (r.ok) toast.success(`Resumen enviado a ${customerName(c.customer)} por ${CANAL[r.channel] ?? r.channel}`);
      else toast.error(`No se pudo enviar el resumen: ${r.detail ?? 'sin detalle'}`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function confirmarFacturar() {
    if (!facturar) return;
    if (!billingCompleto(billing, devMode)) {
      toast.error('Falta a nombre de quién sale la factura.');
      return;
    }
    setBusy(true);
    try {
      const r = await api<{ invoice: { id: string; status: string; establishment: string | null; expeditionPoint: string | null; docNumber: string | null }; sent: { ok: boolean; channel: string; detail?: string } | null }>(
        `/billing/accounts/${facturar.customer.id}/invoice`,
        { method: 'POST', json: { ...billingPayload(billing, devMode), issue: opciones.issue, send: opciones.send } },
      );
      const numero = r.invoice.docNumber ? `${r.invoice.establishment}-${r.invoice.expeditionPoint}-${r.invoice.docNumber}` : 'en borrador';
      if (r.sent?.ok) toast.success(`Factura ${numero} emitida y enviada por ${CANAL[r.sent.channel] ?? r.sent.channel}`);
      else if (r.sent) toast.error(`Factura ${numero} emitida, pero no se pudo enviar: ${r.sent.detail ?? 'sin detalle'}`);
      else toast.success(`Factura ${numero} creada`);
      setFacturar(null);
      setDetalle(null);
      load();
      onVerFactura(r.invoice.id);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className={tableCard}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-3">
          <p className="text-sm text-slate-500">
            Clientes con <b>cuenta mensual</b> y consumos pendientes de facturar. Lo atendido entra solo al marcar el turno como Atendido; las compras se cargan desde la ficha del cliente. El cierre automático se
            configura en{' '}
            <Link className="underline" href="/app/settings/facturacion">
              Ajustes → Facturación
            </Link>
            . Para cobrar solo algunos servicios o avisar de una cuenta pendiente, usá{' '}
            <Link className="underline" href="/app/cobros">
              Cobros
            </Link>
            .
          </p>
          <Button variant="ghost" loading={busy} onClick={() => void cerrarMesAhora()}>
            Cerrar el mes anterior ahora
          </Button>
        </div>
        <table className="tbl">
          <thead>
            <tr>
              <th>Cliente</th>
              <th>Consumos</th>
              <th>Desde</th>
              <th className="text-right">Total pendiente</th>
              <th>Recibe por</th>
              <th>
                <span className="sr-only">Acciones</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {(cuentas ?? []).map((c) => (
              <tr key={c.customer.id} className="hover:bg-slate-50">
                <td>
                  <Link className="font-medium text-sky-700 hover:underline" href={`/app/customers/${c.customer.id}`}>
                    {customerName(c.customer)}
                  </Link>
                  {c.customer.billingMode !== 'monthly' && <span className="block text-xs text-amber-700">factura por servicio (tiene consumos sueltos)</span>}
                </td>
                <td>{c.count}</td>
                <td className="text-xs text-slate-500">{c.since ? fecha(c.since) : '—'}</td>
                <td className="text-right font-medium tabular-nums">{money(c.total)}</td>
                <td className="text-xs text-slate-500">{CANAL[c.customer.invoiceChannel] ?? c.customer.invoiceChannel}</td>
                <td className="text-right">
                  <span className="inline-flex flex-wrap justify-end gap-1">
                    <button className={buttonGhost} onClick={() => void verDetalle(c)}>
                      Ver consumos
                    </button>
                    <button className={buttonGhost} onClick={() => void enviarResumen(c)} disabled={busy}>
                      Enviar resumen
                    </button>
                    <button
                      className={buttonSoft}
                      onClick={() => {
                        setBilling({ kind: 'none' });
                        setOpciones({ issue: true, send: true });
                        setFacturar(c);
                      }}
                    >
                      Facturar el mes
                    </button>
                  </span>
                </td>
              </tr>
            ))}
            {cuentas && cuentas.length === 0 && (
              <EmptyRow colSpan={6}>
                Ningún cliente tiene consumos pendientes. Para que un cliente acumule, en su ficha elegí Facturación: <b>cuenta mensual</b>.
              </EmptyRow>
            )}
            {cuentas === null && <EmptyRow colSpan={6}>Cargando…</EmptyRow>}
          </tbody>
        </table>
      </div>

      {statements.length > 0 && (
        <div className={tableCard}>
          <div className="border-b border-slate-100 p-3">
            <p className="text-sm font-medium text-slate-800">Cierres de mes</p>
            <p className="text-xs text-slate-500">Resúmenes generados por el cierre automático (o el manual). El aviso al dueño queda también como tarea.</p>
          </div>
          <table className="tbl">
            <thead>
              <tr>
                <th>Mes</th>
                <th>Cliente</th>
                <th className="text-right">Total</th>
                <th>Cliente avisado</th>
                <th>Factura</th>
                <th>Fecha</th>
              </tr>
            </thead>
            <tbody>
              {statements.map((s) => (
                <tr key={s.id} className="hover:bg-slate-50">
                  <td className="capitalize">{periodoLabel(s.period)}</td>
                  <td>{customerName(s.customer)}</td>
                  <td className="text-right tabular-nums">{money(s.total)}</td>
                  <td className="text-xs">{s.notifiedCustomerAt ? <Badge tone="emerald">sí, por {CANAL[s.customer.invoiceChannel] ?? s.customer.invoiceChannel}</Badge> : <Badge tone="amber">no</Badge>}</td>
                  <td>
                    {s.invoice ? (
                      <button className="text-sky-700 hover:underline" onClick={() => onVerFactura(s.invoice!.id)}>
                        {s.invoice.docNumber ? `${s.invoice.establishment}-${s.invoice.expeditionPoint}-${s.invoice.docNumber}` : 'borrador'}
                      </button>
                    ) : (
                      <span className="text-xs text-slate-400">sin facturar</span>
                    )}
                  </td>
                  <td className="text-xs text-slate-500">{dt(s.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {detalle && (
        <Modal title={`Consumos pendientes de ${customerName(detalle.cuenta.customer)}`} description={`${detalle.consumos.length} consumo${detalle.consumos.length === 1 ? '' : 's'} · total ${money(detalle.cuenta.total)}`} onClose={() => setDetalle(null)} size="lg">
          <table className="tbl">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Detalle</th>
                <th className="text-right">Cant.</th>
                <th className="text-right">Total</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {detalle.consumos.map((c) => (
                <tr key={c.id}>
                  <td className="text-xs">{fecha(c.chargedOn)}</td>
                  <td>
                    {c.description}
                    <span className="ml-1 text-xs text-slate-400">{c.source === 'appointment' ? 'turno atendido' : 'cargado a mano'}</span>
                    {c.notes && <span className="block text-xs text-slate-400">{c.notes}</span>}
                  </td>
                  <td className="text-right tabular-nums">{Number(c.quantity)}</td>
                  <td className="text-right tabular-nums">{money(c.lineTotal)}</td>
                  <td className="text-right">
                    <button className="text-xs text-red-600 hover:underline" onClick={() => void anularConsumo(c.id)}>
                      Anular
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDetalle(null)}>
              Cerrar
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                setBilling({ kind: 'none' });
                setOpciones({ issue: true, send: true });
                setFacturar(detalle.cuenta);
              }}
            >
              Facturar el mes
            </Button>
          </div>
        </Modal>
      )}

      {facturar && (
        <Modal
          title={`Facturar la cuenta de ${customerName(facturar.customer)}`}
          description={`Una sola factura con los ${facturar.count} consumos pendientes: ${money(facturar.total)}.`}
          onClose={() => setFacturar(null)}
          size="lg"
        >
          <div className="space-y-3">
            <FacturarA devMode={devMode} customer={{ id: facturar.customer.id }} value={billing} onChange={setBilling} />
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-0.5" checked={opciones.issue} onChange={(e) => setOpciones({ ...opciones, issue: e.target.checked, send: e.target.checked && opciones.send })} />
              <span>
                <b>Emitir ahora</b> <span className="text-xs text-slate-500">(toma número; si lo destildás queda como borrador para revisar)</span>
              </span>
            </label>
            <label className={`flex items-start gap-2 text-sm ${opciones.issue ? '' : 'opacity-50'}`}>
              <input type="checkbox" className="mt-0.5" disabled={!opciones.issue} checked={opciones.send} onChange={(e) => setOpciones({ ...opciones, send: e.target.checked })} />
              <span>
                <b>Enviar al cliente por {CANAL[facturar.customer.invoiceChannel] ?? facturar.customer.invoiceChannel}</b>{' '}
                <span className="text-xs text-slate-500">
                  {facturar.customer.invoiceChannel === 'email' ? `(${facturar.customer.email ?? 'sin email cargado'}; con el PDF adjunto)` : `(${facturar.customer.phoneE164 ?? 'sin celular cargado'}; con link al comprobante)`}
                </span>
              </span>
            </label>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setFacturar(null)}>
                Volver
              </Button>
              <Button variant="primary" loading={busy} disabled={!billingCompleto(billing, devMode)} onClick={() => void confirmarFacturar()}>
                {opciones.issue ? (opciones.send ? 'Emitir y enviar' : 'Emitir') : 'Crear borrador'}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
