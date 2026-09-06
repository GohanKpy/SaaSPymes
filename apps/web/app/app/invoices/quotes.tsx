'use client';

import { useCallback, useEffect, useState } from 'react';

import { API_URL, api, getToken } from '../../../lib/api';
import { CustomerPicker, customerName, type PickedCustomer } from '../../../lib/customer-picker';
import { useConfirm, useToast } from '../../../lib/feedback';
import { QUOTE_STATUS, errorMessage, statusOf } from '../../../lib/labels';
import {
  Badge,
  Button,
  EmptyRow,
  Field,
  Modal,
  buttonDanger,
  buttonGhost,
  buttonSoft,
  dt,
  inputClass,
  money,
  tableCard,
} from '../../../lib/ui';

import { LINEA_VACIA, LineasEditor, aItems, type Linea, type ServicioOption } from './lineas';

// Presupuestos (fase 2 auditoria de paneles 2026-09-05): alta y edicion en
// ventana con el constructor de lineas y total en vivo; acciones por estado con
// verbos claros; "Facturar" solo desde aceptado; link a la factura generada.

interface Quote {
  id: string;
  number: number;
  status: string;
  total: string;
  validUntil: string | null;
  notes?: string | null;
  createdAt: string;
  invoiceId: string | null;
  customer: { id?: string; firstName: string; lastName: string | null; phoneE164?: string | null };
  items?: { serviceId: string | null; description: string; quantity: string; unitPrice: string; taxRate: number }[];
}

const numero = (q: Quote) => `P-${String(q.number).padStart(4, '0')}`;

