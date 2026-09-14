'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

import { api } from '../../../lib/api';
import { customerName } from '../../../lib/customer-picker';
import { useConfirm, useToast } from '../../../lib/feedback';
import { errorMessage } from '../../../lib/labels';
import { useTenantInfo } from '../../../lib/tenant';
import {
  Badge,
  Button,
  EmptyRow,
  Modal,
  PageHeader,
  buttonGhost,
  buttonSoft,
  money,
  tableCard,
} from '../../../lib/ui';

import {
  FacturarA,
  billingCompleto,
  billingPayload,
  type BillingChoice,
} from '../invoices/facturar-a';

// Cobros pendientes (pedido de Johan 2026-09-08): la lista de clientes que
// deben, con lo atrasado (mas de un mes sin cobrar) en rojo. "Cobrar" abre
// todos los servicios adquiridos y deja elegir cuales facturar ahora (si
// tomo 5 y paga 3, se emite por esos 3; los otros 2 siguen en cuenta).
// "Avisar" le manda al cliente que tiene una cuenta pendiente de pago con
// el monto y los servicios, por su canal (WhatsApp o email).

interface Cuenta {
  customer: {
    id: string;
    firstName: string;
    lastName: string | null;
    phoneE164: string | null;
    email: string | null;
    billingMode: string;
    invoiceChannel: string;
  };
  total: string;
  count: number;
  since: string | null;
  overdue_total: string;
  overdue_count: number;
  /** Consumos con fecha anterior a esta estan atrasados (hoy menos un mes). */
  overdue_cutoff: string;
}
interface Consumo {
  id: string;
  description: string;
  quantity: string;
  lineTotal: string;
  chargedOn: string;
  source: string;
  notes: string | null;
}
interface Detalle {
  cuenta: Cuenta;
  consumos: Consumo[];
  cutoff: string;
}

const CANAL: Record<string, string> = { whatsapp: 'WhatsApp', email: 'email' };
const fecha = (iso: string) => new Date(iso).toLocaleDateString(undefined, { timeZone: 'UTC' });
const DIA_MS = 86_400_000;

/** Dias de atraso respecto del limite (mas de un mes sin cobrar); 0 si esta al dia. */
function diasDeAtraso(chargedOn: string, cutoff: string): number {
  const d = Math.floor((Date.parse(cutoff) - Date.parse(chargedOn)) / DIA_MS);
  return d > 0 ? d : 0;
}
const sumar = (rows: { lineTotal: string }[]) =>
  rows.reduce((acc, c) => acc + BigInt(c.lineTotal), 0n);

