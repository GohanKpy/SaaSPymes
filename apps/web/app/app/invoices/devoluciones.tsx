'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { api } from '../../../lib/api';
import { CustomerPicker, customerName, type PickedCustomer } from '../../../lib/customer-picker';
import { useToast } from '../../../lib/feedback';
import { errorMessage } from '../../../lib/labels';
import { Badge, Button, EmptyRow, Field, LoadMore, Modal, buttonGhost, inputClass, money, tableCard } from '../../../lib/ui';

// Devoluciones (pedido de Johan 2026-09-14): la gestion es interna. El bot
// registra el pedido y deriva; aca una persona lo revisa, decide con una nota
// (se avisa al cliente por su canal) y lo cierra: reingreso al stock y/o
// nota de credito sobre la factura.

interface Devolucion {
  id: string;
  status: string;
  description: string;
  reason: string | null;
  resolution: string | null;
  createdVia: string;
  createdAt: string;
  decidedAt: string | null;
  completedAt: string | null;
  restockedAt: string | null;
  conversationId: string | null;
  customer: { id: string; firstName: string; lastName: string | null; phoneE164: string | null };
  invoice: { id: string; establishment: string | null; expeditionPoint: string | null; docNumber: string | null; total: string; status: string; branchId: string } | null;
  service: { id: string; name: string; trackStock: boolean; isCombo: boolean } | null;
  creditNote: { id: string; establishment: string | null; expeditionPoint: string | null; docNumber: string | null; total: string; status: string } | null;
}

export const RETURN_LABEL: Record<string, { label: string; tone: 'amber' | 'sky' | 'emerald' | 'red' | 'slate' }> = {
  requested: { label: 'Solicitada', tone: 'amber' },
  reviewing: { label: 'En revisión', tone: 'sky' },
  approved: { label: 'Aprobada', tone: 'emerald' },
  rejected: { label: 'Rechazada', tone: 'red' },
  completed: { label: 'Cerrada', tone: 'slate' },
};

const numero = (i: { establishment: string | null; expeditionPoint: string | null; docNumber: string | null } | null) =>
  i?.docNumber ? `${i.establishment}-${i.expeditionPoint}-${i.docNumber}` : null;
const fecha = (iso: string) => new Date(iso).toLocaleString('es-PY', { dateStyle: 'short', timeStyle: 'short' });

