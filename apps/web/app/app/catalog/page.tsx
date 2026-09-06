'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { API_URL, api, apiImageUrl, getToken } from '../../../lib/api';
import { useConfirm, useToast } from '../../../lib/feedback';
import { errorMessage } from '../../../lib/labels';
import {
  Badge,
  Button,
  Card,
  EmptyRow,
  EmptyState,
  ErrorNote,
  Field,
  Modal,
  PageHeader,
  Tabs,
  buttonDanger,
  buttonGhost,
  inputClass,
  money,
  tableCard,
  useUrlParam,
} from '../../../lib/ui';

// Catalogo en tres vistas (fase 2 auditoria de paneles 2026-09-05): antes
// eran 14 tareas en una sola pantalla (73 botones con un catalogo mediano).
// Productos con buscador, filtros y activar/desactivar en la fila; Categorias
// con orden; Carga masiva con su flujo de vista previa intacto.

type Kind = 'servicio' | 'item';

interface Category {
  id: string;
  name: string;
  sortOrder: number;
  defaultKind: Kind;
}
interface Service {
  id: string;
  categoryId: string;
  name: string;
  description?: string | null;
  price: string;
  taxRate: number;
  kind: Kind;
  durationMin: number | null;
  requiresMeeting: boolean;
  meetingMin: number | null;
  isActive: boolean;
  category: { name: string };
  photos: { id: string; sort: number }[];
}

const KIND_LABEL: Record<Kind, string> = { servicio: 'Servicio', item: 'Ítem' };
const DURACION_DEFAULT = 30;

const photoCache = new Map<string, string>();

function PhotoThumb({ serviceId, photoId, className }: { serviceId: string; photoId: string; className: string }) {
  const [url, setUrl] = useState<string | null>(photoCache.get(photoId) ?? null);
  useEffect(() => {
    if (url) return;
    let alive = true;
    void apiImageUrl(`/catalog/services/${serviceId}/photos/${photoId}`)
      .then((u) => {
        photoCache.set(photoId, u);
        if (alive) setUrl(u);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [serviceId, photoId, url]);
  if (!url) return <div className={`${className} animate-pulse bg-slate-100`} />;
  // object URL local: <img> directo, next/image no aplica
  return <img src={url} alt="" className={`${className} object-cover`} />;
}

function KindBadge({ kind }: { kind: Kind }) {
  return <Badge tone={kind === 'servicio' ? 'sky' : 'amber'}>{KIND_LABEL[kind]}</Badge>;
}

const fileToDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('No se pudo leer la foto'));
    reader.readAsDataURL(file);
  });

function validarFoto(file: File): string | null {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return 'La foto tiene que ser PNG, JPEG o WEBP.';
  if (file.size > 1_500_000) return 'La foto no puede pesar más de 1,5 MB: achicala y volvé a subirla.';
  return null;
}

// ------------------------------ Producto (alta / edicion) ------------------------------

interface ProductoForm {
  category_id: string;
  name: string;
  description: string;
  kind: Kind;
  price: string;
  tax_rate: '10' | '5' | '0';
  duration_min: string;
  requires_meeting: boolean;
  meeting_min: string;
  is_active: boolean;
}

