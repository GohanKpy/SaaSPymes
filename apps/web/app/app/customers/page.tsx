'use client';

import { useCallback, useEffect, useState } from 'react';

import { api } from '../../../lib/api';
import { ErrorNote, Field, buttonClass, buttonGhost, inputClass } from '../../../lib/ui';

interface Customer {
  id: string;
  firstName: string;
  lastName: string | null;
  phoneE164: string | null;
  email: string | null;
  docType: string | null;
  docNumber: string | null;
}

const EMPTY = { first_name: '', last_name: '', phone_e164: '', email: '' };

export default function CustomersPage() {
  const [rows, setRows] = useState<Customer[]>([]);
  const [q, setQ] = useState('');
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((query: string) => {
    void api<{ data: Customer[] }>(`/customers?q=${encodeURIComponent(query)}`)
      .then((r) => setRows(r.data))
      .catch((e) => setError(String(e.message)));
  }, []);
  useEffect(() => load(''), [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api('/customers', {
        method: 'POST',
        json: {
          first_name: form.first_name,
          last_name: form.last_name || undefined,
          phone_e164: form.phone_e164 || undefined,
          email: form.email || undefined,
        },
      });
      setForm(EMPTY);
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

      <form className="grid grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-white p-4 md:grid-cols-5" onSubmit={(e) => void create(e)}>
        <Field label="Nombre">
          <input className={inputClass} value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} required />
        </Field>
        <Field label="Apellido">
          <input className={inputClass} value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} />
        </Field>
        <Field label="WhatsApp (+595…)">
          <input className={inputClass} value={form.phone_e164} onChange={(e) => setForm({ ...form, phone_e164: e.target.value })} placeholder="+595971234567" />
        </Field>
        <Field label="Email">
          <input className={inputClass} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </Field>
        <div className="flex items-end">
          <button className={buttonClass}>Agregar</button>
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
                <td>{c.docNumber ? `${c.docType} ${c.docNumber}` : '—'}</td>
                <td className="p-2 text-right">
                  <button className={buttonGhost} onClick={() => void remove(c.id)}>
                    Desactivar
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="p-4 text-center text-slate-400">
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