export function DevolucionesSection({ onAbrirFactura }: { onAbrirFactura: (id: string) => void }) {
  const toast = useToast();
  const [rows, setRows] = useState<Devolucion[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [pendientes, setPendientes] = useState(0);
  const [filtro, setFiltro] = useState<'abiertas' | 'todas'>('abiertas');
  const [busy, setBusy] = useState(false);
  const [decidir, setDecidir] = useState<{ d: Devolucion; decision: 'approved' | 'rejected' | 'reviewing' } | null>(null);
  const [cerrar, setCerrar] = useState<Devolucion | null>(null);
  const [nueva, setNueva] = useState(false);

  const load = useCallback(
    async (c?: string | null) => {
      setBusy(true);
      try {
        const params = new URLSearchParams();
        if (c) params.set('cursor', c);
        const r = await api<{ data: Devolucion[]; next_cursor: string | null; pending: number }>(`/returns?${params.toString()}`);
        const data = filtro === 'abiertas' ? r.data.filter((d) => ['requested', 'reviewing', 'approved'].includes(d.status)) : r.data;
        setRows((prev) => (c ? [...(prev ?? []), ...data] : data));
        setCursor(r.next_cursor);
        setPendientes(r.pending);
      } catch (e) {
        toast.error(errorMessage(e, 'No se pudieron cargar las devoluciones.'));
      } finally {
        setBusy(false);
      }
    },
    [filtro],
  );
  useEffect(() => void load(), [load]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <span className="inline-flex rounded-md border border-slate-300 text-sm">
          <button className={`px-3 py-1.5 ${filtro === 'abiertas' ? 'bg-slate-100 font-medium' : 'text-slate-600'}`} onClick={() => setFiltro('abiertas')}>
            Abiertas
          </button>
          <button className={`border-l border-slate-300 px-3 py-1.5 ${filtro === 'todas' ? 'bg-slate-100 font-medium' : 'text-slate-600'}`} onClick={() => setFiltro('todas')}>
            Todas
          </button>
        </span>
        <span className="text-xs text-slate-500">
          {pendientes} pendiente{pendientes === 1 ? '' : 's'} de decisión. Un pedido de devolución es un momento sensible: respondé rápido y con cuidado.
        </span>
        <Button variant="soft" className="ml-auto" onClick={() => setNueva(true)}>
          Registrar devolución
        </Button>
      </div>

      <div className={tableCard}>
        <table className="tbl">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Cliente</th>
              <th>Qué devuelve</th>
              <th>Factura</th>
              <th>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(rows ?? []).map((d) => {
              const st = RETURN_LABEL[d.status] ?? { label: d.status, tone: 'slate' as const };
              return (
                <tr key={d.id} className="align-top hover:bg-slate-50">
                  <td className="whitespace-nowrap text-xs">
                    {fecha(d.createdAt)}
                    <span className="block text-slate-400">{d.createdVia === 'bot' ? 'por WhatsApp' : 'desde el panel'}</span>
                  </td>
                  <td>
                    <Link className="font-medium text-sky-700 hover:underline" href={`/app/customers/${d.customer.id}`}>
                      {customerName(d.customer)}
                    </Link>
                    {d.customer.phoneE164 && <span className="block text-xs text-slate-400">{d.customer.phoneE164}</span>}
                    {d.conversationId && (
                      <Link className="text-xs text-sky-700 hover:underline" href={`/app/inbox?conversation=${d.conversationId}`}>
                        Abrir chat
                      </Link>
                    )}
                  </td>
                  <td className="max-w-[22rem]">
                    <span className="block">{d.description}</span>
                    {d.reason && <span className="block text-xs text-slate-500">Motivo: {d.reason}</span>}
                    {d.resolution && <span className="mt-1 block whitespace-pre-line text-xs text-slate-600">Resolución: {d.resolution}</span>}
                    {d.restockedAt && <span className="block text-xs text-emerald-700">Mercadería reingresada al stock</span>}
                  </td>
                  <td className="text-xs">
                    {d.invoice ? (
                      <button className="text-sky-700 hover:underline" onClick={() => onAbrirFactura(d.invoice!.id)}>
                        {numero(d.invoice) ?? 'borrador'} · {money(d.invoice.total)}
                      </button>
                    ) : (
                      '—'
                    )}
                    {d.creditNote && (
                      <button className="block text-sky-700 hover:underline" onClick={() => onAbrirFactura(d.creditNote!.id)}>
                        NC {numero(d.creditNote)} · {money(d.creditNote.total)}
                      </button>
                    )}
                  </td>
                  <td>
                    <Badge tone={st.tone}>{st.label}</Badge>
                  </td>
                  <td className="text-right">
                    <span className="inline-flex flex-wrap justify-end gap-1">
                      {['requested', 'reviewing'].includes(d.status) && (
                        <>
                          {d.status === 'requested' && (
                            <button className={buttonGhost} onClick={() => setDecidir({ d, decision: 'reviewing' })}>
                              En revisión
                            </button>
                          )}
                          <button className={buttonGhost} onClick={() => setDecidir({ d, decision: 'approved' })}>
                            Aprobar
                          </button>
                          <button className={buttonGhost} onClick={() => setDecidir({ d, decision: 'rejected' })}>
                            Rechazar
                          </button>
                        </>
                      )}
                      {d.status === 'approved' && (
                        <button className={buttonGhost} onClick={() => setCerrar(d)}>
                          Cerrar
                        </button>
                      )}
                    </span>
                  </td>
                </tr>
              );
            })}
            {rows && rows.length === 0 && <EmptyRow colSpan={6}>{filtro === 'abiertas' ? 'No hay devoluciones abiertas.' : 'Sin devoluciones registradas.'}</EmptyRow>}
            {rows === null && <EmptyRow colSpan={6}>Cargando…</EmptyRow>}
          </tbody>
        </table>
      </div>
      <LoadMore nextCursor={cursor} loading={busy} onLoad={() => void load(cursor)} />

      {decidir && (
        <DecidirModal
          d={decidir.d}
          decision={decidir.decision}
          onClose={() => setDecidir(null)}
          onSaved={() => {
            setDecidir(null);
            void load();
          }}
        />
      )}
      {cerrar && (
        <CerrarModal
          d={cerrar}
          onClose={() => setCerrar(null)}
          onSaved={() => {
            setCerrar(null);
            void load();
          }}
          onAbrirFactura={onAbrirFactura}
        />
      )}
      {nueva && (
        <NuevaModal
          onClose={() => setNueva(false)}
          onSaved={() => {
            setNueva(false);
            void load();
          }}
        />
      )}
    </div>
  );
}