export default function CobrosPage() {
  const toast = useToast();
  const confirmar = useConfirm();
  const { devMode } = useTenantInfo();
  const [cuentas, setCuentas] = useState<Cuenta[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detalle, setDetalle] = useState<Detalle | null>(null);
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set());
  const [paso, setPaso] = useState<'elegir' | 'facturar'>('elegir');
  const [billing, setBilling] = useState<BillingChoice>({ kind: 'none' });
  const [opciones, setOpciones] = useState({ issue: true, send: true });
  const [busy, setBusy] = useState(false);
  const [emitida, setEmitida] = useState<{ id: string; numero: string } | null>(null);

  const load = useCallback(() => {
    api<Cuenta[]>('/billing/accounts')
      .then((rows) => {
        setCuentas(rows);
        setError(null);
      })
      .catch((e) => setError(errorMessage(e, 'No se pudieron cargar los cobros pendientes.')));
  }, []);
  useEffect(() => load(), [load]);

  const totales = useMemo(() => {
    const rows = cuentas ?? [];
    return {
      pendiente: sumar(rows.map((c) => ({ lineTotal: c.total }))),
      atrasado: sumar(rows.map((c) => ({ lineTotal: c.overdue_total }))),
      clientes: rows.length,
      conAtraso: rows.filter((c) => c.overdue_count > 0).length,
    };
  }, [cuentas]);

  async function abrirCobrar(c: Cuenta) {
    try {
      const r = await api<{ charges: Consumo[]; overdue_cutoff: string }>(
        `/billing/accounts/${c.customer.id}`,
      );
      setDetalle({ cuenta: c, consumos: r.charges, cutoff: r.overdue_cutoff });
      setSeleccion(new Set(r.charges.map((x) => x.id)));
      setPaso('elegir');
      setBilling({ kind: 'none' });
      setOpciones({ issue: true, send: true });
      setEmitida(null);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  const elegidos = detalle ? detalle.consumos.filter((c) => seleccion.has(c.id)) : [];
  const totalElegido = sumar(elegidos);
  const todosElegidos = detalle ? seleccion.size === detalle.consumos.length : false;

  function alternar(id: string) {
    setSeleccion((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function avisar(c: Cuenta, chargeIds?: string[]) {
    const cuantos = chargeIds?.length ?? c.count;
    const monto = chargeIds ? money(totalElegido) : money(c.total);
    const ok = await confirmar({
      title: `Avisar a ${customerName(c.customer)} que tiene una cuenta pendiente`,
      message: `Se le envía por ${CANAL[c.customer.invoiceChannel] ?? c.customer.invoiceChannel} un mensaje con el monto (${monto}) y el detalle de ${cuantos === 1 ? 'el servicio' : `los ${cuantos} servicios`} sin pagar.`,
      confirmLabel: 'Enviar aviso',
      tone: 'primary',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const r = await api<{ ok: boolean; channel: string; detail?: string }>(
        `/billing/accounts/${c.customer.id}/notify`,
        {
          method: 'POST',
          json: { reminder: true, ...(chargeIds ? { charge_ids: chargeIds } : {}) },
        },
      );
      if (r.ok)
        toast.success(
          `Aviso de cuenta pendiente enviado a ${customerName(c.customer)} por ${CANAL[r.channel] ?? r.channel}`,
        );
      else toast.error(`No se pudo enviar el aviso: ${r.detail ?? 'sin detalle'}`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function cobrar() {
    if (!detalle || elegidos.length === 0) return;
    if (!billingCompleto(billing, devMode)) {
      toast.error('Falta a nombre de quién sale la factura.');
      return;
    }
    setBusy(true);
    try {
      const r = await api<{
        invoice: {
          id: string;
          establishment: string | null;
          expeditionPoint: string | null;
          docNumber: string | null;
        };
        sent: { ok: boolean; channel: string; detail?: string } | null;
      }>(`/billing/accounts/${detalle.cuenta.customer.id}/invoice`, {
        method: 'POST',
        json: {
          ...billingPayload(billing, devMode),
          issue: opciones.issue,
          send: opciones.send,
          charge_ids: elegidos.map((c) => c.id),
        },
      });
      const numero = r.invoice.docNumber
        ? `${r.invoice.establishment}-${r.invoice.expeditionPoint}-${r.invoice.docNumber}`
        : 'borrador';
      if (r.sent?.ok)
        toast.success(
          `Factura ${numero} emitida por ${money(totalElegido)} y enviada por ${CANAL[r.sent.channel] ?? r.sent.channel}`,
        );
      else if (r.sent)
        toast.error(
          `Factura ${numero} emitida, pero no se pudo enviar: ${r.sent.detail ?? 'sin detalle'}`,
        );
      else toast.success(`Factura ${numero} creada por ${money(totalElegido)}`);
      setEmitida({ id: r.invoice.id, numero });
      setDetalle(null);
      load();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Cobros pendientes"
        description="Clientes con servicios sin cobrar. Lo que lleva más de un mes sin pagarse figura en rojo. Con «Cobrar» elegís qué servicios facturar ahora; con «Avisar» el cliente recibe el monto y el detalle por WhatsApp o email."
      />
      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {emitida && (
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Factura {emitida.numero} lista.{' '}
          <Link className="font-medium underline" href={`/app/invoices?factura=${emitida.id}`}>
            Ver la factura y registrar el pago
          </Link>
        </p>
      )}
      {cuentas && cuentas.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge tone="slate">
            {totales.clientes} cliente{totales.clientes === 1 ? '' : 's'} ·{' '}
            {money(totales.pendiente)} por cobrar
          </Badge>
          {totales.atrasado > 0n && (
            <Badge tone="red">
              {money(totales.atrasado)} con más de un mes de atraso ({totales.conAtraso} cliente
              {totales.conAtraso === 1 ? '' : 's'})
            </Badge>
          )}
        </div>
      )}
      <div className={tableCard}>
        <table className="tbl">
          <thead>
            <tr>
              <th>Cliente</th>
              <th>Servicios</th>
              <th>Desde</th>
              <th className="text-right">Atrasado</th>
              <th className="text-right">Total pendiente</th>
              <th>Recibe por</th>
              <th>
                <span className="sr-only">Acciones</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {(cuentas ?? []).map((c) => {
              const atrasado = c.overdue_count > 0;
              return (
                <tr
                  key={c.customer.id}
                  className={atrasado ? 'bg-red-50/60 hover:bg-red-50' : 'hover:bg-slate-50'}
                >
                  <td>
                    <Link
                      className={`font-medium hover:underline ${atrasado ? 'text-red-700' : 'text-sky-700'}`}
                      href={`/app/customers/${c.customer.id}`}
                    >
                      {customerName(c.customer)}
                    </Link>
                    {atrasado && (
                      <span className="block text-xs text-red-600">
                        {c.overdue_count === c.count ? 'todo' : `${c.overdue_count} de ${c.count}`}{' '}
                        con más de un mes de atraso
                      </span>
                    )}
                  </td>
                  <td>{c.count}</td>
                  <td className={`text-xs ${atrasado ? 'text-red-600' : 'text-slate-500'}`}>
                    {c.since ? fecha(c.since) : '—'}
                  </td>
                  <td className="text-right font-medium tabular-nums text-red-700">
                    {atrasado ? money(c.overdue_total) : ''}
                  </td>
                  <td
                    className={`text-right font-medium tabular-nums ${atrasado ? 'text-red-700' : ''}`}
                  >
                    {money(c.total)}
                  </td>
                  <td className="text-xs text-slate-500">
                    {CANAL[c.customer.invoiceChannel] ?? c.customer.invoiceChannel}
                  </td>
                  <td className="text-right">
                    <span className="inline-flex flex-wrap justify-end gap-1">
                      <button
                        className={buttonGhost}
                        onClick={() => void avisar(c)}
                        disabled={busy}
                      >
                        Avisar
                      </button>
                      <button className={buttonSoft} onClick={() => void abrirCobrar(c)}>
                        Cobrar
                      </button>
                    </span>
                  </td>
                </tr>
              );
            })}
            {cuentas && cuentas.length === 0 && (
              <EmptyRow colSpan={7}>
                No hay cobros pendientes. Los servicios quedan a cobrar cuando el cliente tiene{' '}
                <b>cuenta mensual</b> en su ficha y el turno se marca como Atendido (o se le carga
                una compra).
              </EmptyRow>
            )}
            {cuentas === null && !error && <EmptyRow colSpan={7}>Cargando…</EmptyRow>}
          </tbody>
        </table>
      </div>

      {detalle && paso === 'elegir' && (
        <Modal
          title={`Cobrar a ${customerName(detalle.cuenta.customer)}`}
          description="Todos los servicios adquiridos sin cobrar. Destildá los que todavía no se pagan: la factura sale solo por los elegidos y el resto sigue en cuenta."
          onClose={() => setDetalle(null)}
          size="lg"
        >
          <table className="tbl">
            <thead>
              <tr>
                <th className="w-8">
                  <input
                    type="checkbox"
                    aria-label="Elegir todos"
                    checked={todosElegidos}
                    onChange={(e) =>
                      setSeleccion(
                        e.target.checked ? new Set(detalle.consumos.map((c) => c.id)) : new Set(),
                      )
                    }
                  />
                </th>
                <th>Fecha</th>
                <th>Servicio</th>
                <th className="text-right">Cant.</th>
                <th className="text-right">Importe</th>
              </tr>
            </thead>
            <tbody>
              {detalle.consumos.map((c) => {
                const dias = diasDeAtraso(c.chargedOn, detalle.cutoff);
                const atrasado = dias > 0;
                const elegido = seleccion.has(c.id);
                return (
                  <tr
                    key={c.id}
                    className={`cursor-pointer ${atrasado ? 'bg-red-50/60' : ''} ${elegido ? '' : 'opacity-60'}`}
                    onClick={() => alternar(c.id)}
                  >
                    <td onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={elegido}
                        onChange={() => alternar(c.id)}
                        aria-label={`Cobrar ${c.description}`}
                      />
                    </td>
                    <td className={`text-xs ${atrasado ? 'font-medium text-red-700' : ''}`}>
                      {fecha(c.chargedOn)}
                      {atrasado && (
                        <span className="block text-[11px] text-red-600">
                          +{dias} día{dias === 1 ? '' : 's'} sobre el mes
                        </span>
                      )}
                    </td>
                    <td className={atrasado ? 'text-red-700' : ''}>
                      {c.description}
                      <span className="ml-1 text-xs text-slate-400">
                        {c.source === 'appointment' ? 'turno atendido' : 'cargado a mano'}
                      </span>
                      {c.notes && <span className="block text-xs text-slate-400">{c.notes}</span>}
                    </td>
                    <td className="text-right tabular-nums">{Number(c.quantity)}</td>
                    <td
                      className={`text-right tabular-nums ${atrasado ? 'font-medium text-red-700' : ''}`}
                    >
                      {money(c.lineTotal)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4} className="text-right text-sm text-slate-600">
                  {elegidos.length} de {detalle.consumos.length} elegido
                  {elegidos.length === 1 ? '' : 's'} · a cobrar ahora
                </td>
                <td className="text-right text-base font-semibold tabular-nums">
                  {money(totalElegido)}
                </td>
              </tr>
              {elegidos.length < detalle.consumos.length && (
                <tr>
                  <td colSpan={5} className="text-right text-xs text-slate-500">
                    Quedan en cuenta {detalle.consumos.length - elegidos.length} servicio
                    {detalle.consumos.length - elegidos.length === 1 ? '' : 's'} por{' '}
                    {money(sumar(detalle.consumos) - totalElegido)}.
                  </td>
                </tr>
              )}
            </tfoot>
          </table>
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={() => setDetalle(null)}>
              Cerrar
            </Button>
            <Button
              variant="ghost"
              disabled={elegidos.length === 0 || busy}
              onClick={() =>
                void avisar(
                  detalle.cuenta,
                  elegidos.map((c) => c.id),
                )
              }
            >
              Avisar por{' '}
              {CANAL[detalle.cuenta.customer.invoiceChannel] ??
                detalle.cuenta.customer.invoiceChannel}
            </Button>
            <Button
              variant="primary"
              disabled={elegidos.length === 0}
              onClick={() => setPaso('facturar')}
            >
              Facturar {money(totalElegido)}
            </Button>
          </div>
        </Modal>
      )}

      {detalle && paso === 'facturar' && (
        <Modal
          title={`Factura por ${money(totalElegido)} a ${customerName(detalle.cuenta.customer)}`}
          description={`${elegidos.length} servicio${elegidos.length === 1 ? '' : 's'} elegido${elegidos.length === 1 ? '' : 's'}${elegidos.length < detalle.consumos.length ? `; ${detalle.consumos.length - elegidos.length} siguen en cuenta` : ''}.`}
          onClose={() => setDetalle(null)}
          size="lg"
        >
          <div className="space-y-3">
            <ul className="max-h-40 space-y-0.5 overflow-y-auto rounded-md border border-slate-200 bg-slate-50/60 p-2 text-sm">
              {elegidos.map((c) => (
                <li key={c.id} className="flex justify-between gap-3">
                  <span>
                    <span className="text-xs text-slate-500">{fecha(c.chargedOn)}</span>{' '}
                    {c.description}
                  </span>
                  <span className="tabular-nums">{money(c.lineTotal)}</span>
                </li>
              ))}
            </ul>
            <FacturarA
              devMode={devMode}
              customer={{ id: detalle.cuenta.customer.id }}
              value={billing}
              onChange={setBilling}
            />
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={opciones.issue}
                onChange={(e) =>
                  setOpciones({
                    ...opciones,
                    issue: e.target.checked,
                    send: e.target.checked && opciones.send,
                  })
                }
              />
              <span>
                <b>Emitir ahora</b>{' '}
                <span className="text-xs text-slate-500">
                  (toma número; si lo destildás queda como borrador para revisar)
                </span>
              </span>
            </label>
            <label
              className={`flex items-start gap-2 text-sm ${opciones.issue ? '' : 'opacity-50'}`}
            >
              <input
                type="checkbox"
                className="mt-0.5"
                disabled={!opciones.issue}
                checked={opciones.send}
                onChange={(e) => setOpciones({ ...opciones, send: e.target.checked })}
              />
              <span>
                <b>
                  Enviar al cliente por{' '}
                  {CANAL[detalle.cuenta.customer.invoiceChannel] ??
                    detalle.cuenta.customer.invoiceChannel}
                </b>{' '}
                <span className="text-xs text-slate-500">
                  {detalle.cuenta.customer.invoiceChannel === 'email'
                    ? `(${detalle.cuenta.customer.email ?? 'sin email cargado'}; con el PDF adjunto)`
                    : `(${detalle.cuenta.customer.phoneE164 ?? 'sin celular cargado'}; con link al comprobante)`}
                </span>
              </span>
            </label>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setPaso('elegir')}>
                Volver a elegir
              </Button>
              <Button
                variant="primary"
                loading={busy}
                disabled={!billingCompleto(billing, devMode)}
                onClick={() => void cobrar()}
              >
                {opciones.issue
                  ? opciones.send
                    ? `Emitir y enviar ${money(totalElegido)}`
                    : `Emitir ${money(totalElegido)}`
                  : 'Crear borrador'}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
