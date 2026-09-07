'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

import { API_URL, api, getToken } from '../../../lib/api';
import { CustomerPicker, customerName, type PickedCustomer } from '../../../lib/customer-picker';
import { useAskText, useConfirm, useToast } from '../../../lib/feedback';
import { INVOICE_STATUS, errorMessage, statusOf } from '../../../lib/labels';
import {
  Badge,
  Button,
  EmptyRow,
  ErrorNote,
  Field,
  Modal,
  PageHeader,
  Tabs,
  buttonDanger,
  buttonGhost,
  buttonSoft,
  dt,
  inputClass,
  money,
  tableCard,
  useUrlParam,
} from '../../../lib/ui';

import { FacturarA, billingCompleto, billingPayload, documentoTexto, type BillingChoice } from './facturar-a';
import { LINEA_VACIA, LineasEditor, aItems, type Linea, type ServicioOption } from './lineas';
import { QuotesSection } from './quotes';

// Facturacion (fase 2 auditoria de paneles 2026-09-05): pestañas Facturas |
// Presupuestos; "Emitir" pregunta una vez (es lo unico irreversible);
// comprobante disponible desde aprobada (una venta a credito tambien tiene
// comprobante); factura con varios items y total con IVA a la vista; filtros
// (impagas, estado, cliente, fechas); detalle con items y pagos; borrar
// borrador; aviso real si falta configurar la facturacion electronica.

interface Invoice {
  id: string;
  status: string;
  docNumber: string | null;
  establishment: string | null;
  expeditionPoint: string | null;
  total: string;
  taxTotal?: string | null;
  createdAt: string;
  issuedAt?: string | null;
  customer: { id?: string; firstName: string; lastName: string | null; docType?: string | null; docNumber?: string | null; rucDv?: string | null };
  // A nombre de quien sale (2026-09-07); null en facturas viejas = el documento del cliente.
  billingName?: string | null;
  billingDocType?: string | null;
  billingDocNumber?: string | null;
  billingRucDv?: string | null;
  payments: { id?: string; amount: string; method?: string; createdAt?: string }[];
  items?: { description: string; quantity: string; unitPrice: string; lineTotal?: string; taxRate: number }[];
}

const pagado = (i: Invoice) => i.payments.reduce((s, p) => s + Number(p.amount), 0);
const saldo = (i: Invoice) => Number(i.total) - pagado(i);
const numeroFactura = (i: Invoice) => (i.docNumber ? `${i.establishment}-${i.expeditionPoint}-${i.docNumber}` : null);

const METODO: Record<string, string> = { efectivo: 'Efectivo', transferencia: 'Transferencia', tarjeta: 'Tarjeta', qr: 'QR', otro: 'Otro' };

/** "Razon social · RUC 80012345-7" con el snapshot de la factura, o el documento del cliente en facturas viejas. */
function receptor(i: Invoice): { nombre: string; documento: string } | null {
  if (i.billingDocNumber) return { nombre: i.billingName ?? customerName(i.customer), documento: documentoTexto(i.billingDocType, i.billingDocNumber, i.billingRucDv) };
  if (i.customer.docNumber) return { nombre: customerName(i.customer), documento: documentoTexto(i.customer.docType ?? 'ci', i.customer.docNumber, i.customer.rucDv) };
  return null;
}

