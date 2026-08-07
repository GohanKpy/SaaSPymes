'use client';

import { useCallback, useEffect, useState } from 'react';

import { api } from '../../../lib/api';
import { dvRuc } from '../../../lib/ruc';
import { ErrorNote, Field, buttonClass, buttonGhost, inputClass } from '../../../lib/ui';

interface Customer {
  id: string;
  firstName: string;
  lastName: string | null;
  phoneE164: string | null;
  email: string | null;
  docType: string | null;
  docNumber: string | null;
  rucDv: string | null;
  birthDate: string | null;
  address: string | null;
  notes: string | null;
  notifyWhatsapp: boolean;
  notifyEmail: boolean;
}

// Ficha completa de la agenda (doc 03 app.customers): solo el nombre es
// obligatorio; el resto se completa cuando el negocio lo tenga.
const EMPTY = {
  first_name: '',
  last_name: '',
  phone_e164: '',
  email: '',
  doc_type: '',
  doc_number: '',
  ruc_dv: '',
  birth_date: '',
  address: '',
  notes: '',
  notify_whatsapp: true,
  notify_email: false,
};
type FormState = typeof EMPTY;

function toForm(c: Customer): FormState {
  return {
    first_name: c.firstName,
    last_name: c.lastName ?? '',
    phone_e164: c.phoneE164 ?? '',
    email: c.email ?? '',
    doc_type: c.docType ?? '',
    doc_number: c.docNumber ?? '',
    ruc_dv: c.rucDv ?? '',
    birth_date: c.birthDate ? c.birthDate.slice(0, 10) : '',
    address: c.address ?? '',
    notes: c.notes ?? '',
    notify_whatsapp: c.notifyWhatsapp,
    notify_email: c.notifyEmail,
  };
}

