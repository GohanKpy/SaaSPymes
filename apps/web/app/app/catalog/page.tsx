'use client';

import { useCallback, useEffect, useState } from 'react';

import { API_URL, ApiError, api, apiImageUrl, getToken } from '../../../lib/api';
import { useConfirm, useToast } from '../../../lib/feedback';
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
  inputClass,
  money,
  tableCard,
} from '../../../lib/ui';

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

// Los ids de foto son inmutables: el object URL se cachea por id y se
// reutiliza entre renders (evita re-descargar en cada carga de la tabla).
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

/** Catalogo tipado (ADR 0009 fase 2): el tipo vive en cada producto.
 *  Servicio = turno propio con su duracion; item = venta, con reunion
 *  inicial opcional que el bot coordina. La categoria solo aporta el
 *  tipo por defecto al crear. */
export default function CatalogPage() {
  const confirmar = useConfirm();
  const toast = useToast();
  const [categories, setCategories] = useState<Category[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    void api<Category[]>('/catalog/categories').then(setCategories).catch((e) => setError(String(e.message)));
    void api<Service[]>('/catalog/services').then(setServices).catch(() => undefined);
  }, []);
  useEffect(() => load(), [load]);

  function fail(e: unknown) {
    const fields =
      e instanceof ApiError && e.problem.errors ? ': ' + Object.keys(e.problem.errors).join(', ') : '';
    setError((e instanceof Error ? e.message : 'Error') + fields);
  }

  // ------------------------------ categorias ------------------------------

  const [newCat, setNewCat] = useState({ name: '', default_kind: 'servicio' as Kind });
  const [editingCat, setEditingCat] = useState<Category | null>(null);
  const [catForm, setCatForm] = useState({ name: '', default_kind: 'servicio' as Kind });

  async function createCategory(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api('/catalog/categories', { method: 'POST', json: newCat });
      setNewCat({ name: '', default_kind: 'servicio' });
      load();
    } catch (err) {
      fail(err);
    }
  }

  async function saveCategory(e: React.FormEvent) {
    e.preventDefault();
    if (!editingCat) return;
    setError(null);
    try {
      await api(`/catalog/categories/${editingCat.id}`, { method: 'PATCH', json: catForm });
      setEditingCat(null);
      load();
    } catch (err) {
      fail(err);
    }
  }

  async function removeCategory(c: Category) {
    const ok = await confirmar({
      title: `Eliminar la categoría "${c.name}"`,
      message: 'Solo se puede eliminar si no tiene productos activos; si los tiene, primero movelos o desactivalos.',
      confirmLabel: 'Eliminar',
    });
    if (!ok) return;
    setError(null);
    try {
      await api(`/catalog/categories/${c.id}`, { method: 'DELETE' });
      toast.success('Categoría eliminada');
      load();
    } catch (err) {
      fail(err);
    }
  }

  async function removeService(s: Service) {
    const ok = await confirmar({
      title: `Eliminar "${s.name}" del catálogo`,
      message: 'Los turnos y facturas que ya lo usaron no cambian. Si solo querés dejar de ofrecerlo un tiempo, mejor desactivalo desde Editar.',
      confirmLabel: 'Eliminar',
    });
    if (!ok) return;
    try {
      await api(`/catalog/services/${s.id}`, { method: 'DELETE' });
      toast.success('Producto eliminado');
      load();
    } catch (err) {
      fail(err);
    }
  }

  // ------------------------------- productos ------------------------------

  const emptySvc = {
    category_id: '',
    name: '',
    description: '',
    kind: 'servicio' as Kind,
    price: '',
    duration_min: '45',
    requires_meeting: true,
    meeting_min: '',
  };
  const [svc, setSvc] = useState(emptySvc);
  // Fotos elegidas ANTES de crear el producto: se suben apenas se crea
  // (pedido 2026-08-30: que el alta permita fotos igual que la edicion).
  const [newFotos, setNewFotos] = useState<File[]>([]);

  function pickNewFoto(file: File | undefined) {
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setError('La foto debe ser PNG, JPEG o WEBP');
      return;
    }
    if (file.size > 1_500_000) {
      setError('La foto no puede superar 1.5 MB (usa una version reducida)');
      return;
    }
    setNewFotos((prev) => (prev.length < 5 ? [...prev, file] : prev));
  }

  const fileToDataUrl = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('No se pudo leer la foto'));
      reader.readAsDataURL(file);
    });

  // El primer render toma el tipo por defecto de la primera categoria.
  useEffect(() => {
    const first = categories[0];
    if (first) setSvc((s) => (s.category_id ? s : { ...s, kind: first.defaultKind }));
  }, [categories]);

  // Al elegir categoria, el tipo salta a su default (editable despues).
  function pickCategory(categoryId: string) {
    const cat = categories.find((c) => c.id === categoryId);
    setSvc({ ...svc, category_id: categoryId, kind: cat?.defaultKind ?? 'servicio' });
  }

  async function createService(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const created = await api<{ id: string }>('/catalog/services', {
        method: 'POST',
        json: {
          category_id: svc.category_id || categories[0]?.id,
          name: svc.name,
          description: svc.description.trim() || undefined,
          kind: svc.kind,
          price: svc.price,
          ...(svc.kind === 'servicio'
            ? { duration_min: Number(svc.duration_min) || undefined }
            : {
                requires_meeting: svc.requires_meeting,
                meeting_min: Number(svc.meeting_min) || undefined,
              }),
        },
      });
      // Las fotos elegidas se suben recien ahora (el producto ya tiene id).
      for (const file of newFotos) {
        const data = await fileToDataUrl(file);
        await api(`/catalog/services/${created.id}/photos`, { method: 'POST', json: { data } });
      }
      setSvc({ ...svc, name: '', description: '', price: '' });
      setNewFotos([]);
      load();
    } catch (err) {
      fail(err);
    }
  }

  // ---------------- carga masiva por CSV (2026-08-30) ----------------

  interface ImportReport {
    ok: boolean;
    total_filas: number;
    a_crear: { linea: number; categoria: string; nombre: string; tipo: string; precio: string; detalle: string }[];
    errores: { linea: number; error: string }[];
    creados: number;
  }
  const [importPreview, setImportPreview] = useState<ImportReport | null>(null);
  const [importCsv, setImportCsv] = useState('');
  const [importBusy, setImportBusy] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);

  async function downloadTemplate() {
    setError(null);
    setImportMsg(null);
    try {
      const res = await fetch(`${API_URL}/api/v1/catalog/import/template`, {
        headers: { Authorization: `Bearer ${getToken() ?? ''}` },
      });
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
      setError(e instanceof Error ? e.message : 'Error');
    }
  }

  function onCsvFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setImportMsg(null);
    const reader = new FileReader();
    reader.onload = async () => {
      const csv = String(reader.result ?? '');
      setImportCsv(csv);
      setImportBusy(true);
      try {
        const report = await api<ImportReport>('/catalog/import', {
          method: 'POST',
          json: { csv, dry_run: true },
        });
        setImportPreview(report);
      } catch (e) {
        fail(e);
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
      const report = await api<ImportReport>('/catalog/import', {
        method: 'POST',
        json: { csv: importCsv, dry_run: false },
      });
      setImportPreview(null);
      setImportCsv('');
      setImportMsg(`✓ ${report.creados} producto${report.creados === 1 ? '' : 's'} importado${report.creados === 1 ? '' : 's'} al catalogo.`);
      load();
    } catch (e) {
      fail(e);
    } finally {
      setImportBusy(false);
    }
  }

  const [editing, setEditing] = useState<Service | null>(null);
  const [editPhotos, setEditPhotos] = useState<{ id: string; sort: number }[]>([]);
  const [edit, setEdit] = useState({
    category_id: '',
    name: '',
    description: '',
    kind: 'servicio' as Kind,
    price: '',
    duration_min: '',
    requires_meeting: true,
    meeting_min: '',
    is_active: true,
  });

  function openEdit(s: Service) {
    setEditing(s);
    setEditPhotos(s.photos ?? []);
    setEdit({
      category_id: s.categoryId,
      name: s.name,
      description: s.description ?? '',
      kind: s.kind,
      price: s.price,
      duration_min: s.durationMin ? String(s.durationMin) : '',
      requires_meeting: s.requiresMeeting,
      meeting_min: s.meetingMin ? String(s.meetingMin) : '',
      is_active: s.isActive,
    });
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setError(null);
    try {
      await api(`/catalog/services/${editing.id}`, {
        method: 'PATCH',
        json: {
          category_id: edit.category_id,
          name: edit.name,
          description: edit.description || undefined,
          kind: edit.kind,
          price: edit.price,
          is_active: edit.is_active,
          ...(edit.kind === 'servicio'
            ? { duration_min: Number(edit.duration_min) || null }
            : {
                requires_meeting: edit.requires_meeting,
                meeting_min: Number(edit.meeting_min) || null,
              }),
        },
      });
      setEditing(null);
      load();
    } catch (err) {
      fail(err);
    }
  }

  function onPhotoFile(file: File | undefined) {
    if (!editing || !file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setError('La foto debe ser PNG, JPEG o WEBP');
      return;
    }
    if (file.size > 1_500_000) {
      setError('La foto no puede superar 1.5 MB (usa una version reducida)');
      return;
    }
    const serviceId = editing.id;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const created = await api<{ id: string; sort: number }>(`/catalog/services/${serviceId}/photos`, {
          method: 'POST',
          json: { data: String(reader.result) },
        });
        setEditPhotos((prev) => [...prev, { id: created.id, sort: created.sort }]);
        load();
      } catch (err) {
        fail(err);
      }
    };
    reader.readAsDataURL(file);
  }

  async function removePhoto(photoId: string) {
    if (!editing) return;
    try {
      await api(`/catalog/services/${editing.id}/photos/${photoId}`, { method: 'DELETE' });
      setEditPhotos((prev) => prev.filter((p) => p.id !== photoId));
      load();
    } catch (err) {
      fail(err);
    }
  }

  const kindSelect = (value: Kind, onChange: (k: Kind) => void) => (
    <select className={inputClass} value={value} onChange={(e) => onChange(e.target.value as Kind)}>
      <option value="servicio">Servicio (se agenda como turno)</option>
      <option value="item">Ítem (producto o venta)</option>
    </select>
  );

  const svcCount = (categoryId: string) => services.filter((s) => s.categoryId === categoryId).length;

  return (
    <div className="space-y-5">
      {editingCat && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <form className="w-full max-w-sm space-y-3 rounded-xl bg-white p-5 shadow-xl" onSubmit={(e) => void saveCategory(e)}>
            <h3 className="font-semibold">Editar categoria</h3>
            <Field label="Nombre">
              <input className={inputClass} value={catForm.name} onChange={(e) => setCatForm({ ...catForm, name: e.target.value })} required />
            </Field>
            <Field label="Tipo por defecto de sus productos nuevos">
              {kindSelect(catForm.default_kind, (k) => setCatForm({ ...catForm, default_kind: k }))}
            </Field>
            <p className="text-xs text-slate-500">
              El tipo por defecto solo se aplica al crear un producto nuevo en esta categoria; los
              productos existentes no cambian.
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" className={buttonGhost} onClick={() => setEditingCat(null)}>
                Cancelar
              </button>
              <button className={buttonClass}>Guardar</button>
            </div>
          </form>
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/40 p-4">
          <form className="w-full max-w-md space-y-3 rounded-xl bg-white p-5 shadow-xl" onSubmit={(e) => void saveEdit(e)}>
            <h3 className="font-semibold">Editar producto</h3>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Nombre">
                <input className={inputClass} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} required />
              </Field>
              <Field label="Categoria">
                <select className={inputClass} value={edit.category_id} onChange={(e) => setEdit({ ...edit, category_id: e.target.value })}>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="Descripcion (el bot la usa para explicar el producto)">
              <textarea className={`${inputClass} h-20 text-sm`} value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Tipo">{kindSelect(edit.kind, (k) => setEdit({ ...edit, kind: k }))}</Field>
              <Field label="Precio (Gs, IVA incl.)">
                <input className={inputClass} value={edit.price} onChange={(e) => setEdit({ ...edit, price: e.target.value })} required />
              </Field>
            </div>
            {edit.kind === 'servicio' ? (
              <Field label="Duracion de la tarea (min; vacio = 30 por defecto)">
                <input className={inputClass} type="number" min="5" value={edit.duration_min} onChange={(e) => setEdit({ ...edit, duration_min: e.target.value })} />
              </Field>
            ) : (
              <div className="space-y-2 rounded border border-amber-200 bg-amber-50 p-3">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={edit.requires_meeting} onChange={(e) => setEdit({ ...edit, requires_meeting: e.target.checked })} />
                  El bot ofrece una reunion inicial para tratarlo
                </label>
                <Field label="Duracion de la reunion inicial (min; vacio = 30 por defecto)">
                  <input className={inputClass} type="number" min="5" value={edit.meeting_min} onChange={(e) => setEdit({ ...edit, meeting_min: e.target.value })} />
                </Field>
              </div>
            )}
            <div className="space-y-2">
              <p className="text-sm font-medium text-slate-700">
                Fotos <span className="font-normal text-slate-400">(max 5, PNG/JPEG/WEBP hasta 1.5 MB)</span>
              </p>
              <div className="flex flex-wrap gap-2">
                {editPhotos.map((p) => (
                  <div key={p.id} className="relative">
                    <PhotoThumb serviceId={editing.id} photoId={p.id} className="h-16 w-16 rounded border border-slate-200" />
                    <button
                      type="button"
                      title="Quitar foto"
                      className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-red-600 text-xs text-white"
                      onClick={() => void removePhoto(p.id)}
                    >
                      ×
                    </button>
                  </div>
                ))}
                {editPhotos.length < 5 && (
                  <label className="flex h-16 w-16 cursor-pointer items-center justify-center rounded border border-dashed border-slate-300 text-2xl text-slate-400 hover:border-sky-400 hover:text-sky-500">
                    +
                    <input
                      type="file"
                      className="hidden"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={(e) => {
                        onPhotoFile(e.target.files?.[0]);
                        e.target.value = '';
                      }}
                    />
                  </label>
                )}
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={edit.is_active} onChange={(e) => setEdit({ ...edit, is_active: e.target.checked })} />
              Activo (visible en catalogo y para el bot)
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" className={buttonGhost} onClick={() => setEditing(null)}>
                Cancelar
              </button>
              <button className={buttonClass}>Guardar cambios</button>
            </div>
          </form>
        </div>
      )}

      <PageHeader
        title="Catálogo"
        description="Servicios e ítems que ofrecés: el bot los consulta en vivo para responder precios y agendar."
      />
      <ErrorNote error={error} />

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Categorías" className="space-y-3">
          <table className="w-full text-sm">
            <thead className="text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              <tr>
                <th className="py-1">Nombre</th>
                <th>Tipo por defecto</th>
                <th>Productos</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {categories.map((c) => (
                <tr key={c.id} className="border-t border-slate-100">
                  <td className="py-1.5">{c.name}</td>
                  <td>
                    <KindBadge kind={c.defaultKind} />
                  </td>
                  <td>{svcCount(c.id)}</td>
                  <td className="space-x-1 py-1.5 text-right">
                    <button
                      className={buttonGhost}
                      onClick={() => {
                        setEditingCat(c);
                        setCatForm({ name: c.name, default_kind: c.defaultKind });
                      }}
                    >
                      Editar
                    </button>
                    <button className={buttonDanger} onClick={() => void removeCategory(c)}>
                      Eliminar
                    </button>
                  </td>
                </tr>
              ))}
              {categories.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-3 text-center text-slate-400">
                    Sin categorias: crea la primera para poder cargar productos.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <form className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3" onSubmit={(e) => void createCategory(e)}>
            <div className="grow">
              <Field label="Nueva categoria">
                <input className={inputClass} value={newCat.name} onChange={(e) => setNewCat({ ...newCat, name: e.target.value })} required />
              </Field>
            </div>
            <div className="grow">
              <Field label="Tipo por defecto">
                {kindSelect(newCat.default_kind, (k) => setNewCat({ ...newCat, default_kind: k }))}
              </Field>
            </div>
            <button className={buttonClass}>Crear</button>
          </form>
        </Card>

        <Card title="Nuevo producto">
        <form className="space-y-3" onSubmit={(e) => void createService(e)}>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Categoria">
              <select className={inputClass} value={svc.category_id || categories[0]?.id || ''} onChange={(e) => pickCategory(e.target.value)}>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Nombre">
              <input className={inputClass} value={svc.name} onChange={(e) => setSvc({ ...svc, name: e.target.value })} required />
            </Field>
            <Field label="Tipo">{kindSelect(svc.kind, (k) => setSvc({ ...svc, kind: k }))}</Field>
            <Field label="Precio (Gs, IVA incl.)">
              <input className={inputClass} value={svc.price} onChange={(e) => setSvc({ ...svc, price: e.target.value })} required />
            </Field>
          </div>
          {svc.kind === 'servicio' ? (
            <Field label="Duracion de la tarea (min)">
              <input className={inputClass} type="number" min="5" value={svc.duration_min} onChange={(e) => setSvc({ ...svc, duration_min: e.target.value })} />
            </Field>
          ) : (
            <div className="space-y-2 rounded border border-amber-200 bg-amber-50 p-3">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={svc.requires_meeting} onChange={(e) => setSvc({ ...svc, requires_meeting: e.target.checked })} />
                El bot ofrece una reunion inicial para tratarlo
              </label>
              <Field label="Duracion de la reunion inicial (min; vacio = 30 por defecto)">
                <input className={inputClass} type="number" min="5" value={svc.meeting_min} onChange={(e) => setSvc({ ...svc, meeting_min: e.target.value })} />
              </Field>
            </div>
          )}
          <Field label="Descripcion (el bot la usa para explicar el producto)">
            <textarea className={`${inputClass} h-16 text-sm`} value={svc.description} onChange={(e) => setSvc({ ...svc, description: e.target.value })} />
          </Field>
          <div>
            <p className="mb-1 text-sm font-medium text-slate-700">
              Fotos <span className="font-normal text-slate-400">(opcional, max 5 de hasta 1.5 MB; se suben al crear)</span>
            </p>
            <div className="flex flex-wrap gap-2">
              {newFotos.map((f, i) => (
                <div key={i} className="relative">
                  {/* preview local del archivo elegido */}
                  <img src={URL.createObjectURL(f)} alt="" className="h-16 w-16 rounded border border-slate-200 object-cover" />
                  <button
                    type="button"
                    title="Quitar foto"
                    className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-red-600 text-xs text-white"
                    onClick={() => setNewFotos((prev) => prev.filter((_, idx) => idx !== i))}
                  >
                    ×
                  </button>
                </div>
              ))}
              {newFotos.length < 5 && (
                <label className="flex h-16 w-16 cursor-pointer items-center justify-center rounded border border-dashed border-slate-300 text-2xl text-slate-400 hover:border-sky-400 hover:text-sky-500">
                  +
                  <input
                    type="file"
                    className="hidden"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={(e) => {
                      pickNewFoto(e.target.files?.[0]);
                      e.target.value = '';
                    }}
                  />
                </label>
              )}
            </div>
          </div>
          <button className={buttonClass} disabled={categories.length === 0}>
            Crear producto
          </button>
        </form>
        </Card>
      </div>

      {importPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/40 p-4">
          <div className="w-full max-w-2xl space-y-3 rounded-xl bg-white p-5 shadow-xl">
            <h3 className="font-semibold">Vista previa de la importacion</h3>
            {importPreview.errores.length > 0 && (
              <div className="max-h-48 space-y-1 overflow-y-auto rounded-md bg-red-50 p-3">
                <p className="text-sm font-medium text-red-700">
                  {importPreview.errores.length} problema{importPreview.errores.length === 1 ? '' : 's'} en el
                  archivo — corregilo en Excel y volvelo a subir (no se importo nada):
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
                <p className="text-sm text-slate-600">
                  {importPreview.errores.length === 0
                    ? `Se van a crear ${importPreview.a_crear.length} producto${importPreview.a_crear.length === 1 ? '' : 's'}:`
                    : `Filas correctas (se importan recien cuando el archivo no tenga errores):`}
                </p>
                <div className="max-h-64 overflow-y-auto rounded-md border border-slate-200">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Producto</th>
                        <th>Categoria</th>
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
            <div className="flex justify-end gap-2">
              <button type="button" className={buttonGhost} onClick={() => setImportPreview(null)}>
                {importPreview.ok ? 'Cancelar' : 'Cerrar'}
              </button>
              {importPreview.ok && (
                <button className={buttonClass} disabled={importBusy} onClick={() => void confirmImport()}>
                  {importBusy ? 'Importando…' : `Importar ${importPreview.a_crear.length} producto${importPreview.a_crear.length === 1 ? '' : 's'}`}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <Card
        title="Carga masiva desde Excel (CSV)"
        description="Para cargar muchos productos de una sola vez: descarga la plantilla, completala en Excel y subila. Antes de importar te mostramos exactamente que se va a crear."
      >
        {importMsg && <p className="mb-2 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{importMsg}</p>}
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className={buttonGhost} onClick={() => void downloadTemplate()} disabled={categories.length === 0}>
            1· Descargar plantilla CSV
          </button>
          <label
            className={`${buttonClass} cursor-pointer ${categories.length === 0 || importBusy ? 'pointer-events-none opacity-50' : ''}`}
          >
            {importBusy ? 'Revisando archivo…' : '2· Subir archivo completado'}
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
        </div>
        <p className="mt-2 text-xs text-slate-500">
          La plantilla se arma con TUS categorias ({categories.length === 0
            ? 'todavia no tenes ninguna: crea primero tus categorias aca arriba'
            : categories.map((c) => c.name).join(', ')}). Si te falta una categoria, creala arriba y
          descarga la plantilla de nuevo. Las filas de EJEMPLO se ignoran al importar; el precio va
          en guaranies sin decimales (150000 o 150.000) y el tipo puede quedar vacio (toma el de la
          categoria).
        </p>
      </Card>

      <div className={tableCard}>
        <table className="tbl">
          <thead>
            <tr>
              <th>Producto</th>
              <th>Categoria</th>
              <th>Tipo</th>
              <th className="text-right">Precio</th>
              <th>Duracion</th>
              <th>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {services.map((s) => (
              <tr key={s.id} className="hover:bg-slate-50">
                <td>
                  <span className="flex items-center gap-2">
                    {s.photos?.[0] ? (
                      <PhotoThumb serviceId={s.id} photoId={s.photos[0].id} className="h-8 w-8 rounded" />
                    ) : (
                      <span className="flex h-8 w-8 items-center justify-center rounded bg-slate-100 text-xs text-slate-300">—</span>
                    )}
                    {s.name}
                    {s.photos && s.photos.length > 1 && (
                      <span className="text-xs text-slate-400">+{s.photos.length - 1}</span>
                    )}
                  </span>
                </td>
                <td>{s.category.name}</td>
                <td>
                  <KindBadge kind={s.kind} />
                </td>
                <td className="text-right tabular-nums">{money(s.price)}</td>
                <td>
                  {s.kind === 'servicio'
                    ? `${s.durationMin ?? 30} min`
                    : s.requiresMeeting
                      ? `reunion ${s.meetingMin ?? 30} min`
                      : 'venta directa'}
                </td>
                <td>
                  <Badge tone={s.isActive ? 'emerald' : 'slate'}>{s.isActive ? 'activo' : 'inactivo'}</Badge>
                </td>
                <td className="text-right">
                  <span className="inline-flex gap-1">
                    <button className={buttonGhost} onClick={() => openEdit(s)}>
                      Editar
                    </button>
                    <button className={buttonDanger} onClick={() => void removeService(s)}>
                      Eliminar
                    </button>
                  </span>
                </td>
              </tr>
            ))}
            {services.length === 0 && <EmptyRow colSpan={7}>Sin productos cargados.</EmptyRow>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
