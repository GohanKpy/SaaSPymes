'use client';

import { useCallback, useEffect, useState } from 'react';

import { api } from '../../../lib/api';
import { ErrorNote, Field, buttonClass, buttonGhost, inputClass, money } from '../../../lib/ui';

interface Category {
  id: string;
  name: string;
}
interface Service {
  id: string;
  name: string;
  description?: string | null;
  price: string;
  taxRate: number;
  durationMin: number | null;
  bookableByBot: boolean;
  isActive: boolean;
  category: { name: string };
}

export default function CatalogPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [catName, setCatName] = useState('');
  const [svc, setSvc] = useState({ category_id: '', name: '', price: '', duration_min: '45' });
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    void api<Category[]>('/catalog/categories').then(setCategories).catch((e) => setError(String(e.message)));
    void api<Service[]>('/catalog/services').then(setServices).catch(() => undefined);
  }, []);
  useEffect(() => load(), [load]);

  async function createCategory(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api('/catalog/categories', { method: 'POST', json: { name: catName } });
      setCatName('');
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  }

  // Edicion de un servicio existente (PATCH parcial).
  const [editing, setEditing] = useState<Service | null>(null);
  const [edit, setEdit] = useState({
    name: '',
    description: '',
    price: '',
    duration_min: '',
    bookable_by_bot: true,
    is_active: true,
  });

  function openEdit(s: Service) {
    setEditing(s);
    setEdit({
      name: s.name,
      description: s.description ?? '',
      price: s.price,
      duration_min: s.durationMin ? String(s.durationMin) : '',
      bookable_by_bot: s.bookableByBot,
      is_active: s.isActive,
    });
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    try {
      await api(`/catalog/services/${editing.id}`, {
        method: 'PATCH',
        json: {
          name: edit.name,
          description: edit.description || undefined,
          price: edit.price,
          duration_min: Number(edit.duration_min) || undefined,
          bookable_by_bot: edit.bookable_by_bot,
          is_active: edit.is_active,
        },
      });
      setEditing(null);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  }

  async function createService(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api('/catalog/services', {
        method: 'POST',
        json: {
          category_id: svc.category_id || categories[0]?.id,
          name: svc.name,
          price: svc.price,
          duration_min: Number(svc.duration_min) || undefined,
        },
      });
      setSvc({ ...svc, name: '', price: '' });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  }

  return (
    <div className="space-y-5">
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <form
            className="w-full max-w-md space-y-3 rounded-lg bg-white p-5 shadow-xl"
            onSubmit={(e) => void saveEdit(e)}
          >
            <h3 className="font-semibold">Editar servicio</h3>
            <Field label="Nombre">
              <input className={inputClass} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} required />
            </Field>
            <Field label="Descripcion (el bot la usa para explicar el servicio)">
              <textarea className={`${inputClass} h-20 text-sm`} value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Precio (Gs, IVA incl.)">
                <input className={inputClass} value={edit.price} onChange={(e) => setEdit({ ...edit, price: e.target.value })} required />
              </Field>
              <Field label="Duracion (min; vacio = 30 por defecto)">
                <input className={inputClass} type="number" min="5" value={edit.duration_min} onChange={(e) => setEdit({ ...edit, duration_min: e.target.value })} />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={edit.bookable_by_bot} onChange={(e) => setEdit({ ...edit, bookable_by_bot: e.target.checked })} />
              Agendable directo por el bot (destildado: el bot agenda una reunion inicial para tratarlo)
            </label>
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
      <h1 className="text-xl font-semibold">Catalogo</h1>
      <ErrorNote error={error} />

      <div className="grid gap-4 md:grid-cols-2">
        <form className="space-y-3 rounded-lg border border-slate-200 bg-white p-4" onSubmit={(e) => void createCategory(e)}>
          <h2 className="font-medium">Nueva categoria</h2>
          <Field label="Nombre">
            <input className={inputClass} value={catName} onChange={(e) => setCatName(e.target.value)} required />
          </Field>
          <button className={buttonClass}>Crear categoria</button>
        </form>

        <form className="space-y-3 rounded-lg border border-slate-200 bg-white p-4" onSubmit={(e) => void createService(e)}>
          <h2 className="font-medium">Nuevo servicio</h2>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Categoria">
              <select className={inputClass} value={svc.category_id} onChange={(e) => setSvc({ ...svc, category_id: e.target.value })}>
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
            <Field label="Precio (Gs, IVA incl.)">
              <input className={inputClass} type="number" min="0" value={svc.price} onChange={(e) => setSvc({ ...svc, price: e.target.value })} required />
            </Field>
            <Field label="Duracion (min)">
              <input className={inputClass} type="number" min="5" value={svc.duration_min} onChange={(e) => setSvc({ ...svc, duration_min: e.target.value })} />
            </Field>
          </div>
          <button className={buttonClass} disabled={categories.length === 0}>
            Crear servicio
          </button>
        </form>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="text-left text-slate-500">
            <tr>
              <th className="p-2">Servicio</th>
              <th>Categoria</th>
              <th>Precio</th>
              <th>Duracion</th>
              <th>Bot</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {services.map((s) => (
              <tr key={s.id} className="border-t border-slate-100">
                <td className="p-2">{s.name}</td>
                <td>{s.category.name}</td>
                <td>{money(s.price)}</td>
                <td>{s.durationMin ? `${s.durationMin} min` : '—'}</td>
                <td>{s.bookableByBot ? 'agendable' : 'no'}</td>
                <td className="space-x-1 p-2 text-right">
                  <button className={buttonGhost} onClick={() => openEdit(s)}>
                    Editar
                  </button>
                  <button
                    className="rounded border border-red-200 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50"
                    onClick={() => {
                      if (confirm(`¿Eliminar "${s.name}" del catalogo?`)) {
                        void api(`/catalog/services/${s.id}`, { method: 'DELETE' }).then(load);
                      }
                    }}
                  >
                    Eliminar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