function ProductoModal({
  categories,
  initial,
  onClose,
  onSaved,
}: {
  categories: Category[];
  initial: Service | null;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const toast = useToast();
  const confirmar = useConfirm();
  const primera = categories[0];
  const [form, setForm] = useState<ProductoForm>(() =>
    initial
      ? {
          category_id: initial.categoryId,
          name: initial.name,
          description: initial.description ?? '',
          kind: initial.kind,
          price: initial.price,
          tax_rate: String(initial.taxRate) as ProductoForm['tax_rate'],
          duration_min: initial.durationMin ? String(initial.durationMin) : '',
          requires_meeting: initial.requiresMeeting,
          meeting_min: initial.meetingMin ? String(initial.meetingMin) : '',
          is_active: initial.isActive,
        }
      : {
          category_id: primera?.id ?? '',
          name: '',
          description: '',
          kind: primera?.defaultKind ?? 'servicio',
          price: '',
          tax_rate: '10',
          duration_min: '',
          requires_meeting: true,
          meeting_min: '',
          is_active: true,
        },
  );
  const [nuevasFotos, setNuevasFotos] = useState<File[]>([]);
  const [fotos, setFotos] = useState<{ id: string; sort: number }[]>(initial?.photos ?? []);
  const [guardando, setGuardando] = useState(false);
  const previews = useMemo(() => nuevasFotos.map((f) => URL.createObjectURL(f)), [nuevasFotos]);
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);

  function pickCategory(categoryId: string) {
    const cat = categories.find((c) => c.id === categoryId);
    setForm({ ...form, category_id: categoryId, kind: cat?.defaultKind ?? form.kind });
  }

  function agregarFoto(file: File | undefined) {
    if (!file) return;
    const problema = validarFoto(file);
    if (problema) {
      toast.error(problema);
      return;
    }
    if (fotos.length + nuevasFotos.length >= 5) {
      toast.error('Máximo 5 fotos por producto.');
      return;
    }
    if (!initial) {
      setNuevasFotos((prev) => [...prev, file]);
      return;
    }
    void fileToDataUrl(file).then((data) =>
      api<{ id: string; sort: number }>(`/catalog/services/${initial.id}/photos`, { method: 'POST', json: { data } })
        .then((created) => {
          setFotos((prev) => [...prev, created]);
          toast.success('Foto subida');
        })
        .catch((e) => toast.error(errorMessage(e))),
    );
  }

  async function quitarFoto(photoId: string) {
    if (!initial) return;
    const ok = await confirmar({ title: 'Quitar esta foto', message: 'Se borra del producto. No se puede deshacer.', confirmLabel: 'Quitar' });
    if (!ok) return;
    try {
      await api(`/catalog/services/${initial.id}/photos/${photoId}`, { method: 'DELETE' });
      setFotos((prev) => prev.filter((p) => p.id !== photoId));
      toast.success('Foto quitada');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setGuardando(true);
    const json = {
      category_id: form.category_id,
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      kind: form.kind,
      price: form.price.trim(),
      tax_rate: Number(form.tax_rate),
      ...(form.kind === 'servicio'
        ? { duration_min: Number(form.duration_min) || (initial ? null : undefined) }
        : { requires_meeting: form.requires_meeting, meeting_min: Number(form.meeting_min) || (initial ? null : undefined) }),
      ...(initial ? { is_active: form.is_active } : {}),
    };
    try {
      let id = initial?.id;
      if (initial) {
        await api(`/catalog/services/${initial.id}`, { method: 'PATCH', json });
      } else {
        const created = await api<{ id: string }>('/catalog/services', { method: 'POST', json });
        id = created.id;
        for (const file of nuevasFotos) {
          const data = await fileToDataUrl(file);
          await api(`/catalog/services/${created.id}/photos`, { method: 'POST', json: { data } });
        }
      }
      toast.success(initial ? 'Producto guardado' : `"${form.name.trim()}" agregado al catálogo`);
      onSaved(id!);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal
      title={initial ? `Editar "${initial.name}"` : 'Nuevo producto'}
      description={initial ? undefined : 'Un servicio se agenda con turno; un ítem es un producto o venta que el bot puede coordinar con una reunión.'}
      onClose={onClose}
      size="lg"
    >
      <form className="space-y-3" onSubmit={(e) => void save(e)}>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Nombre *">
            <input className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required autoFocus />
          </Field>
          <Field label="Categoría *">
            <select className={inputClass} value={form.category_id} onChange={(e) => pickCategory(e.target.value)} required>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Tipo">
            <select className={inputClass} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as Kind })}>
              <option value="servicio">Servicio (se agenda como turno)</option>
              <option value="item">Ítem (producto o venta)</option>
            </select>
          </Field>
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <Field label="Precio (Gs, con IVA) *">
              <input className={inputClass} inputMode="numeric" placeholder="150000" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} required />
            </Field>
            <Field label="IVA">
              <select className={inputClass} value={form.tax_rate} onChange={(e) => setForm({ ...form, tax_rate: e.target.value as ProductoForm['tax_rate'] })}>
                <option value="10">10%</option>
                <option value="5">5%</option>
                <option value="0">Exento</option>
              </select>
            </Field>
          </div>
        </div>
        {form.kind === 'servicio' ? (
          <Field label={`Duración del turno en minutos (vacío = ${DURACION_DEFAULT})`}>
            <input className={inputClass} type="number" min="5" step="5" placeholder={String(DURACION_DEFAULT)} value={form.duration_min} onChange={(e) => setForm({ ...form, duration_min: e.target.value })} />
          </Field>
        ) : (
          <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3">
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-0.5" checked={form.requires_meeting} onChange={(e) => setForm({ ...form, requires_meeting: e.target.checked })} />
              <span>
                <b>El bot ofrece una reunión inicial para tratarlo</b>
                <span className="block text-xs text-slate-600">Apagado: es venta directa; el bot informa el precio y solo agenda una reunión si el cliente la pide.</span>
              </span>
            </label>
            {form.requires_meeting && (
              <Field label={`Duración de la reunión en minutos (vacío = ${DURACION_DEFAULT})`}>
                <input className={inputClass} type="number" min="5" step="5" placeholder={String(DURACION_DEFAULT)} value={form.meeting_min} onChange={(e) => setForm({ ...form, meeting_min: e.target.value })} />
              </Field>
            )}
          </div>
        )}
        <Field label="Descripción (el bot la usa para explicar el producto)">
          <textarea className={`${inputClass} h-16`} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>
        <div>
          <p className="mb-1 text-sm font-medium text-slate-700">
            Fotos <span className="font-normal text-slate-400">(hasta 5, PNG/JPEG/WEBP de hasta 1,5 MB{initial ? '; se guardan al instante' : '; se suben al crear'})</span>
          </p>
          <div className="flex flex-wrap gap-2">
            {fotos.map((p) => (
              <div key={p.id} className="relative">
                <PhotoThumb serviceId={initial!.id} photoId={p.id} className="h-16 w-16 rounded border border-slate-200" />
                <button type="button" aria-label="Quitar foto" className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-red-600 text-xs text-white" onClick={() => void quitarFoto(p.id)}>
                  ×
                </button>
              </div>
            ))}
            {previews.map((u, i) => (
              <div key={u} className="relative">
                <img src={u} alt="" className="h-16 w-16 rounded border border-slate-200 object-cover" />
                <button type="button" aria-label="Quitar foto" className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-red-600 text-xs text-white" onClick={() => setNuevasFotos((prev) => prev.filter((_, idx) => idx !== i))}>
                  ×
                </button>
              </div>
            ))}
            {fotos.length + nuevasFotos.length < 5 && (
              <label className="flex h-16 w-16 cursor-pointer items-center justify-center rounded border border-dashed border-slate-300 text-2xl text-slate-400 hover:border-sky-400 hover:text-sky-500" title="Agregar foto">
                +
                <input
                  type="file"
                  className="hidden"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(e) => {
                    agregarFoto(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
              </label>
            )}
          </div>
        </div>
        {initial && (
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
            <span>
              <b>Activo</b>
              <span className="block text-xs text-slate-500">Visible en el catálogo y para el bot. Desactivalo para dejar de ofrecerlo sin borrarlo.</span>
            </span>
          </label>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Volver
          </Button>
          <Button variant="primary" type="submit" loading={guardando} disabled={!form.category_id}>
            {initial ? 'Guardar' : 'Crear producto'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ------------------------------ Categoria (alta / edicion) ------------------------------

function CategoriaModal({ initial, onClose, onSaved }: { initial: Category | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({ name: initial?.name ?? '', default_kind: (initial?.defaultKind ?? 'servicio') as Kind });
  const [guardando, setGuardando] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setGuardando(true);
    try {
      if (initial) await api(`/catalog/categories/${initial.id}`, { method: 'PATCH', json: form });
      else await api('/catalog/categories', { method: 'POST', json: form });
      toast.success(initial ? 'Categoría guardada' : `Categoría "${form.name.trim()}" creada`);
      onSaved();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal title={initial ? `Editar "${initial.name}"` : 'Nueva categoría'} onClose={onClose} size="sm">
      <form className="space-y-3" onSubmit={(e) => void save(e)}>
        <Field label="Nombre *">
          <input className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required autoFocus placeholder="Ej: Coloración" />
        </Field>
        <Field label="Tipo por defecto de sus productos nuevos">
          <select className={inputClass} value={form.default_kind} onChange={(e) => setForm({ ...form, default_kind: e.target.value as Kind })}>
            <option value="servicio">Servicio (se agenda como turno)</option>
            <option value="item">Ítem (producto o venta)</option>
          </select>
        </Field>
        <p className="text-xs text-slate-500">El tipo por defecto solo se aplica al crear un producto nuevo en esta categoría; los existentes no cambian.</p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Volver
          </Button>
          <Button variant="primary" type="submit" loading={guardando}>
            {initial ? 'Guardar' : 'Crear categoría'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ------------------------------------- pagina -------------------------------------

interface ImportReport {
  ok: boolean;
  total_filas: number;
  a_crear: { linea: number; categoria: string; nombre: string; tipo: string; precio: string; detalle: string }[];
  errores: { linea: number; error: string }[];
  creados: number;
}

export default function CatalogPage() {
  const confirmar = useConfirm();
  const toast = useToast();
  const [vista, setVista] = useUrlParam('vista', 'productos');
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [producto, setProducto] = useState<Service | null | 'nuevo'>(null);
  const [categoria, setCategoria] = useState<Category | null | 'nueva'>(null);
  const [highlight, setHighlight] = useState<string | null>(null);

  const [q, setQ] = useState('');
  const [fCat, setFCat] = useState('');
  const [fTipo, setFTipo] = useState('');
  const [fEstado, setFEstado] = useState<'activos' | 'inactivos' | 'todos'>('activos');

  const load = useCallback(() => {
    api<Category[]>('/catalog/categories')
      .then((c) => {
        setCategories([...c].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)));
        setError(null);
      })
      .catch((e) => setError(errorMessage(e, 'No se pudo cargar el catálogo.')));
    void api<Service[]>('/catalog/services').then(setServices).catch(() => undefined);
  }, []);
  useEffect(() => load(), [load]);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('nuevo') === '1') setProducto('nuevo');
  }, []);

  const visibles = useMemo(() => {
    const term = q.trim().toLowerCase();
    return services.filter(
      (s) =>
        (fEstado === 'todos' || (fEstado === 'activos') === s.isActive) &&
        (!fCat || s.categoryId === fCat) &&
        (!fTipo || s.kind === fTipo) &&
        (!term || s.name.toLowerCase().includes(term) || (s.description ?? '').toLowerCase().includes(term)),
    );
  }, [services, q, fCat, fTipo, fEstado]);

  const svcCount = (categoryId: string) => services.filter((s) => s.categoryId === categoryId && s.isActive).length;

  async function toggleActivo(s: Service) {
    try {
      await api(`/catalog/services/${s.id}`, { method: 'PATCH', json: { is_active: !s.isActive } });
      setServices((prev) => prev.map((x) => (x.id === s.id ? { ...x, isActive: !s.isActive } : x)));
      toast.success(s.isActive ? `"${s.name}" desactivado: el bot ya no lo ofrece` : `"${s.name}" activado`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  async function removeService(s: Service) {
    const ok = await confirmar({
      title: `Eliminar "${s.name}" del catálogo`,
      message: 'Los turnos y facturas que ya lo usaron no cambian. Si solo querés dejar de ofrecerlo un tiempo, mejor desactivalo.',
      confirmLabel: 'Eliminar',
    });
    if (!ok) return;
    try {
      await api(`/catalog/services/${s.id}`, { method: 'DELETE' });
      toast.success('Producto eliminado');
      load();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  async function removeCategory(c: Category) {
    const ok = await confirmar({
      title: `Eliminar la categoría "${c.name}"`,
      message: 'Solo se puede eliminar si no tiene productos activos; si los tiene, primero movelos o desactivalos.',
      confirmLabel: 'Eliminar',
    });
    if (!ok) return;
    try {
      await api(`/catalog/categories/${c.id}`, { method: 'DELETE' });
      toast.success('Categoría eliminada');
      load();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  /** Mueve una categoria un lugar y persiste el orden de todas (el orden manda tambien en la tabla y en lo que lee el bot). */
  async function mover(c: Category, delta: -1 | 1) {
    if (!categories) return;
    const idx = categories.findIndex((x) => x.id === c.id);
    const j = idx + delta;
    if (j < 0 || j >= categories.length) return;
    const nuevo = [...categories];
    [nuevo[idx], nuevo[j]] = [nuevo[j]!, nuevo[idx]!];
    setCategories(nuevo.map((x, i) => ({ ...x, sortOrder: i })));
    try {
      await Promise.all(
        nuevo.map((x, i) => (x.sortOrder !== i ? api(`/catalog/categories/${x.id}`, { method: 'PATCH', json: { sort_order: i } }) : Promise.resolve())),
      );
      load();
    } catch (e) {
      toast.error(errorMessage(e));
      load();
    }
  }

  // ------------------------------ carga masiva ------------------------------
  const [importPreview, setImportPreview] = useState<ImportReport | null>(null);
  const [importCsv, setImportCsv] = useState('');
  const [importBusy, setImportBusy] = useState(false);

  async function downloadTemplate() {
    try {
      const res = await fetch(`${API_URL}/api/v1/catalog/import/template`, { headers: { Authorization: `Bearer ${getToken() ?? ''}` } });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { title?: string };
        throw new Error(body.title ?? 'No se pudo generar la plantilla');
      }
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = 'plantilla-catalogo.csv';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  function onCsvFile(file: File | undefined) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const csv = String(reader.result ?? '');
      setImportCsv(csv);
      setImportBusy(true);
      try {
        setImportPreview(await api<ImportReport>('/catalog/import', { method: 'POST', json: { csv, dry_run: true } }));
      } catch (e) {
        toast.error(errorMessage(e));
      } finally {
        setImportBusy(false);
      }
    };
    reader.readAsText(file);
  }

  async function confirmImport() {
    if (!importPreview?.ok) return;
    setImportBusy(true);
    try {
      const report = await api<ImportReport>('/catalog/import', { method: 'POST', json: { csv: importCsv, dry_run: false } });
      setImportPreview(null);
      setImportCsv('');
      toast.success(`${report.creados} producto${report.creados === 1 ? '' : 's'} importado${report.creados === 1 ? '' : 's'} al catálogo`);
      setVista('productos');
      load();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setImportBusy(false);
    }
  }

  const sinCategorias = categories !== null && categories.length === 0;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Catálogo"
        description="Servicios e ítems que ofrecés, con precio: el bot los consulta en vivo para responder y agendar."
        actions={
          vista === 'categorias' ? (
            <Button variant="primary" onClick={() => setCategoria('nueva')}>
              Nueva categoría
            </Button>
          ) : (
            <Button variant="primary" onClick={() => setProducto('nuevo')} disabled={sinCategorias}>
              Nuevo producto
            </Button>
          )
        }
      />
      <ErrorNote error={error} />

      <Tabs
        value={vista}
        onChange={setVista}
        items={[
          { key: 'productos', label: 'Productos', count: services.filter((s) => s.isActive).length },
          { key: 'categorias', label: 'Categorías', count: categories?.length },
          { key: 'importar', label: 'Carga masiva' },
        ]}
      />

      {sinCategorias && vista !== 'categorias' && (
        <EmptyState
          title="Primero creá una categoría"
          description="Los productos se agrupan por categoría (ej: Peluquería, Coloración, Productos). El bot las usa para explicar qué ofrecés."
          action={
            <Button variant="primary" onClick={() => setCategoria('nueva')}>
              Crear la primera categoría
            </Button>
          }
        />
      )}

      {vista === 'productos' && !sinCategorias && (
        <div className={tableCard}>
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
            <input className={`${inputClass} max-w-xs`} placeholder="Buscar producto…" value={q} onChange={(e) => setQ(e.target.value)} />
            <select className={`${inputClass} max-w-[200px]`} value={fCat} onChange={(e) => setFCat(e.target.value)}>
              <option value="">Todas las categorías</option>
              {(categories ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <select className={`${inputClass} max-w-[160px]`} value={fTipo} onChange={(e) => setFTipo(e.target.value)}>
              <option value="">Servicios e ítems</option>
              <option value="servicio">Solo servicios</option>
              <option value="item">Solo ítems</option>
            </select>
            <select className={`${inputClass} max-w-[160px]`} value={fEstado} onChange={(e) => setFEstado(e.target.value as typeof fEstado)}>
              <option value="activos">Activos</option>
              <option value="inactivos">Desactivados</option>
              <option value="todos">Todos</option>
            </select>
          </div>
          <table className="tbl">
            <thead>
              <tr>
                <th>Producto</th>
                <th>Categoría</th>
                <th>Tipo</th>
                <th className="text-right">Precio</th>
                <th>IVA</th>
                <th>Duración</th>
                <th>Activo</th>
                <th>
                  <span className="sr-only">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((s) => (
                <tr key={s.id} className={`${highlight === s.id ? 'bg-emerald-50' : 'hover:bg-slate-50'} ${s.isActive ? '' : 'text-slate-400'}`}>
                  <td>
                    <span className="flex items-center gap-2">
                      {s.photos?.[0] ? (
                        <PhotoThumb serviceId={s.id} photoId={s.photos[0].id} className="h-8 w-8 rounded" />
                      ) : (
                        <span className="flex h-8 w-8 items-center justify-center rounded bg-slate-100 text-xs text-slate-300">—</span>
                      )}
                      <span>
                        <span className="font-medium text-slate-800">{s.name}</span>
                        {s.description && <span className="block max-w-[22rem] truncate text-xs text-slate-400">{s.description}</span>}
                      </span>
                      {s.photos && s.photos.length > 1 && <span className="text-xs text-slate-400">+{s.photos.length - 1}</span>}
                    </span>
                  </td>
                  <td>{s.category.name}</td>
                  <td>
                    <KindBadge kind={s.kind} />
                  </td>
                  <td className="text-right tabular-nums">{money(s.price)}</td>
                  <td className="text-xs text-slate-500">{s.taxRate === 0 ? 'exento' : `${s.taxRate}%`}</td>
                  <td className="text-xs">
                    {s.kind === 'servicio' ? `${s.durationMin ?? DURACION_DEFAULT} min` : s.requiresMeeting ? `reunión ${s.meetingMin ?? DURACION_DEFAULT} min` : 'venta directa'}
                  </td>
                  <td>
                    <label className="inline-flex items-center gap-1.5 text-xs">
                      <input type="checkbox" checked={s.isActive} onChange={() => void toggleActivo(s)} aria-label={s.isActive ? 'Desactivar' : 'Activar'} />
                      {s.isActive ? 'sí' : 'no'}
                    </label>
                  </td>
                  <td className="text-right">
                    <span className="inline-flex gap-1">
                      <button className={buttonGhost} onClick={() => setProducto(s)}>
                        Editar
                      </button>
                      <button className={buttonDanger} onClick={() => void removeService(s)}>
                        Eliminar
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
              {visibles.length === 0 && (
                <EmptyRow
                  colSpan={8}
                  action={
                    services.length === 0 ? (
                      <span className="flex gap-2">
                        <Button variant="soft" onClick={() => setProducto('nuevo')}>
                          Cargar el primero
                        </Button>
                        <Button variant="ghost" onClick={() => setVista('importar')}>
                          Importar desde Excel
                        </Button>
                      </span>
                    ) : (
                      <Button
                        variant="ghost"
                        onClick={() => {
                          setQ('');
                          setFCat('');
                          setFTipo('');
                          setFEstado('todos');
                        }}
                      >
                        Ver todos
                      </Button>
                    )
                  }
                >
                  {services.length === 0 ? 'Todavía no hay productos. Cargá uno a uno o importá tu lista desde Excel.' : 'Ningún producto coincide con los filtros.'}
                </EmptyRow>
              )}
            </tbody>
          </table>
        </div>
      )}

      {vista === 'categorias' && (
        <div className={tableCard}>
          <table className="tbl">
            <thead>
              <tr>
                <th className="w-20">Orden</th>
                <th>Nombre</th>
                <th>Tipo por defecto</th>
                <th>Productos activos</th>
                <th>
                  <span className="sr-only">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {(categories ?? []).map((c, i) => (
                <tr key={c.id} className="hover:bg-slate-50">
                  <td>
                    <span className="inline-flex gap-0.5">
                      <button className={`${buttonGhost} px-1.5 py-0.5`} aria-label="Subir" disabled={i === 0} onClick={() => void mover(c, -1)}>
                        ↑
                      </button>
                      <button className={`${buttonGhost} px-1.5 py-0.5`} aria-label="Bajar" disabled={i === (categories?.length ?? 0) - 1} onClick={() => void mover(c, 1)}>
                        ↓
                      </button>
                    </span>
                  </td>
                  <td className="font-medium text-slate-800">{c.name}</td>
                  <td>
                    <KindBadge kind={c.defaultKind} />
                  </td>
                  <td>{svcCount(c.id)}</td>
                  <td className="text-right">
                    <span className="inline-flex gap-1">
                      <button className={buttonGhost} onClick={() => setCategoria(c)}>
                        Editar
                      </button>
                      <button className={buttonDanger} onClick={() => void removeCategory(c)}>
                        Eliminar
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
              {categories && categories.length === 0 && (
                <EmptyRow
                  colSpan={5}
                  action={
                    <Button variant="soft" onClick={() => setCategoria('nueva')}>
                      Crear la primera categoría
                    </Button>
                  }
                >
                  Sin categorías todavía. Son las secciones de tu catálogo (ej: Peluquería, Coloración, Productos).
                </EmptyRow>
              )}
            </tbody>
          </table>
          {categories && categories.length > 0 && (
            <p className="border-t border-slate-100 px-3 py-2 text-xs text-slate-400">El orden de acá es el orden en que aparecen los productos en la tabla y en lo que el bot enumera.</p>
          )}
        </div>
      )}

      {vista === 'importar' && !sinCategorias && (
        <Card
          title="Carga masiva desde Excel (CSV)"
          description="Para cargar muchos productos de una sola vez: descargá la plantilla, completala en Excel y subila. Antes de importar te mostramos exactamente qué se va a crear; si hay un error, no se importa nada."
        >
          <ol className="space-y-3 text-sm">
            <li className="flex flex-wrap items-center gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold">1</span>
              <Button variant="ghost" onClick={() => void downloadTemplate()}>
                Descargar plantilla CSV
              </Button>
              <span className="text-xs text-slate-500">Se arma con tus categorías: {(categories ?? []).map((c) => c.name).join(', ')}. Si te falta una, creala en la pestaña Categorías y descargá la plantilla de nuevo.</span>
            </li>
            <li className="flex flex-wrap items-center gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold">2</span>
              <span className="text-slate-600">Completá una fila por producto en Excel. Las filas de EJEMPLO se ignoran; el precio va sin decimales (150000 o 150.000); el tipo puede quedar vacío (toma el de la categoría).</span>
            </li>
            <li className="flex flex-wrap items-center gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold">3</span>
              <label className={`inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 ${importBusy ? 'pointer-events-none opacity-50' : ''}`}>
                {importBusy ? 'Revisando el archivo…' : 'Subir el archivo completado'}
                <input
                  type="file"
                  className="hidden"
                  accept=".csv,text/csv"
                  onChange={(e) => {
                    onCsvFile(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
              </label>
              <span className="text-xs text-slate-500">Vas a ver la vista previa antes de confirmar.</span>
            </li>
          </ol>
        </Card>
      )}

      {producto && (
        <ProductoModal
          categories={categories ?? []}
          initial={producto === 'nuevo' ? null : producto}
          onClose={() => setProducto(null)}
          onSaved={(id) => {
            setProducto(null);
            setHighlight(id);
            setTimeout(() => setHighlight(null), 5000);
            setVista('productos');
            load();
          }}
        />
      )}
      {categoria && (
        <CategoriaModal
          initial={categoria === 'nueva' ? null : categoria}
          onClose={() => setCategoria(null)}
          onSaved={() => {
            setCategoria(null);
            load();
          }}
        />
      )}

      {importPreview && (
        <Modal title="Vista previa de la importación" onClose={() => setImportPreview(null)} size="xl">
          {importPreview.errores.length > 0 && (
            <div className="max-h-48 space-y-1 overflow-y-auto rounded-md bg-red-50 p-3">
              <p className="text-sm font-medium text-red-700">
                {importPreview.errores.length} problema{importPreview.errores.length === 1 ? '' : 's'} en el archivo. Corregilo en Excel y volvé a subirlo: no se importó nada.
              </p>
              <ul className="space-y-0.5 text-sm text-red-700">
                {importPreview.errores.map((e, i) => (
                  <li key={i}>
                    {e.linea > 0 ? `Fila ${e.linea}: ` : ''}
                    {e.error}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {importPreview.a_crear.length > 0 && (
            <>
              <p className="mt-2 text-sm text-slate-600">
                {importPreview.errores.length === 0
                  ? `Se van a crear ${importPreview.a_crear.length} producto${importPreview.a_crear.length === 1 ? '' : 's'}:`
                  : 'Filas correctas (se importan cuando el archivo ya no tenga errores):'}
              </p>
              <div className="mt-2 max-h-64 overflow-y-auto rounded-md border border-slate-200">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Producto</th>
                      <th>Categoría</th>
                      <th>Tipo</th>
                      <th className="text-right">Precio</th>
                      <th>Detalle</th>
                    </tr>
                  </thead>
                  <tbody>
                    {importPreview.a_crear.map((r) => (
                      <tr key={r.linea}>
                        <td>{r.nombre}</td>
                        <td>{r.categoria}</td>
                        <td>
                          <KindBadge kind={r.tipo as Kind} />
                        </td>
                        <td className="text-right tabular-nums">{money(r.precio)}</td>
                        <td className="text-xs text-slate-500">{r.detalle}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setImportPreview(null)}>
              {importPreview.ok ? 'Volver' : 'Cerrar'}
            </Button>
            {importPreview.ok && (
              <Button variant="primary" loading={importBusy} onClick={() => void confirmImport()}>
                Importar {importPreview.a_crear.length} producto{importPreview.a_crear.length === 1 ? '' : 's'}
              </Button>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