export default function InvoicesPage() {
  const askText = useAskText();
  const confirmar = useConfirm();
  const toast = useToast();
  const [vista, setVista] = useUrlParam('vista', 'facturas');
  const [rows, setRows] = useState<Invoice[] | null>(null);
  const [services, setServices] = useState<ServicioOption[]>([]);
  const [branchId, setBranchId] = useState<string | undefined>(undefined);
  const [sifenOk, setSifenOk] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [fEstado, setFEstado] = useState('');
  const [fCliente, setFCliente] = useState<PickedCustomer | null>(null);
  const [fDesde, setFDesde] = useState('');
  const [fHasta, setFHasta] = useState('');

  const [nueva, setNueva] = useState(false);
  const [nuevaCliente, setNuevaCliente] = useState<PickedCustomer | null>(null);
  const [lines, setLines] = useState<Linea[]>([LINEA_VACIA]);
  const [billing, setBilling] = useState<BillingChoice>({ kind: 'none' });
  const [guardando, setGuardando] = useState(false);
  const [detalle, setDetalle] = useState<Invoice | null>(null);
  // Cambiar a nombre de quien sale un borrador (desde el detalle o al intentar emitir sin datos).
  const [receptorDe, setReceptorDe] = useState<Invoice | null>(null);
  const [receptorNuevo, setReceptorNuevo] = useState<BillingChoice>({ kind: 'none' });
  const [highlight, setHighlight] = useState<string | null>(null);

  const [paying, setPaying] = useState<Invoice | null>(null);
  const [payForm, setPayForm] = useState({ method: 'efectivo', recibido: '' });

  const [abrirPresupuesto, setAbrirPresupuesto] = useState(false);
  const [presupuestoCliente, setPresupuestoCliente] = useState<PickedCustomer | null>(null);

  const load = useCallback(() => {
    const params = new URLSearchParams({ limit: '100' });
    if (fEstado && fEstado !== 'impagas') params.set('status', fEstado);
    if (fEstado === 'impagas') params.set('status', 'approved');
    if (fCliente) params.set('customer_id', fCliente.id);
    api<Invoice[]>(`/invoices?${params.toString()}`)
      .then((r) => {
        setRows(r);
        setError(null);
      })
      .catch((e) => setError(errorMessage(e, 'No se pudieron cargar las facturas.')));
  }, [fEstado, fCliente]);

  useEffect(() => load(), [load]);
  useEffect(() => {
    void api<ServicioOption[]>('/catalog/services').then((s) => setServices(s.filter((x) => (x as { isActive?: boolean }).isActive !== false))).catch(() => undefined);
    void api<{ id: string; isMain?: boolean }[]>('/branches')
      .then((b) => setBranchId((b.find((x) => x.isMain) ?? b[0])?.id))
      .catch(() => undefined);
    // Solo el dueño puede leer integraciones; para los demas el aviso no aplica.
    void api<{ type: string; configured: boolean }[]>('/integrations')
      .then((rows) => setSifenOk(rows.some((i) => i.type === 'sifen' && i.configured)))
      .catch(() => setSifenOk(null));
  }, []);

  // Links desde otras pantallas: ?nueva=1&customer=&service= · ?factura=<id> · ?vista=presupuestos&nuevo=1&customer=
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const customerId = q.get('customer');
    const cargarCliente = customerId ? api<PickedCustomer>(`/customers/${customerId}`).catch(() => null) : Promise.resolve(null);
    if (q.get('nueva') === '1') {
      void cargarCliente.then((c) => {
        setNuevaCliente(c);
        // Desde la Agenda (turno con varios servicios): ?services=id1,id2; compatibilidad: ?service=
        const ids = (q.get('services') ?? q.get('service') ?? '').split(',').map((x) => x.trim()).filter(Boolean);
        setLines(ids.length ? ids.map((id) => ({ ...LINEA_VACIA, service_id: id })) : [LINEA_VACIA]);
        setNueva(true);
      });
    }
    if (q.get('nuevo') === '1' && q.get('vista') === 'presupuestos') {
      void cargarCliente.then((c) => {
        setPresupuestoCliente(c);
        setAbrirPresupuesto(true);
      });
    }
    const factura = q.get('factura');
    if (factura) void abrirDetalle(factura);
  }, []);

  const visibles = useMemo(() => {
    let r = rows ?? [];
    if (fEstado === 'impagas') r = r.filter((i) => i.status === 'approved' && saldo(i) > 0);
    if (fDesde) r = r.filter((i) => i.createdAt.slice(0, 10) >= fDesde);
    if (fHasta) r = r.filter((i) => i.createdAt.slice(0, 10) <= fHasta);
    return r;
  }, [rows, fEstado, fDesde, fHasta]);

  const resumen = useMemo(() => {
    const r = visibles;
    const total = r.filter((i) => i.status === 'approved').reduce((s, i) => s + Number(i.total), 0);
    const porCobrar = r.filter((i) => i.status === 'approved').reduce((s, i) => s + Math.max(0, saldo(i)), 0);
    return { total, porCobrar, cobrado: total - porCobrar };
  }, [visibles]);

  async function abrirDetalle(id: string) {
    try {
      setDetalle(await api<Invoice>(`/invoices/${id}`));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    if (!nuevaCliente || !branchId) return;
    const items = aItems(lines);
    if (items.length === 0) {
      toast.error('Agregá al menos un ítem a la factura.');
      return;
    }
    if (!billingCompleto(billing)) {
      toast.error('Falta a nombre de quién sale la factura: elegí una opción o cargá RUC o cédula y nombre.');
      return;
    }
    setGuardando(true);
    try {
      const created = await api<Invoice>('/invoices', {
        method: 'POST',
        json: { customer_id: nuevaCliente.id, branch_id: branchId, items, ...billingPayload(billing) },
      });
      toast.success(`Borrador creado para ${customerName(nuevaCliente)}. Revisalo y emitilo cuando esté listo.`);
      setNueva(false);
      setNuevaCliente(null);
      setBilling({ kind: 'none' });
      setLines([LINEA_VACIA]);
      setHighlight(created.id);
      setTimeout(() => setHighlight(null), 6000);
      setVista('facturas');
      load();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setGuardando(false);
    }
  }

  async function emitir(i: Invoice) {
    if (sifenOk === false) {
      toast.error('Antes de emitir hay que configurar la facturación electrónica en Ajustes.');
      return;
    }
    // Sin RUC o cedula no hay factura valida: se piden antes de emitir.
    const completa = i.items ? i : await api<Invoice>(`/invoices/${i.id}`).catch(() => i);
    if (!receptor(completa)) {
      toast.error('Falta a nombre de quién sale la factura. Cargá RUC o cédula y nombre.');
      abrirReceptor(completa);
      return;
    }
    const ok = await confirmar({
      title: `Emitir la factura de ${customerName(i.customer)} por ${money(i.total)}`,
      message: 'Toma el siguiente número correlativo y se declara electrónicamente. No se puede volver a borrador: después solo se anula (dentro de las 48 horas).',
      confirmLabel: 'Emitir factura',
      tone: 'primary',
    });
    if (!ok) return;
    try {
      const emitida = await api<Invoice>(`/invoices/${i.id}/issue`, { method: 'POST', json: {} });
      toast.success(`Factura ${numeroFactura(emitida) ?? ''} emitida`);
      setDetalle(null);
      load();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  function abrirReceptor(i: Invoice) {
    setReceptorNuevo({ kind: 'none' });
    setReceptorDe(i);
  }

  async function guardarReceptor() {
    if (!receptorDe) return;
    if (!billingCompleto(receptorNuevo)) {
      toast.error('Completá RUC o cédula y nombre.');
      return;
    }
    setGuardando(true);
    try {
      const updated = await api<Invoice>(`/invoices/${receptorDe.id}/billing`, { method: 'PATCH', json: billingPayload(receptorNuevo) });
      toast.success(`Factura a nombre de ${updated.billingName ?? customerName(updated.customer)}`);
      setReceptorDe(null);
      if (detalle && detalle.id === updated.id) setDetalle(updated);
      load();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setGuardando(false);
    }
  }

  async function borrar(i: Invoice) {
    const ok = await confirmar({ title: 'Borrar este borrador', message: 'Todavía no tiene número fiscal, así que se puede borrar sin dejar rastro.', confirmLabel: 'Borrar' });
    if (!ok) return;
    try {
      await api(`/invoices/${i.id}`, { method: 'DELETE' });
      toast.success('Borrador borrado');
      setDetalle(null);
      load();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  async function anular(i: Invoice) {
    const reason = await askText({
      title: `Anular la factura ${numeroFactura(i) ?? ''}`,
      message: 'La anulación queda registrada y no se puede deshacer. Solo se puede anular dentro de las 48 horas de emitida; después corresponde una nota de crédito.',
      label: 'Motivo de la anulación',
      placeholder: 'Ej: error en el cliente facturado',
      confirmLabel: 'Anular factura',
    });
    if (!reason) return;
    try {
      await api(`/invoices/${i.id}/cancel`, { method: 'POST', json: { reason } });
      toast.success('Factura anulada');
      setDetalle(null);
      load();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  async function abrirComprobante(i: Invoice) {
    try {
      const res = await fetch(`${API_URL}/api/v1/invoices/${i.id}/kude`, { headers: { Authorization: `Bearer ${getToken() ?? ''}` } });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { title?: string };
        throw new Error(body.title ?? 'No se pudo generar el comprobante');
      }
      const url = URL.createObjectURL(await res.blob());
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  function openPay(inv: Invoice) {
    setPaying(inv);
    setPayForm({ method: 'efectivo', recibido: String(saldo(inv)) });
  }

  async function confirmPay() {
    if (!paying) return;
    const debido = saldo(paying);
    const recibido = Number(payForm.recibido || 0);
    // Se registra lo adeudado (o menos si es parcial); el excedente en efectivo es vuelto.
    const amount = Math.min(recibido, debido);
    if (amount <= 0) return;
    setGuardando(true);
    try {
      await api(`/invoices/${paying.id}/payments`, { method: 'POST', json: { method: payForm.method, amount: String(amount) } });
      toast.success(amount >= debido ? 'Pago registrado: factura saldada' : `Pago parcial registrado: queda un saldo de ${money(debido - amount)}`);
      setPaying(null);
      setDetalle(null);
      load();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setGuardando(false);
    }
  }

  const vuelto = paying ? Math.max(0, Number(payForm.recibido || 0) - saldo(paying)) : 0;
  const parcial = paying ? Math.max(0, saldo(paying) - Number(payForm.recibido || 0)) : 0;

  const acciones = (i: Invoice, enDetalle = false) => (
    <span className={`inline-flex flex-wrap gap-1 ${enDetalle ? '' : 'justify-end'}`}>
      {i.status === 'draft' && (
        <>
          <button className={buttonSoft} onClick={() => void emitir(i)}>
            Emitir
          </button>
          <button className={buttonGhost} onClick={() => abrirReceptor(i)}>
            Facturar a…
          </button>
          <button className={buttonDanger} onClick={() => void borrar(i)}>
            Borrar
          </button>
        </>
      )}
      {i.status === 'approved' && saldo(i) > 0 && (
        <button className={buttonSoft} onClick={() => openPay(i)}>
          Registrar pago
        </button>
      )}
      {['approved', 'cancelled', 'credited'].includes(i.status) && (
        <button className={buttonGhost} onClick={() => void abrirComprobante(i)}>
          Comprobante (PDF)
        </button>
      )}
      {i.status === 'approved' && (
        <button className={buttonDanger} onClick={() => void anular(i)}>
          Anular
        </button>
      )}
    </span>
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Facturación"
        description="Facturas electrónicas y presupuestos. Una factura nace como borrador, se emite (toma número), se cobra y el cliente recibe su comprobante en PDF."
        actions={
          vista === 'facturas' ? (
            <Button
              variant="primary"
              onClick={() => {
                setNuevaCliente(null);
                setLines([LINEA_VACIA]);
                setNueva(true);
              }}
            >
              Nueva factura
            </Button>
          ) : undefined
        }
      />
      <ErrorNote error={error} />
      {sifenOk === false && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Todavía no cargaste los datos de facturación electrónica (timbrado, establecimiento y punto de expedición). Podés armar borradores, pero no emitir.{' '}
          <Link className="font-medium underline" href="/app/settings/facturacion">
            Configurarlos en Ajustes
          </Link>
        </p>
      )}

      <Tabs value={vista} onChange={setVista} items={[{ key: 'facturas', label: 'Facturas' }, { key: 'presupuestos', label: 'Presupuestos' }]} />

      {vista === 'facturas' && (
        <div className={tableCard}>
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
            <select className={`${inputClass} max-w-[190px]`} value={fEstado} onChange={(e) => setFEstado(e.target.value)}>
              <option value="">Todas</option>
              <option value="impagas">Impagas (con saldo)</option>
              <option value="draft">Borradores</option>
              <option value="approved">Aprobadas</option>
              <option value="cancelled">Anuladas</option>
              <option value="rejected">Rechazadas por SIFEN</option>
            </select>
            <div className="min-w-[260px] flex-1 md:max-w-sm">
              <CustomerPicker value={fCliente} onChange={setFCliente} allowCreate={false} placeholder="Filtrar por cliente…" />
            </div>
            <input type="date" className={`${inputClass} w-40`} value={fDesde} onChange={(e) => setFDesde(e.target.value)} aria-label="Desde" />
            <input type="date" className={`${inputClass} w-40`} value={fHasta} onChange={(e) => setFHasta(e.target.value)} aria-label="Hasta" />
            {(fEstado || fCliente || fDesde || fHasta) && (
              <button
                className="text-xs text-sky-700 hover:underline"
                onClick={() => {
                  setFEstado('');
                  setFCliente(null);
                  setFDesde('');
                  setFHasta('');
                }}
              >
                Limpiar filtros
              </button>
            )}
            <span className="ml-auto text-xs text-slate-500">
              Aprobadas en la lista: <b className="text-slate-700">{money(resumen.total)}</b> · cobrado {money(resumen.cobrado)} · por cobrar{' '}
              <b className={resumen.porCobrar > 0 ? 'text-amber-700' : 'text-slate-700'}>{money(resumen.porCobrar)}</b>
            </span>
          </div>
          <table className="tbl">
            <thead>
              <tr>
                <th>Número</th>
                <th>Cliente</th>
                <th className="text-right">Total</th>
                <th>Estado</th>
                <th>Fecha</th>
                <th>
                  <span className="sr-only">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((i) => {
                const st = statusOf(INVOICE_STATUS, i.status);
                return (
                  <tr key={i.id} className={`cursor-pointer ${highlight === i.id ? 'bg-emerald-50' : 'hover:bg-slate-50'}`} onClick={() => void abrirDetalle(i.id)}>
                    <td className="font-mono text-xs">{numeroFactura(i) ?? <span className="text-slate-400">sin número</span>}</td>
                    <td>
                      {customerName(i.customer)}
                      {i.billingName && i.billingName !== customerName(i.customer) && (
                        <span className="block text-xs text-slate-400">a nombre de {i.billingName}</span>
                      )}
                      {i.status === 'draft' && !i.billingDocNumber && <span className="block text-xs text-amber-700">falta RUC o cédula</span>}
                    </td>
                    <td className="text-right tabular-nums">{money(i.total)}</td>
                    <td>
                      <span className="inline-flex items-center gap-1.5">
                        <Badge tone={st.tone}>{st.label}</Badge>
                        {i.status === 'approved' && saldo(i) > 0 && <Badge tone="amber">saldo {money(saldo(i))}</Badge>}
                        {i.status === 'approved' && saldo(i) <= 0 && <Badge tone="emerald">pagada</Badge>}
                      </span>
                    </td>
                    <td>{dt(i.createdAt)}</td>
                    <td className="text-right" onClick={(e) => e.stopPropagation()}>
                      {acciones(i)}
                    </td>
                  </tr>
                );
              })}
              {rows && visibles.length === 0 && (
                <EmptyRow
                  colSpan={6}
                  action={
                    rows.length === 0 ? (
                      <Button
                        variant="soft"
                        onClick={() => {
                          setNuevaCliente(null);
                          setLines([LINEA_VACIA]);
                          setNueva(true);
                        }}
                      >
                        Crear la primera
                      </Button>
                    ) : undefined
                  }
                >
                  {rows.length === 0 ? 'Todavía no hay facturas. También podés cobrar directo desde la Agenda al marcar un turno como atendido.' : 'Ninguna factura coincide con los filtros.'}
                </EmptyRow>
              )}
              {rows === null && !error && <EmptyRow colSpan={6}>Cargando…</EmptyRow>}
            </tbody>
          </table>
        </div>
      )}

      {vista === 'presupuestos' && (
        <QuotesSection
          services={services}
          branchId={branchId}
          abrirNuevo={abrirPresupuesto}
          clientePrefill={presupuestoCliente}
          onVerFactura={(id) => {
            setVista('facturas');
            void abrirDetalle(id);
          }}
        />
      )}

      {nueva && (
        <Modal
          title="Nueva factura"
          description="Se crea como borrador: la revisás y la emitís cuando esté lista. El sistema calcula el IVA y el total."
          onClose={() => setNueva(false)}
          size="xl"
        >
          <form className="space-y-3" onSubmit={(e) => void crear(e)}>
            <Field label="Cliente *">
              <CustomerPicker value={nuevaCliente} onChange={setNuevaCliente} autoFocus={!nuevaCliente} />
            </Field>
            <FacturarA customer={nuevaCliente} value={billing} onChange={setBilling} />
            <LineasEditor lines={lines} services={services} onChange={setLines} />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setNueva(false)}>
                Volver
              </Button>
              <Button variant="primary" type="submit" loading={guardando} disabled={!nuevaCliente || !billingCompleto(billing)}>
                Crear borrador
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {detalle && (
        <Modal
          title={numeroFactura(detalle) ? `Factura ${numeroFactura(detalle)}` : 'Borrador de factura'}
          description={`${customerName(detalle.customer)} · ${dt(detalle.createdAt)}`}
          onClose={() => setDetalle(null)}
          size="lg"
        >
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Badge tone={statusOf(INVOICE_STATUS, detalle.status).tone}>{statusOf(INVOICE_STATUS, detalle.status).label}</Badge>
            {detalle.status === 'approved' && saldo(detalle) > 0 && <Badge tone="amber">saldo {money(saldo(detalle))}</Badge>}
            {detalle.status === 'approved' && saldo(detalle) <= 0 && <Badge tone="emerald">pagada</Badge>}
          </div>
          {(() => {
            const r = receptor(detalle);
            return (
              <p className={`mb-3 rounded-md px-3 py-2 text-sm ${r ? 'bg-slate-50 text-slate-700' : 'border border-amber-200 bg-amber-50 text-amber-900'}`}>
                <span className="text-xs uppercase tracking-wide text-slate-400">Facturada a </span>
                {r ? (
                  <>
                    <b>{r.nombre}</b> <span className="text-slate-500">· {r.documento}</span>
                  </>
                ) : (
                  <>Falta RUC o cédula y nombre. Sin eso no se puede emitir.</>
                )}
                {detalle.status === 'draft' && (
                  <button type="button" className="ml-2 text-sky-700 hover:underline" onClick={() => abrirReceptor(detalle)}>
                    {r ? 'Cambiar' : 'Cargar datos'}
                  </button>
                )}
              </p>
            );
          })()}
          <table className="tbl">
            <thead>
              <tr>
                <th>Ítem</th>
                <th className="text-right">Cant.</th>
                <th className="text-right">Precio</th>
                <th className="text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {(detalle.items ?? []).map((it, idx) => (
                <tr key={idx}>
                  <td>
                    {it.description}
                    <span className="ml-1 text-xs text-slate-400">{it.taxRate === 0 ? 'exento' : `IVA ${it.taxRate}%`}</span>
                  </td>
                  <td className="text-right tabular-nums">{Number(it.quantity)}</td>
                  <td className="text-right tabular-nums">{money(it.unitPrice)}</td>
                  <td className="text-right tabular-nums">{money(it.lineTotal ?? Number(it.unitPrice) * Number(it.quantity))}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3} className="text-right text-sm text-slate-500">
                  {detalle.taxTotal ? `IVA incluido ${money(detalle.taxTotal)} · ` : ''}Total
                </td>
                <td className="text-right font-semibold tabular-nums">{money(detalle.total)}</td>
              </tr>
            </tfoot>
          </table>
          {detalle.payments.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Pagos</p>
              <ul className="mt-1 divide-y divide-slate-100 text-sm">
                {detalle.payments.map((p, idx) => (
                  <li key={p.id ?? idx} className="flex justify-between py-1">
                    <span>
                      {METODO[p.method ?? ''] ?? p.method ?? 'Pago'}
                      {p.createdAt ? <span className="text-slate-400"> · {dt(p.createdAt)}</span> : null}
                    </span>
                    <span className="tabular-nums">{money(p.amount)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={() => setDetalle(null)}>
              Cerrar
            </Button>
            {acciones(detalle, true)}
          </div>
        </Modal>
      )}

      {receptorDe && (
        <Modal
          title="A nombre de quién sale la factura"
          description={`Borrador de ${customerName(receptorDe.customer)}. Elegí una identidad guardada en su ficha o cargá otra.`}
          onClose={() => setReceptorDe(null)}
        >
          <div className="space-y-3">
            <FacturarA customer={{ id: receptorDe.customer.id ?? '' }} value={receptorNuevo} onChange={setReceptorNuevo} />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setReceptorDe(null)}>
                Volver
              </Button>
              <Button variant="primary" loading={guardando} disabled={!billingCompleto(receptorNuevo)} onClick={() => void guardarReceptor()}>
                Guardar
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {paying && (
        <Modal title="Registrar pago" description={`${numeroFactura(paying) ?? 'Factura'} · ${customerName(paying.customer)} · saldo a cobrar ${money(saldo(paying))}`} onClose={() => setPaying(null)} size="sm">
          <div className="space-y-3">
            <Field label="Forma de pago">
              <select className={inputClass} value={payForm.method} onChange={(e) => setPayForm({ ...payForm, method: e.target.value })}>
                {Object.entries(METODO).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Monto recibido (Gs)">
              <input className={inputClass} type="number" min={0} step={1000} value={payForm.recibido} onChange={(e) => setPayForm({ ...payForm, recibido: e.target.value })} autoFocus />
            </Field>
            {vuelto > 0 && (
              <p className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-800">
                Vuelto a entregar: <b>{money(vuelto)}</b>
              </p>
            )}
            {parcial > 0 && (
              <p className="rounded bg-sky-50 px-3 py-2 text-sm text-sky-800">
                Pago parcial: quedará un saldo de <b>{money(parcial)}</b>
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setPaying(null)}>
                Volver
              </Button>
              <Button variant="primary" loading={guardando} disabled={Number(payForm.recibido || 0) <= 0} onClick={() => void confirmPay()}>
                Confirmar pago
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