export default function CustomersPage() {
  const [rows, setRows] = useState<Customer[]>([]);
  const [q, setQ] = useState('');
  const [form, setForm] = useState<FormState>(EMPTY);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback((query: string) => {
    void api<{ data: Customer[] }>(`/customers?q=${encodeURIComponent(query)}`)
      .then((r) => setRows(r.data))
      .catch((e) => setError(String(e.message)));
  }, []);
  useEffect(() => load(''), [load]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    const clean = (v: string) => v.trim() || undefined;
    const base = {
      first_name: form.first_name.trim(),
      last_name: clean(form.last_name),
      phone_e164: clean(form.phone_e164),
      email: clean(form.email),
      doc_type: clean(form.doc_type),
      doc_number: clean(form.doc_number),
      ruc_dv: form.doc_type === 'ruc' ? clean(form.ruc_dv) : undefined,
      birth_date: clean(form.birth_date),
      address: clean(form.address),
      notes: clean(form.notes),
      notify_whatsapp: form.notify_whatsapp,
      notify_email: form.notify_email,
    };
    try {
      if (editing) {
        // En edicion, vaciar un campo lo borra (null); en alta se omite.
        const patch = Object.fromEntries(
          Object.entries(base).map(([k, v]) => [k, v === undefined ? null : v]),
        );
        delete patch['first_name'];
        await api(`/customers/${editing}`, {
          method: 'PATCH',
          json: { first_name: base.first_name, ...patch },
        });
      } else {
        await api('/customers', { method: 'POST', json: base });
      }
      setForm(EMPTY);
      setEditing(null);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      load(q);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  }

  async function remove(id: string) {
    if (!confirm('Desactivar este cliente?')) return;
    try {
      await api(`/customers/${id}`, { method: 'DELETE' });
      load(q);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  }

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold">Clientes</h1>
      <ErrorNote error={error} />

      <form
        className={`grid grid-cols-2 gap-3 rounded-lg border bg-white p-4 md:grid-cols-4 ${editing ? 'border-sky-300' : 'border-slate-200'}`}
        onSubmit={(e) => void save(e)}
      >
        <div className="col-span-2 flex items-center justify-between md:col-span-4">
          <h2 className="text-sm font-medium">
            {editing ? 'Editar cliente' : 'Nuevo cliente'}{' '}
            <span className="font-normal text-slate-400">(solo el nombre es obligatorio)</span>
          </h2>
          {saved && <span className="text-sm text-emerald-600">✓ guardado</span>}
        </div>
        <Field label="Nombre *">
          <input className={inputClass} value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} required />
        </Field>
        <Field label="Apellido">
          <input className={inputClass} value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} />
        </Field>
        <Field label="Celular / WhatsApp">
          <input className={inputClass} placeholder="+595971234567" value={form.phone_e164} onChange={(e) => setForm({ ...form, phone_e164: e.target.value })} />
        </Field>
        <Field label="Email">
          <input className={inputClass} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </Field>
        <Field label="Tipo de documento">
          <select
            className={inputClass}
            value={form.doc_type}
            onChange={(e) => {
              const doc_type = e.target.value;
              setForm({
                ...form,
                doc_type,
                ruc_dv: doc_type === 'ruc' ? (dvRuc(form.doc_number) ?? '') : '',
              });
            }}
          >
            <option value="">—</option>
            <option value="ci">Cedula (CI)</option>
            <option value="ruc">RUC</option>
            <option value="pasaporte">Pasaporte</option>
          </select>
        </Field>
        <Field label="Numero de documento">
          <input
            className={inputClass}
            value={form.doc_number}
            onChange={(e) => {
              const doc_number = e.target.value;
              // DV automatico (modulo 11 SET): se recalcula con cada tecla.
              const ruc_dv = form.doc_type === 'ruc' ? (dvRuc(doc_number) ?? '') : form.ruc_dv;
              setForm({ ...form, doc_number, ruc_dv });
            }}
          />
        </Field>
        {form.doc_type === 'ruc' && (
          <Field label="DV (automatico)">
            <input className={`${inputClass} bg-slate-50`} readOnly value={form.ruc_dv} title="Se calcula solo con el algoritmo oficial de la SET" />
          </Field>
        )}
        <Field label="Fecha de nacimiento">
          <input className={inputClass} type="date" value={form.birth_date} onChange={(e) => setForm({ ...form, birth_date: e.target.value })} />
        </Field>
        <div className="col-span-2">
          <Field label="Direccion">
            <input className={inputClass} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </Field>
        </div>
        <div className="col-span-2">
          <Field label="Notas internas (alergias, preferencias, historial...)">
            <input className={inputClass} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </Field>
        </div>
        <div className="col-span-2 flex flex-wrap items-center gap-4 md:col-span-4">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.notify_whatsapp} onChange={(e) => setForm({ ...form, notify_whatsapp: e.target.checked })} />
            Acepta avisos por WhatsApp
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.notify_email} onChange={(e) => setForm({ ...form, notify_email: e.target.checked })} />
            Acepta avisos por email
          </label>
          <div className="ml-auto flex gap-2">
            {editing && (
              <button
                type="button"
                className={buttonGhost}
                onClick={() => {
                  setEditing(null);
                  setForm(EMPTY);
                }}
              >
                Cancelar
              </button>
            )}
            <button className={buttonClass}>{editing ? 'Guardar cambios' : 'Agregar cliente'}</button>
          </div>
        </div>
      </form>

      <div className="flex gap-2">
        <input
          className={`${inputClass} max-w-xs`}
          placeholder="Buscar por nombre, telefono, documento…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            load(e.target.value);
          }}
        />
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="text-left text-slate-500">
            <tr>
              <th className="p-2">Nombre</th>
              <th>WhatsApp</th>
              <th>Email</th>
              <th>Documento</th>
              <th>Nacimiento</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} className="border-t border-slate-100">
                <td className="p-2">
                  {c.firstName} {c.lastName}
                </td>
                <td>{c.phoneE164 ?? '—'}</td>
                <td>{c.email ?? '—'}</td>
                <td>
                  {c.docNumber
                    ? `${(c.docType ?? '').toUpperCase()} ${c.docNumber}${c.rucDv ? `-${c.rucDv}` : ''}`
                    : '—'}
                </td>
                <td>{c.birthDate ? new Date(c.birthDate).toLocaleDateString('es-PY', { timeZone: 'UTC' }) : '—'}</td>
                <td className="space-x-1 p-2 text-right">
                  <button
                    className={buttonGhost}
                    onClick={() => {
                      setEditing(c.id);
                      setForm(toForm(c));
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }}
                  >
                    Editar
                  </button>
                  <button className={buttonGhost} onClick={() => void remove(c.id)}>
                    Desactivar
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="p-4 text-center text-slate-400">
                  Sin clientes todavia
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
