'use client';

import { useCallback, useEffect, useState } from 'react';

import { api } from '../../../lib/api';
import { useToast } from '../../../lib/feedback';
import { errorMessage } from '../../../lib/labels';
import { MoneyInput } from '../../../lib/money-input';
import { Badge, Button, EmptyRow, Field, LoadMore, Modal, buttonGhost, inputClass, money, tableCard } from '../../../lib/ui';

// Inventario fase 1 (2026-09-14, ADR 0013): existencias por item y sucursal,
// ingresos, ajustes, traslados y kardex. Los combos muestran cuantas unidades
// se pueden armar con lo que hay de sus componentes.

interface Sucursal {
  id: string;
  name: string;
  isMain: boolean;
}
interface ItemStock {
  id: string;
  name: string;
  sku: string | null;
  unit: string;
  category: string;
  is_active: boolean;
  track_stock: boolean;
  is_combo: boolean;
  components: { service_id: string; name: string; quantity: number; track_stock: boolean }[];
  min_stock: number;
  cost: string;
  price: string;
  total: number;
  value: string | null;
  low: boolean;
  out: boolean;
  by_branch: { branch_id: string; branch: string; quantity: number }[];
}
interface Movimiento {
  id: string;
  created_at: string;
  service: string;
  branch: string;
  kind: string;
  quantity: number;
  unit_cost: string | null;
  balance_after: number;
  reference_type: string | null;
  note: string | null;
  by: string | null;
}
interface Ajustes {
  allow_negative_stock: boolean;
  low_stock_alerts: boolean;
}

export const KIND_LABEL: Record<string, string> = {
  initial: 'Carga inicial',
  purchase: 'Ingreso',
  sale: 'Venta',
  sale_reversal: 'Venta anulada',
  return: 'Devolución',
  adjustment: 'Ajuste',
  transfer_in: 'Traslado (entra)',
  transfer_out: 'Traslado (sale)',
};

const cant = (n: number) => new Intl.NumberFormat('es-PY', { maximumFractionDigits: 2 }).format(n);
const fecha = (iso: string) => new Date(iso).toLocaleString('es-PY', { dateStyle: 'short', timeStyle: 'short' });