export function QuotesSection({
  services,
  branchId,
  onVerFactura,
  abrirNuevo,
  clientePrefill,
}: {
  services: ServicioOption[];
  branchId: string | undefined;
  onVerFactura: (invoiceId: string) => void;
  abrirNuevo: boolean;
  clientePrefill: PickedCustomer | null;
}) {
  const confirmar = useConfirm();
  const toast = useToast();
  const [rows, setRows] = useState<Quote[] | null>(null);
  const [estado, setEstado] = useState('');
  const [modal, setModal] = useState<Quote | 'nuevo' | null>(null);
  const [customer, setCustomer] = useState<PickedCustomer | null>(null);
  const [validUntil, setValidUntil] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<Linea[]>([LINEA_VACIA]);
  const [guardando, setGuardando] = useState(false);

  const load = useCallback(() => {
    const params = new URLSearchParams({ limit: '100' });
    if (estado) params.set('status', estado);
    api<Quote[]>(`/quotes?${params.toString()}`)
      .then(setRows)
      .catch((e) => toast.error(errorMessage(e)));
  }, [estado]);
  useEffect(() => load(), [load]);

  useEffect(() => {
    if (abrirNuevo) {
      setCustomer(clientePrefill);
      setModal('nuevo');
    }
  }, [abrirNuevo, clientePrefill]);

  function openNuevo() {
    setCustomer(null);
    setValidUntil('');
    setNotes('');
    setLines([LINEA_VACIA]);
    setModal('nuevo');
  }

  async function openEditar(q: Quote) {
    try {
      const full = await api<Quote>(`/quotes/${q.id}`);
      setCustomer(full.customer.id ? { id: full.customer.id, firstName: full.customer.firstName, lastName: full.customer.lastName, phoneE164: full.customer.phoneE164 ?? null } : null);
      setValidUntil(full.validUntil ? full.validUntil.slice(0, 10) : '');
      setNotes(full.notes ?? '');
      setLines(
        (full.items ?? []).map((it) => ({
          service_id: it.serviceId ?? '',
          description: it.description,
          quantity: String(Number(it.quantity)),
          unit_price: String(Number(it.unitPrice)),
          tax_rate: String(it.taxRate) as Linea['tax_rate'],
        })),
      );
      setModal(full);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    const items = aItems(lines);
    if (items.length === 0) {
      toast.error('Agregá al menos un ítem al presupuesto.');
      return;
    }
    setGuardando(true);
    try {
      if (modal === 'nuevo') {
        if (!customer || !branchId) return;
        await api('/quotes', {
          method: 'POST',
          json: { customer_id: customer.id, branch_id: branchId, valid_until: validUntil || undefined, notes: notes.trim() || undefined, items },
        });
        toast.success(`Presupuesto creado para ${customerName(customer)}`);
      } else if (modal) {
        await api(`/quotes/${modal.id}`, {
          method: 'PATCH',
          json: { valid_until: validUntil || null, notes: notes.trim() || null, items },
        });
        toast.success(`Presupuesto ${numero(modal)} guardado`);
      }
      setModal(null);
      load();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setGuardando(false);
    }
  }

  async function setStatus(q: Quote, status: string, aviso: string) {
    try {
      await api(`/quotes/${q.id}`, { method: 'PATCH', json: { status } });
      toast.success(aviso);
      load();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  async function convert(q: Quote) {
    const ok = await confirmar({
      title: `Convertir el presupuesto ${numero(q)} en factura`,
      message:
        q.status === 'accepted'
          ? 'Se crea un borrador de factura con los mismos ítems (todavía no se emite) y el presupuesto queda como facturado.'
          : 'El cliente todavía no aceptó este presupuesto. Se crea igual un borrador de factura con los mismos ítems y el presupuesto queda como facturado.',
      confirmLabel: 'Crear la factura',
      tone: 'primary',
    });
    if (!ok) return;
    try {
      await api(`/quotes/${q.id}/invoice`, { method: 'POST', json: {} });
      toast.success(`Borrador de factura creado a partir de ${numero(q)}: está en la pestaña Facturas`);
      load();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  async function remove(q: Quote) {
    const ok = await confirmar({
      title: `Borrar el borrador ${numero(q)}`,
      message: 'No se puede deshacer. Los presupuestos ya enviados no se borran: quedan como historial.',
      confirmLabel: 'Borrar',
    });
    if (!ok) return;
    try {
      await api(`/quotes/${q.id}`, { method: 'DELETE' });
      toast.success('Borrador borrado');
      load();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  async function openPdf(q: Quote) {
    try {
      const res = await fetch(`${API_URL}/api/v1/quotes/${q.id}/pdf`, { headers: { Authorization: `Bearer ${getToken() ?? ''}` } });
      if (!res.ok) throw new Error('No se pudo generar el PDF del presupuesto');
      const url = URL.createObjectURL(await res.blob());
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  const vencido = (q: Quote) => q.validUntil && !['invoiced', 'rejected'].includes(q.status) && new Date(q.validUntil) < new Date();

  return (
    <>
      <div className={tableCard}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 p-3">
          <select className={`${inputClass} max-w-[200px]`} value={estado} onChange={(e) => setEstado(e.target.value)}>
            <option value="">Todos los estados</option>
            <option value="draft">Borradores</option>
            <option value="sent">Enviados</option>
            <option value="accepted">Aceptados</option>
            <option value="rejected">Rechazados</option>
            <option value="invoiced">Facturados</option>
          </select>
          <Button variant="primary" onClick={openNuevo}>
            Nuevo presupuesto
          </Button>
        </div>
        <table className="tbl">
          <thead>
            <tr>
              <th>Número</th>
              <th>Cliente</th>
              <th className="text-right">Total</th>
              <th>Estado</th>
              <th>Válido hasta</th>
              <th>Fecha</th>
              <th>
                <span className="sr-only">Acciones</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {(rows ?? []).map((q) => {
              const st = statusOf(QUOTE_STATUS, q.status);
              return (
                <tr key={q.id} className="hover:bg-slate-50">
                  <td className="font-mono text-xs">{numero(q)}</td>
                  <td>{customerName(q.customer)}</td>
                  <td className="text-right tabular-nums">{money(q.total)}</td>
                  <td>
                    <span className="inline-flex items-center gap-1.5">
                      <Badge tone={st.tone}>{st.label}</Badge>
                      {vencido(q) && <Badge tone="red">vencido</Badge>}
                    </span>
                  </td>
                  <td>{q.validUntil ? new Date(q.validUntil).toLocaleDateString(undefined, { timeZone: 'UTC' }) : '—'}</td>
                  <td>{dt(q.createdAt)}</td>
                  <td className="text-right">
                    <span className="inline-flex flex-wrap justify-end gap-1">
                      <button className={buttonGhost} onClick={() => void openPdf(q)}>
                        PDF
                      </button>
                      {q.status === 'draft' && (
                        <>
                          <button className={buttonGhost} onClick={() => void openEditar(q)}>
                            Editar
                          </button>
                          <button className={buttonSoft} onClick={() => void setStatus(q, 'sent', 'Marcado como enviado al cliente')}>
                            Marcar enviado
                          </button>
                          <button className={buttonDanger} onClick={() => void remove(q)}>
                            Borrar
                          </button>
                        </>
                      )}
                      {q.status === 'sent' && (
                        <>
                          <button className={buttonSoft} onClick={() => void setStatus(q, 'accepted', 'Presupuesto aceptado')}>
                            Marcar aceptado
                          </button>
                          <button className={buttonGhost} onClick={() => void setStatus(q, 'rejected', 'Presupuesto rechazado')}>
                            Marcar rechazado
                          </button>
                          <button className={buttonGhost} onClick={() => void convert(q)}>
                            Facturar igual
                          </button>
                        </>
                      )}
                      {q.status === 'accepted' && (
                        <>
                          <button className={buttonSoft} onClick={() => void convert(q)}>
                            Facturar
                          </button>
                          <button className={buttonGhost} onClick={() => void setStatus(q, 'sent', 'Vuelve a enviado')}>
                            Volver a enviado
                          </button>
                        </>
                      )}
                      {q.status === 'rejected' && (
                        <button className={buttonGhost} onClick={() => void setStatus(q, 'sent', 'Vuelve a enviado: podés renegociar')}>
                          Reabrir
                        </button>
                      )}
                      {q.status === 'invoiced' && q.invoiceId && (
                        <button className={buttonSoft} onClick={() => onVerFactura(q.invoiceId!)}>
                          Ver factura
                        </button>
                      )}
                    </span>
                  </td>
                </tr>
              );
            })}
            {rows && rows.length === 0 && (
              <EmptyRow
                colSpan={7}
                action={
                  <Button variant="soft" onClick={openNuevo}>
                    Armar el primero
                  </Button>
                }
              >
                {estado ? 'Ningún presupuesto en ese estado.' : 'Todavía no hay presupuestos. Cotizá sin compromiso fiscal, mandá el PDF y, si el cliente acepta, convertilo en factura con un clic.'}
              </EmptyRow>
            )}
            {rows === null && <EmptyRow colSpan={7}>Cargando…</EmptyRow>}
          </tbody>
        </table>
      </div>

      {modal && (
        <Modal
          title={modal === 'nuevo' ? 'Nuevo presupuesto' : `Editar presupuesto ${numero(modal)}`}
          description="Sin valor fiscal: el cliente recibe un PDF. Si acepta, se convierte en factura con los mismos ítems."
          onClose={() => setModal(null)}
          size="xl"
        >
          <form className="space-y-3" onSubmit={(e) => void guardar(e)}>
            <div className="grid gap-3 md:grid-cols-3">
              <div className="md:col-span-2">
                <Field label="Cliente *">
                  {modal === 'nuevo' ? (
                    <CustomerPicker value={customer} onChange={setCustomer} autoFocus={!customer} />
                  ) : (
                    <p className="py-2 text-sm font-medium text-slate-800">{customer ? customerName(customer) : customerName(modal.customer)}</p>
                  )}
                </Field>
              </div>
              <Field label="Válido hasta (opcional)">
                <input className={inputClass} type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
              </Field>
            </div>
            <Field label="Observaciones (salen en el PDF)">
              <input className={inputClass} placeholder="Ej: precios válidos pagando el 50 % de seña" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
            <LineasEditor lines={lines} services={services} onChange={setLines} />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setModal(null)}>
                Volver
              </Button>
              <Button variant="primary" type="submit" loading={guardando} disabled={modal === 'nuevo' && !customer}>
                {modal === 'nuevo' ? 'Crear presupuesto' : 'Guardar'}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
