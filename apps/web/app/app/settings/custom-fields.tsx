'use client';

import { useCallback, useEffect, useState } from 'react';

import { api } from '../../../lib/api';
import type { CustomFieldDef } from '../../../lib/crm';
import { Field, buttonClass, buttonGhost, inputClass } from '../../../lib/ui';

const TYPES: { value: CustomFieldDef['fieldType']; label: string }[] = [
  { value: 'text', label: 'Texto' },
  { value: 'number', label: 'Numero' },
  { value: 'date', label: 'Fecha' },
  { value: 'boolean', label: 'Si / No' },
  { value: 'list', label: 'Lista de opciones' },
  { value: 'money', label: 'Monto (Gs)' },
  { value: 'url', label: 'Link' },
];

const EMPTY = { label: '', field_type: 'text' as CustomFieldDef['fieldType'], options: '', required: false };

/** code a partir del label: "Tipo de cabello" -> "tipo_de_cabello". */
function toCode(label: string): string {
  return label
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

/**
 * Ajustes → Campos del cliente: campos personalizados de la ficha (estilo
 * Bitrix). Solo root/admin pueden crear/editar; desactivar no borra datos.
 */
export function CustomFieldsSection({ onError }: { onError: (msg: string) => void }) {
  const [defs, setDefs] = useState<CustomFieldDef[]>([]);
  const [form, setForm] = useState(EMPTY);

  const load = useCallback(() => {
    void api<CustomFieldDef[]>('/custom-fields?entity=customer').then(setDefs).catch(() => undefined);
  }, []);
  useEffect(() => load(), [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const code = toCode(form.label);
    if (code.length < 2) {
      onError('El nombre del campo es muy corto');
      return;
    }
    try {
      await api('/custom-fields', {
        method: 'POST',
        json: {
          entity: 'customer',
          code,
          label: form.label.trim(),
          field_type: form.field_type,
          options: form.field_type === 'list' ? form.options.split(',').map((o) => o.trim()).filter(Boolean) : [],
          required: form.required,
        },
      });
      setForm(EMPTY);
      load();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Error');
    }
  }

  async function toggleActive(def: CustomFieldDef) {
    try {
      if (def.isActive) await api(`/custom-fields/${def.id}`, { method: 'DELETE' });
      else await api(`/custom-fields/${def.id}`, { method: 'PATCH', json: { is_active: true } });
      load();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Error');
    }
  }

  async function patch(def: CustomFieldDef, json: Record<string, unknown>) {
    try {
      await api(`/custom-fields/${def.id}`, { method: 'PATCH', json });
      load();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Error');
    }
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="font-medium">Campos del cliente</h2>
      <p className="mb-3 text-xs text-slate-500">
        Agrega campos propios a la ficha de tus clientes (ej: tipo de cabello, talle, obra social).
        Aparecen en la ficha de cada cliente. Desactivar un campo lo oculta sin borrar lo ya cargado.
      </p>

      <ul className="space-y-1">
        {defs.map((def) => (
          <li key={def.id} className={`flex flex-wrap items-center gap-2 rounded border border-slate-100 p-2 text-sm ${def.isActive ? '' : 'opacity-50'}`}>
            <input
              className="w-48 rounded border border-transparent px-1 py-0.5 hover:border-slate-200 focus:border-sky-400 focus:outline-none"
              defaultValue={def.label}
              onBlur={(e) => {
                const label = e.target.value.trim();
                if (label && label !== def.label) void patch(def, { label });
              }}
            />
            <span className="text-xs text-slate-400">{TYPES.find((t) => t.value === def.fieldType)?.label}</span>
            {def.fieldType === 'list' && (
              <input
                className="min-w-[160px] flex-1 rounded border border-transparent px-1 py-0.5 text-xs hover:border-slate-200 focus:border-sky-400 focus:outline-none"
                defaultValue={def.options.join(', ')}
                title="Opciones separadas por coma"
                onBlur={(e) => {
                  const options = e.target.value.split(',').map((o) => o.trim()).filter(Boolean);
                  if (options.length > 0 && options.join('|') !== def.options.join('|')) void patch(def, { options });
                }}
              />
            )}
            <label className="flex items-center gap-1 text-xs text-slate-500">
              <input type="checkbox" checked={def.required} onChange={(e) => void patch(def, { required: e.target.checked })} />
              obligatorio
            </label>
            <button type="button" className={`${buttonGhost} ml-auto`} onClick={() => void toggleActive(def)}>
              {def.isActive ? 'Desactivar' : 'Reactivar'}
            </button>
          </li>
        ))}
        {defs.length === 0 && <li className="text-sm text-slate-400">Sin campos propios todavia</li>}
      </ul>

      <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={(e) => void create(e)}>
        <div className="min-w-[200px] flex-1">
          <Field label="Nuevo campo">
            <input className={inputClass} placeholder="Ej: Tipo de cabello" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} required />
          </Field>
        </div>
        <Field label="Tipo">
          <select
            className={inputClass}
            value={form.field_type}
            onChange={(e) => setForm({ ...form, field_type: e.target.value as CustomFieldDef['fieldType'] })}
          >
            {TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </Field>
        {form.field_type === 'list' && (
          <div className="min-w-[200px] flex-1">
            <Field label="Opciones (separadas por coma)">
              <input className={inputClass} placeholder="liso, ondulado, rizado" value={form.options} onChange={(e) => setForm({ ...form, options: e.target.value })} required />
            </Field>
          </div>
        )}
        <label className="flex items-center gap-1 pb-2 text-sm">
          <input type="checkbox" checked={form.required} onChange={(e) => setForm({ ...form, required: e.target.checked })} />
          obligatorio
        </label>
        <button className={buttonClass}>Agregar campo</button>
      </form>
    </section>
  );
}