export function InventarioSection() {
  const toast = useToast();
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [items, setItems] = useState<ItemStock[] | null>(null);
  const [resumen, setResumen] = useState<{ items: number; low: number; out: number; value: string } | null>(null);
  const [soloBajos, setSoloBajos] = useState(false);
  const [q, setQ] = useState('');
  const [ajustes, setAjustes] = useState<Ajustes | null>(null);
  const [modal, setModal] = useState<{ tipo: 'ingreso' | 'ajuste' | 'traslado' | 'kardex'; item: ItemStock } | null>(null);

  const load = useCallback(() => {
    void api<{ branches: Sucursal[]; items: ItemStock[]; summary: { items: number; low: number; out: number; value: string } }>(`/inventory/stock${soloBajos ? '?low_only=true' : ''}`)
      .then((r) => {
        setSucursales(r.branches);
        setItems(r.items);
        setResumen(r.summary);
      })
      .catch((e) => toast.error(errorMessage(e, 'No se pudo cargar el inventario.')));
  }, [soloBajos]);
  useEffect(load, [load]);
  useEffect(() => {
    void api<Ajustes>('/tenant/settings').then((s) => setAjustes({ allow_negative_stock: s.allow_negative_stock, low_stock_alerts: s.low_stock_alerts })).catch(() => undefined);
  }, []);

  async function cambiarAjuste(campo: keyof Ajustes, valor: boolean) {
    try {
      const r = await api<Ajustes>('/tenant/settings', { method: 'PUT', json: { [campo]: valor } });
      setAjustes({ allow_negative_stock: r.allow_negative_stock, low_stock_alerts: r.low_stock_alerts });
      toast.success('Cambio guardado');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  const visibles = (items ?? []).filter((i) => !q.trim() || i.name.toLowerCase().includes(q.trim().toLowerCase()) || (i.sku ?? '').toLowerCase().includes(q.trim().toLowerCase()));
  const varias = sucursales.length > 1;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <Field label="Buscar">
          <input className={inputClass} placeholder="Nombre o SKU" value={q} onChange={(e) => setQ(e.target.value)} />
        </Field>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input type="checkbox" checked={soloBajos} onChange={(e) => setSoloBajos(e.target.checked)} />
          Solo bajo mínimo o sin stock
        </label>
        {resumen && (
          <span className="ml-auto pb-2 text-xs text-slate-500">
            {resumen.items} producto{resumen.items === 1 ? '' : 's'} con stock controlado · {resumen.low} bajo mínimo · {resumen.out} sin stock · valor a costo {money(resumen.value)}
          </span>
        )}
      </div>

      {ajustes && (
        <div className="flex flex-wrap gap-6 rounded-xl border border-slate-200 bg-white p-3 text-sm shadow-sm">
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-0.5" checked={ajustes.allow_negative_stock} onChange={(e) => void cambiarAjuste('allow_negative_stock', e.target.checked)} />
            <span>
              Permitir vender sin stock
              <span className="block text-xs text-slate-500">Apagado (recomendado): una factura con ítems sin existencias no se emite hasta ingresar mercadería.</span>
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-0.5" checked={ajustes.low_stock_alerts} onChange={(e) => void cambiarAjuste('low_stock_alerts', e.target.checked)} />
            <span>
              Avisar por correo cuando un producto baja de su mínimo
              <span className="block text-xs text-slate-500">Va a los emails de aviso del negocio (Ajustes → Empresa).</span>
            </span>
          </label>
        </div>
      )}

      <div className={tableCard}>
        <table className="tbl">
          <thead>
            <tr>
              <th>Producto</th>
              <th>SKU</th>
              {varias && sucursales.map((s) => <th key={s.id} className="text-right">{s.name}</th>)}
              <th className="text-right">Stock</th>
              <th className="text-right">Mínimo</th>
              <th className="text-right">Costo</th>
              <th className="text-right">Valor</th>
              <th>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {visibles.map((i) => (
              <tr key={i.id} className={i.is_active ? 'hover:bg-slate-50' : 'text-slate-400'}>
                <td>
                  <span className="font-medium">{i.name}</span>
                  <span className="block text-xs text-slate-400">
                    {i.category} · {i.unit}
                    {i.is_combo && ` · combo: ${i.components.map((c) => `${cant(c.quantity)} ${c.name}`).join(' + ')}`}
                  </span>
                </td>
                <td className="text-xs text-slate-500">{i.sku ?? '—'}</td>
                {varias && sucursales.map((s) => <td key={s.id} className="text-right tabular-nums">{cant(i.by_branch.find((b) => b.branch_id === s.id)?.quantity ?? 0)}</td>)}
                <td className="text-right font-medium tabular-nums">{cant(i.total)}{i.is_combo && <span className="block text-[10px] font-normal text-slate-400">armables</span>}</td>
                <td className="text-right tabular-nums">{i.is_combo ? '—' : cant(i.min_stock)}</td>
                <td className="text-right tabular-nums">{i.is_combo ? '—' : money(i.cost)}</td>
                <td className="text-right tabular-nums">{i.value ? money(i.value) : '—'}</td>
                <td>
                  {i.out ? <Badge tone="red">sin stock</Badge> : i.low ? <Badge tone="amber">bajo mínimo</Badge> : <Badge tone="emerald">ok</Badge>}
                  {!i.is_active && <Badge tone="slate">inactivo</Badge>}
                </td>
                <td className="text-right">
                  <span className="inline-flex flex-wrap justify-end gap-1">
                    {!i.is_combo && (
                      <>
                        <button className={buttonGhost} onClick={() => setModal({ tipo: 'ingreso', item: i })}>
                          Ingresar
                        </button>
                        <button className={buttonGhost} onClick={() => setModal({ tipo: 'ajuste', item: i })}>
                          Ajustar
                        </button>
                        {varias && (
                          <button className={buttonGhost} onClick={() => setModal({ tipo: 'traslado', item: i })}>
                            Trasladar
                          </button>
                        )}
                      </>
                    )}
                    <button className={buttonGhost} onClick={() => setModal({ tipo: 'kardex', item: i })}>
                      Movimientos
                    </button>
                  </span>
                </td>
              </tr>
            ))}
            {items && visibles.length === 0 && (
              <EmptyRow colSpan={8 + (varias ? sucursales.length : 0)}>
                {items.length === 0
                  ? 'Ningún ítem controla stock todavía. En Productos, editá un ítem y tildá "Controlar stock".'
                  : 'Nada coincide con el filtro.'}
              </EmptyRow>
            )}
            {items === null && <EmptyRow colSpan={8}>Cargando…</EmptyRow>}
          </tbody>
        </table>
      </div>

      {modal && modal.tipo !== 'kardex' && (
        <MovimientoModal
          tipo={modal.tipo}
          item={modal.item}
          sucursales={sucursales}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            load();
          }}
        />
      )}
      {modal && modal.tipo === 'kardex' && <KardexModal item={modal.item} onClose={() => setModal(null)} />}
    </div>
  );
}

