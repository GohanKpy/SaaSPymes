'use client';

import { useEffect, useState } from 'react';

import { api } from '../../../lib/api';
import { useToast } from '../../../lib/feedback';
import { errorMessage } from '../../../lib/labels';
import { Button, Field, Modal, dt, inputClass, money } from '../../../lib/ui';

// Anulacion y nota de credito segun SIFEN (2026-09-14, ADR 0013). Las reglas
// (plazo desde la aprobacion, motivo de 5 a 500 caracteres, definitivo,
// NC despues del plazo) viven en el server; aca solo se explican y se piden.

export const SIFEN_HORAS = { factura: 48, nota_credito: 168 } as const;

export interface DocFiscal {
  id: string;
  docType?: string;
  status: string;
  approvedAt?: string | null;
  docNumber: string | null;
  establishment: string | null;
  expeditionPoint: string | null;
  total: string;
  payments: { amount: string }[];
}

export const numeroDoc = (i: { establishment: string | null; expeditionPoint: string | null; docNumber: string | null } | null | undefined) =>
  i?.docNumber ? `${i.establishment}-${i.expeditionPoint}-${i.docNumber}` : null;

/** Hasta cuando SIFEN acepta el evento de cancelacion (desde la aprobacion). */
export function limiteAnulacion(i: DocFiscal): Date | null {
  if (!i.approvedAt) return null;
  const horas = i.docType === 'nota_credito' ? SIFEN_HORAS.nota_credito : SIFEN_HORAS.factura;
  return new Date(new Date(i.approvedAt).getTime() + horas * 3600 * 1000);
}
export const anulable = (i: DocFiscal) => {
  const l = limiteAnulacion(i);
  return i.status === 'approved' && Boolean(l && l.getTime() > Date.now());
};

