'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { ApiError, api } from '../../../lib/api';
import { SOURCES, sourceLabel } from '../../../lib/crm';
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
  tableCard,
} from '../../../lib/ui';

interface Customer {
  id: string;
  firstName: string;
  lastName: string | null;
  phoneE164: string | null;
  email: string | null;
  companyName: string | null;
  city: string | null;
  source: string | null;
  tags: string[];
  rating: number | null;
}

// Alta rapida con el minimo por defecto (nombre, apellido, celular, email);
// todo lo demas se completa en la ficha, que se abre al guardar.
const EMPTY = { first_name: '', last_name: '', phone_e164: '', email: '' };

export default function CustomersPage() {
  const router = useRouter();
  const [rows, setRows] = useState<Customer[]>([]);
  const [q, setQ] = useState('');
  const [source, setSource] = useState('');
  const [tag, setTag] = useState('');
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [duplicateId, setDuplicateId] = useState<string | null>(null);

  const load = useCallback((query: string, src: string, tg: string) => {
    const params = new URLSearchParams();
    if (query) params.set('q', query);
    if (src) params.set('source', src);
    if (tg) params.set('tag', tg);
    void api<{ data: Customer[] }>(`/customers?${params.toString()}`)
      .then((r) => setRows(r.data))
      .catch((e) => setError(String(e.message)));
  }, []);
  useEffect(() => load('', '', ''), [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDuplicateId(null);
    const clean = (v: string) => v.trim() || undefined;
    try {
      const created = await api<{ id: string }>('/customers', {
        method: 'POST',
        json: {
          first_name: form.first_name.trim(),
          last_name: clean(form.last_name),
          phone_e164: clean(form.phone_e164),
          email: clean(form.email),
        },
      });
      router.push(`/app/customers/${created.id}`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && typeof err.problem.detail === 'string') {
        setDuplicateId(err.problem.detail);
        setError(err.problem.title ?? 'Cliente duplicado');
      } else {
        setError(err instanceof Error ? err.message : 'Error');
      }
    }
  }

  async function remove(id: string) {
    if (!confirm('Desactivar este cliente?')) return;
    try {
      await api(`/customers/${id}`, { method: 'DELETE' });
      load(q, source, tag);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Clientes" description="Tu cartera completa: buscá, filtrá y entrá a la ficha de cada uno." />
      <ErrorNote error={error} />
      {duplicateId && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Ya existe un cliente con ese teléfono, email o documento.{' '}
          <Link className="font-medium underline" href={`/app/customers/${duplicateId}`}>
            Abrir su ficha
          </Link>
        </p>
      )}

      <Card
        title="Nuevo cliente"
        description="Solo el nombre es obligatorio; al guardar se abre la ficha completa."
      >
        <form className="grid grid-cols-2 gap-3 md:grid-cols-5" onSubmit={(e) => void create(e)}>
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
          <div className="flex items-end">
            <button className={buttonClass}>Agregar y abrir ficha</button>
          </div>
        </form>
      </Card>

      <div className={tableCard}>
        <div className="flex flex-wrap gap-2 border-b border-slate-100 p-3">
          <input
            className={`${inputClass} max-w-xs`}
            placeholder="Buscar por nombre, teléfono, documento, empresa…"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              load(e.target.value, source, tag);
            }}
          />
          <select
            className={`${inputClass} max-w-[180px]`}
            value={source}
            onChange={(e) => {
              setSource(e.target.value);
              load(q, e.target.value, tag);
            }}
          >
            <option value="">Origen: todos</option>
            {SOURCES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <input
            className={`${inputClass} max-w-[180px]`}
            placeholder="Etiqueta exacta"
            value={tag}
            onChange={(e) => {
              setTag(e.target.value);
              load(q, source, e.target.value.trim());
            }}
          />
        </div>
        <table className="tbl">
          <thead>
            <tr>
              <th>Nombre</th>
              <th>WhatsApp</th>
              <th>Email</th>
              <th>Origen</th>
              <th>Etiquetas</th>
              <th>Rating</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} className="hover:bg-slate-50">
                <td>
                  <Link className="font-medium text-sky-700 hover:underline" href={`/app/customers/${c.id}`}>
                    {c.firstName} {c.lastName}
                  </Link>
                  {c.companyName && <span className="block text-xs text-slate-400">{c.companyName}</span>}
                </td>
                <td>{c.phoneE164 ?? '—'}</td>
                <td>{c.email ?? '—'}</td>
                <td>{sourceLabel(c.source)}</td>
                <td>
                  <span className="flex flex-wrap gap-1">
                    {(c.tags ?? []).map((t) => (
                      <Badge key={t} tone="sky">
                        {t}
                      </Badge>
                    ))}
                  </span>
                </td>
                <td className="whitespace-nowrap text-amber-500">{c.rating ? '★'.repeat(c.rating) : '—'}</td>
                <td className="text-right">
                  <span className="inline-flex gap-1">
                    <Link className={buttonGhost} href={`/app/customers/${c.id}`}>
                      Ficha
                    </Link>
                    <button className={buttonDanger} onClick={() => void remove(c.id)}>
                      Desactivar
                    </button>
                  </span>
                </td>
              </tr>
            ))}
            {rows.length === 0 && <EmptyRow colSpan={7}>Sin clientes todavía</EmptyRow>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