function DecidirModal({ d, decision, onClose, onSaved }: { d: Devolucion; decision: 'approved' | 'rejected' | 'reviewing'; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [nota, setNota] = useState('');
  const [avisar, setAvisar] = useState(true);
  const [busy, setBusy] = useState(false);
  const titulo = decision === 'approved' ? 'Aprobar la devolución' : decision === 'rejected' ? 'Rechazar la devolución' : 'Marcar en revisión';
  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/returns/${d.id}/decide`, { method: 'POST', json: { decision, note: nota.trim(), notify_customer: avisar } });
      toast.success(avisar ? 'Decisión guardada y cliente avisado' : 'Decisión guardada');
      onSaved();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={titulo} description={`${customerName(d.customer)}: ${d.description}`} onClose={onClose}>
      <form className="space-y-3" onSubmit={(e) => void guardar(e)}>
        <Field label={decision === 'rejected' ? 'Motivo para el cliente *' : 'Nota para el cliente *'}>
          <textarea
            className={`${inputClass} h-24`}
            value={nota}
            required
            minLength={3}
            maxLength={1000}
            placeholder={
              decision === 'approved'
                ? 'Ej: Traelo a la sucursal con el comprobante y te devolvemos el dinero o lo cambiamos.'
                : decision === 'rejected'
                  ? 'Ej: Pasaron más de 30 días desde la compra y el producto fue usado.'
                  : 'Ej: Lo estamos revisando con el proveedor; te respondemos mañana.'
            }
            onChange={(e) => setNota(e.target.value)}
          />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={avisar} onChange={(e) => setAvisar(e.target.checked)} />
          Avisar al cliente por WhatsApp (o email) con esta nota
        </label>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" type="button" onClick={onClose}>
            Volver
          </Button>
          <Button variant={decision === 'rejected' ? 'danger-solid' : 'primary'} type="submit" loading={busy} disabled={nota.trim().length < 3}>
            {titulo}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function CerrarModal({ d, onClose, onSaved, onAbrirFactura }: { d: Devolucion; onClose: () => void; onSaved: () => void; onAbrirFactura: (id: string) => void }) {
  const toast = useToast();
  const [nota, setNota] = useState('');
  const [reingresar, setReingresar] = useState(Boolean(d.service?.trackStock));
  const [cantidad, setCantidad] = useState('1');
  const [avisar, setAvisar] = useState(false);
  const [busy, setBusy] = useState(false);
  const puedeReingresar = Boolean(d.service?.trackStock && d.invoice?.branchId);
  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/returns/${d.id}/complete`, {
        method: 'POST',
        json: {
          ...(nota.trim() ? { note: nota.trim() } : {}),
          ...(puedeReingresar && reingresar ? { restock: { service_id: d.service!.id, branch_id: d.invoice!.branchId, quantity: Number(cantidad) || 1 } } : {}),
          ...(d.creditNote ? { credit_note_id: d.creditNote.id } : {}),
          notify_customer: avisar,
        },
      });
      toast.success('Devolución cerrada');
      onSaved();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Cerrar la devolución" description="Dejá constancia de cómo se resolvió. Si corresponde devolver dinero, emití antes la nota de crédito desde la factura." onClose={onClose}>
      <form className="space-y-3" onSubmit={(e) => void guardar(e)}>
        {d.invoice && !d.creditNote && (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Esta devolución tiene factura {numero(d.invoice)} y todavía no hay nota de crédito.{' '}
            <button type="button" className="font-medium underline" onClick={() => onAbrirFactura(d.invoice!.id)}>
              Abrir la factura
            </button>{' '}
            para emitirla (total o parcial) y después cerrá acá.
          </p>
        )}
        {d.creditNote && <p className="text-xs text-emerald-700">Nota de crédito {numero(d.creditNote)} por {money(d.creditNote.total)} vinculada.</p>}
        {puedeReingresar && (
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5" checked={reingresar} onChange={(e) => setReingresar(e.target.checked)} />
            <span>
              Reingresar al stock {d.service?.name}
              <span className="block text-xs text-slate-500">Solo si el producto volvió en condiciones de venderse.</span>
            </span>
          </label>
        )}
        {puedeReingresar && reingresar && (
          <Field label="Cantidad que vuelve">
            <input className={inputClass} inputMode="decimal" value={cantidad} onChange={(e) => setCantidad(e.target.value)} />
          </Field>
        )}
        <Field label="Cómo se resolvió (opcional)">
          <textarea className={`${inputClass} h-20`} value={nota} maxLength={1000} placeholder="Ej: se cambió por otro talle; se devolvió el dinero en efectivo" onChange={(e) => setNota(e.target.value)} />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={avisar} onChange={(e) => setAvisar(e.target.checked)} />
          Avisar al cliente que quedó resuelta
        </label>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" type="button" onClick={onClose}>
            Volver
          </Button>
          <Button variant="primary" type="submit" loading={busy}>
            Cerrar devolución
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function NuevaModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [customer, setCustomer] = useState<PickedCustomer | null>(null);
  const [descripcion, setDescripcion] = useState('');
  const [motivo, setMotivo] = useState('');
  const [busy, setBusy] = useState(false);
  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!customer) return;
    setBusy(true);
    try {
      await api('/returns', { method: 'POST', json: { customer_id: customer.id, description: descripcion.trim(), ...(motivo.trim() ? { reason: motivo.trim() } : {}) } });
      toast.success('Devolución registrada');
      onSaved();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Registrar una devolución" description="Para pedidos que llegan en persona o por teléfono. Después se decide y se cierra como cualquier otra." onClose={onClose}>
      <form className="space-y-3" onSubmit={(e) => void guardar(e)}>
        <Field label="Cliente *">
          <CustomerPicker value={customer} onChange={setCustomer} allowCreate />
        </Field>
        <Field label="Qué devuelve y qué pasó *">
          <textarea className={`${inputClass} h-20`} value={descripcion} required minLength={5} maxLength={1000} onChange={(e) => setDescripcion(e.target.value)} />
        </Field>
        <Field label="Motivo resumido (opcional)">
          <input className={inputClass} value={motivo} maxLength={300} onChange={(e) => setMotivo(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" type="button" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" type="submit" loading={busy} disabled={!customer || descripcion.trim().length < 5}>
            Registrar
          </Button>
        </div>
      </form>
    </Modal>
  );
}