export function AnularModal({ invoice, onClose, onDone }: { invoice: DocFiscal; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [motivo, setMotivo] = useState('');
  const [avisar, setAvisar] = useState(true);
  const [busy, setBusy] = useState(false);
  const pagado = invoice.payments.reduce((s, p) => s + Number(p.amount), 0);
  const limite = limiteAnulacion(invoice);
  const tipo = invoice.docType === 'nota_credito' ? 'nota de crédito' : 'factura';
  async function confirmar(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/invoices/${invoice.id}/cancel`, { method: 'POST', json: { reason: motivo.trim(), notify_customer: avisar } });
      toast.success(`${tipo === 'factura' ? 'Factura' : 'Nota de crédito'} anulada ante SIFEN${avisar ? ' y cliente avisado' : ''}`);
      onDone();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={`Anular la ${tipo} ${numeroDoc(invoice) ?? ''}`} onClose={onClose} role="alertdialog">
      <form className="space-y-3" onSubmit={(e) => void confirmar(e)}>
        <div className="space-y-1 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700">
          <p>
            SIFEN acepta la anulación hasta el <b>{limite ? dt(limite.toISOString()) : '—'}</b> ({invoice.docType === 'nota_credito' ? SIFEN_HORAS.nota_credito : SIFEN_HORAS.factura} h desde la aprobación).
            Después solo queda emitir una nota de crédito.
          </p>
          <p>Es <b>definitiva</b>: el comprobante queda sin validez fiscal, se conserva en el sistema con el motivo y el número no se vuelve a usar.</p>
          {pagado > 0 && <p className="text-amber-800">Tiene pagos registrados por {money(pagado)}: al anular queda una tarea para devolver el dinero al cliente o aplicarlo al comprobante correcto.</p>}
        </div>
        <Field label="Motivo (queda en SIFEN y en el aviso al cliente; 5 a 500 caracteres) *">
          <textarea className={`${inputClass} h-20`} value={motivo} required minLength={5} maxLength={500} placeholder="Ej: se facturó al cliente equivocado" onChange={(e) => setMotivo(e.target.value)} />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={avisar} onChange={(e) => setAvisar(e.target.checked)} />
          Avisar al cliente por WhatsApp o email que el comprobante quedó sin efecto
        </label>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" type="button" onClick={onClose}>
            Volver
          </Button>
          <Button variant="danger-solid" type="submit" loading={busy} disabled={motivo.trim().length < 5}>
            Anular ante SIFEN
          </Button>
        </div>
      </form>
    </Modal>
  );
}

interface ItemFactura {
  id: string;
  description: string;
  quantity: string;
  unitPrice: string;
  serviceId?: string | null;
}

export function NotaCreditoModal({ invoice, onClose, onDone }: { invoice: DocFiscal; onClose: () => void; onDone: (creditNoteId: string) => void }) {
  const toast = useToast();
  const [items, setItems] = useState<ItemFactura[] | null>(null);
  const [alcance, setAlcance] = useState<'total' | 'parcial'>('total');
  const [cantidades, setCantidades] = useState<Record<string, string>>({});
  const [motivo, setMotivo] = useState('');
  const [restock, setRestock] = useState(false);
  const [avisar, setAvisar] = useState(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void api<{ items: ItemFactura[] }>(`/invoices/${invoice.id}`)
      .then((i) => {
        setItems(i.items);
        setCantidades(Object.fromEntries(i.items.map((it) => [it.id, String(Number(it.quantity))])));
      })
      .catch(() => setItems([]));
  }, [invoice.id]);
  const seleccion = (items ?? []).map((it) => ({ item_id: it.id, quantity: Number(cantidades[it.id] ?? 0) })).filter((x) => x.quantity > 0);
  const totalParcial = (items ?? []).reduce((s, it) => s + Number(it.unitPrice) * Number(cantidades[it.id] ?? 0), 0);
  async function emitir(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const nc = await api<{ id: string; status: string }>(`/invoices/${invoice.id}/credit-note`, {
        method: 'POST',
        json: { reason: motivo.trim(), ...(alcance === 'parcial' ? { items: seleccion } : {}), restock, notify_customer: avisar },
      });
      toast.success(nc.status === 'approved' ? 'Nota de crédito emitida y aprobada' : `Nota de crédito creada (${nc.status})`);
      onDone(nc.id);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={`Nota de crédito sobre la factura ${numeroDoc(invoice) ?? ''}`}
      description="Es un comprobante electrónico propio que se emite ante SIFEN y referencia esta factura. Total: la deja sin efecto. Parcial: devolución de parte de lo vendido."
      onClose={onClose}
      size="lg"
    >
      <form className="space-y-3" onSubmit={(e) => void emitir(e)}>
        <div className="flex gap-4 text-sm">
          <label className="flex items-center gap-1.5">
            <input type="radio" checked={alcance === 'total'} onChange={() => setAlcance('total')} /> Total ({money(invoice.total)})
          </label>
          <label className="flex items-center gap-1.5">
            <input type="radio" checked={alcance === 'parcial'} onChange={() => setAlcance('parcial')} /> Parcial (elegir ítems y cantidades)
          </label>
        </div>
        {alcance === 'parcial' && (
          <table className="tbl">
            <thead>
              <tr>
                <th>Ítem</th>
                <th className="text-right">Facturado</th>
                <th className="text-right">Acreditar</th>
                <th className="text-right">Importe</th>
              </tr>
            </thead>
            <tbody>
              {(items ?? []).map((it) => (
                <tr key={it.id}>
                  <td>{it.description}</td>
                  <td className="text-right tabular-nums">{Number(it.quantity)}</td>
                  <td className="text-right">
                    <input className={`${inputClass} w-20 text-right`} inputMode="decimal" value={cantidades[it.id] ?? ''} onChange={(e) => setCantidades({ ...cantidades, [it.id]: e.target.value })} />
                  </td>
                  <td className="text-right tabular-nums">{money(Number(it.unitPrice) * Number(cantidades[it.id] ?? 0))}</td>
                </tr>
              ))}
              {items === null && (
                <tr>
                  <td colSpan={4} className="text-center text-xs text-slate-400">Cargando ítems…</td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3} className="text-right text-sm text-slate-500">Total a acreditar</td>
                <td className="text-right font-semibold tabular-nums">{money(totalParcial)}</td>
              </tr>
            </tfoot>
          </table>
        )}
        <Field label="Motivo (queda en el comprobante; 5 a 500 caracteres) *">
          <textarea className={`${inputClass} h-20`} value={motivo} required minLength={5} maxLength={500} placeholder="Ej: devolución del producto por falla; pasó el plazo de anulación" onChange={(e) => setMotivo(e.target.value)} />
        </Field>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5" checked={restock} onChange={(e) => setRestock(e.target.checked)} />
          <span>
            Los ítems acreditados vuelven al stock
            <span className="block text-xs text-slate-500">Solo si la mercadería volvió en condiciones de venderse. Aplica a ítems con control de stock.</span>
          </span>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={avisar} onChange={(e) => setAvisar(e.target.checked)} />
          Enviar la nota de crédito al cliente por WhatsApp o email
        </label>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" type="button" onClick={onClose}>
            Volver
          </Button>
          <Button variant="primary" type="submit" loading={busy} disabled={motivo.trim().length < 5 || (alcance === 'parcial' && seleccion.length === 0)}>
            Emitir nota de crédito
          </Button>
        </div>
      </form>
    </Modal>
  );
}