function MovimientoModal({
  tipo,
  item,
  sucursales,
  onClose,
  onSaved,
}: {
  tipo: 'ingreso' | 'ajuste' | 'traslado';
  item: ItemStock;
  sucursales: Sucursal[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const principal = sucursales.find((s) => s.isMain) ?? sucursales[0];
  const [branch, setBranch] = useState(principal?.id ?? '');
  const [destino, setDestino] = useState(sucursales.find((s) => s.id !== principal?.id)?.id ?? '');
  const [cantidad, setCantidad] = useState('');
  const [costo, setCosto] = useState('');
  const [modo, setModo] = useState<'contado' | 'diferencia'>('contado');
  const [nota, setNota] = useState('');
  const [busy, setBusy] = useState(false);
  const actual = item.by_branch.find((b) => b.branch_id === branch)?.quantity ?? 0;

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    const n = Number(cantidad.replace(',', '.'));
    if (!Number.isFinite(n)) {
      toast.error('Cantidad inválida.');
      return;
    }
    setBusy(true);
    try {
      if (tipo === 'ingreso') {
        await api('/inventory/entries', { method: 'POST', json: { service_id: item.id, branch_id: branch, quantity: n, ...(costo ? { unit_cost: costo } : {}), ...(nota.trim() ? { note: nota.trim() } : {}) } });
        toast.success(`Ingreso registrado: +${cant(n)} ${item.unit} de ${item.name}`);
      } else if (tipo === 'ajuste') {
        await api('/inventory/adjustments', { method: 'POST', json: { service_id: item.id, branch_id: branch, ...(modo === 'contado' ? { new_quantity: n } : { delta: n }), reason: nota.trim() } });
        toast.success('Ajuste registrado');
      } else {
        await api('/inventory/transfers', { method: 'POST', json: { service_id: item.id, from_branch_id: branch, to_branch_id: destino, quantity: n, ...(nota.trim() ? { note: nota.trim() } : {}) } });
        toast.success('Traslado registrado');
      }
      onSaved();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const titulo = tipo === 'ingreso' ? `Ingresar stock de ${item.name}` : tipo === 'ajuste' ? `Ajustar stock de ${item.name}` : `Trasladar ${item.name}`;
  return (
    <Modal
      title={titulo}
      description={
        tipo === 'ingreso'
          ? 'Compra o carga inicial. Con el costo unitario se actualiza el costo promedio del producto.'
          : tipo === 'ajuste'
            ? 'Conteo físico, rotura, vencimiento o pérdida. El motivo queda en el kardex.'
            : 'Sale de una sucursal y entra en la otra, en el mismo movimiento.'
      }
      onClose={onClose}
    >
      <form className="space-y-3" onSubmit={(e) => void guardar(e)}>
        {sucursales.length > 1 && (
          <Field label={tipo === 'traslado' ? 'Desde' : 'Sucursal'}>
            <select className={inputClass} value={branch} onChange={(e) => setBranch(e.target.value)}>
              {sucursales.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        {tipo === 'traslado' && (
          <Field label="Hacia">
            <select className={inputClass} value={destino} onChange={(e) => setDestino(e.target.value)}>
              {sucursales.filter((s) => s.id !== branch).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <p className="text-xs text-slate-500">
          Stock actual en esta sucursal: <span className="font-medium text-slate-700">{cant(actual)} {item.unit}</span>
        </p>
        {tipo === 'ajuste' && (
          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={modo === 'contado'} onChange={() => setModo('contado')} /> Cantidad real contada
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={modo === 'diferencia'} onChange={() => setModo('diferencia')} /> Diferencia (+/−)
            </label>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={tipo === 'ajuste' && modo === 'contado' ? `Cantidad real (${item.unit})` : `Cantidad (${item.unit})`}>
            <input className={inputClass} inputMode="decimal" value={cantidad} required autoFocus onChange={(e) => setCantidad(e.target.value)} />
          </Field>
          {tipo === 'ingreso' && (
            <Field label="Costo unitario (Gs, opcional)">
              <MoneyInput value={costo} onChange={setCosto} placeholder={money(item.cost)} />
            </Field>
          )}
        </div>
        <Field label={tipo === 'ajuste' ? 'Motivo *' : 'Nota (opcional)'}>
          <input className={inputClass} value={nota} required={tipo === 'ajuste'} maxLength={300} placeholder={tipo === 'ajuste' ? 'Ej: conteo mensual, rotura, vencido' : 'Ej: compra a proveedor X, remito 123'} onChange={(e) => setNota(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" type="button" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" type="submit" loading={busy}>
            Registrar
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function KardexModal({ item, onClose }: { item: ItemStock; onClose: () => void }) {
  const [rows, setRows] = useState<Movimiento[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const cargar = useCallback(
    async (c?: string | null) => {
      setBusy(true);
      try {
        const r = await api<{ data: Movimiento[]; next_cursor: string | null }>(`/inventory/movements?service_id=${item.id}${c ? `&cursor=${encodeURIComponent(c)}` : ''}`);
        setRows((prev) => (c ? [...(prev ?? []), ...r.data] : r.data));
        setCursor(r.next_cursor);
      } finally {
        setBusy(false);
      }
    },
    [item.id],
  );
  useEffect(() => void cargar(), [cargar]);
  return (
    <Modal title={`Movimientos de ${item.name}`} description="Kardex: cada entrada y salida con su saldo. Los movimientos no se editan ni se borran; un error se corrige con un ajuste." onClose={onClose} size="lg">
      <div className="max-h-[60vh] overflow-auto">
        <table className="tbl">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Tipo</th>
              <th>Sucursal</th>
              <th className="text-right">Cantidad</th>
              <th className="text-right">Saldo</th>
              <th>Detalle</th>
            </tr>
          </thead>
          <tbody>
            {(rows ?? []).map((m) => (
              <tr key={m.id}>
                <td className="whitespace-nowrap text-xs">{fecha(m.created_at)}</td>
                <td>{KIND_LABEL[m.kind] ?? m.kind}</td>
                <td className="text-xs">{m.branch}</td>
                <td className={`text-right tabular-nums ${m.quantity < 0 ? 'text-red-700' : 'text-emerald-700'}`}>{m.quantity > 0 ? '+' : ''}{cant(m.quantity)}</td>
                <td className="text-right tabular-nums">{cant(m.balance_after)}</td>
                <td className="text-xs text-slate-500">
                  {m.note ?? ''}
                  {m.unit_cost && ` · costo ${money(m.unit_cost)}`}
                  {m.by && ` · ${m.by}`}
                </td>
              </tr>
            ))}
            {rows && rows.length === 0 && <EmptyRow colSpan={6}>Sin movimientos todavía.</EmptyRow>}
          </tbody>
        </table>
      </div>
      <LoadMore nextCursor={cursor} loading={busy} onLoad={() => void cargar(cursor)} />
    </Modal>
  );
}
