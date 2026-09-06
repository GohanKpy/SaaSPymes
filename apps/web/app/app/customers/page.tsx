'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { ApiError, api } from '../../../lib/api';
import { SOURCES, sourceLabel } from '../../../lib/crm';
import { useConfirm, useToast } from '../../../lib/feedback';
import { errorMessage } from '../../../lib/labels';
import {
  Badge,
  Button,
  EmptyRow,
  ErrorNote,
  Field,
  LoadMore,
  Modal,
  PageHeader,
  buttonDanger,
  inputClass,
  tableCard,
} from '../../../lib/ui';

// Clientes (fase 1 auditoria de paneles 2026-09-05): la lista primero, el
// alta en una ventana, "cargar mas" (antes habia un tope invisible de 50) y
// las etiquetas como filtro de un clic.

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

const EMPTY = { first_name: '', last_name: '', phone_e164: '', email: '' };
const PAGE = 50;

export default function CustomersPage() {
  const confirmar = useConfirm();
  const toast = useToast();
  const router = useRouter();
  const [rows, setRows] = useState<Customer[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [q, setQ] = useState('');
  const [source, setSource] = useState('');
  const [tag, setTag] = useState('');
  const [error, setError] = useState<string | null>(null);

  const [nuevo, setNuevo] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [guardando, setGuardando] = useState(false);
  const [duplicateId, setDuplicateId] = useState<string | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const query = useCallback(
    (cursor?: string) => {
      const params = new URLSearchParams({ limit: String(PAGE) });
      if (q.trim()) params.set('q', q.trim());
      if (source) params.set('source', source);
      if (tag.trim()) params.set('tag', tag.trim());
      if (cursor) params.set('cursor', cursor);
      return api<{ data: Customer[]; next_cursor: string | null }>(`/customers?${params.toString()}`);
    },
    [q, source, tag],
  );

  const load = useCallback(() => {
    query()
      .then((r) => {
        setRows(r.data);
        setNextCursor(r.next_cursor);
        setError(null);
      })
      .catch((e) => setError(errorMessage(e, 'No se pudo cargar la lista de clientes.')));
  }, [query]);

  // Una consulta por pausa al escribir, no por tecla.
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(load, 250);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [load]);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('nuevo') === '1') setNuevo(true);
  }, []);

  async function loadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const r = await query(nextCursor);
      setRows((prev) => [...(prev ?? []), ...r.data]);
      setNextCursor(r.next_cursor);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setLoadingMore(false);
    }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setDuplicateId(null);
    setGuardando(true);
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
      toast.success('Cliente creado: completá su ficha cuando quieras');
      router.push(`/app/customers/${created.id}`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && typeof err.problem.detail === 'string') {
        setDuplicateId(err.problem.detail);
      } else {
        toast.error(errorMessage(err));
      }
    } finally {
      setGuardando(false);
    }
  }

  async function remove(c: Customer) {
    const ok = await confirmar({
      title: `Desactivar a ${c.firstName} ${c.lastName ?? ''}`.trim(),
      message: 'Deja de aparecer en las listas y el bot no lo usa. Su historial de turnos y facturas se conserva.',
      confirmLabel: 'Desactivar',
    });
    if (!ok) return;
    try {
      await api(`/customers/${c.id}`, { method: 'DELETE' });
      toast.success('Cliente desactivado');
      load();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  const hayFiltros = Boolean(q.trim() || source || tag.trim());

  return (
    <div className="space-y-5">
      <PageHeader
        title="Clientes"
        description="Tu cartera completa: buscá, filtrá y entrá a la ficha de cada uno."
        actions={
          <Button variant="primary" onClick={() => setNuevo(true)}>
            Nuevo cliente
          </Button>
        }
      />
      <ErrorNote error={error} />

      <div className={tableCard}>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
          <input
            className={`${inputClass} max-w-xs`}
            placeholder="Buscar por nombre, celular, email, documento o empresa…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <select className={`${inputClass} max-w-[180px]`} value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="">Origen: todos</option>
            {SOURCES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <input
            className={`${inputClass} max-w-[180px]`}
            placeholder="Etiqueta (ej: vip)"
            value={tag}
            onChange={(e) => setTag(e.target.value)}
          />
          {hayFiltros && (
            <button
              className="text-xs text-sky-700 hover:underline"
              onClick={() => {
                setQ('');
                setSource('');
                setTag('');
              }}
            >
              Limpiar filtros
            </button>
          )}
        </div>
        <table className="tbl">
          <thead>
            <tr>
              <th>Nombre</th>
              <th>WhatsApp</th>
              <th>Email</th>
              <th>Origen</th>
              <th>Etiquetas</th>
              <th>Puntaje</th>
              <th>
                <span className="sr-only">Acciones</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {(rows ?? []).map((c) => (
              <tr
                key={c.id}
                className="cursor-pointer hover:bg-slate-50"
                onClick={() => router.push(`/app/customers/${c.id}`)}
              >
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
                      <button
                        key={t}
                        type="button"
                        title={`Filtrar por "${t}"`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setTag(t);
                        }}
                      >
                        <Badge tone="sky">{t}</Badge>
                      </button>
                    ))}
                  </span>
                </td>
                <td className="whitespace-nowrap text-amber-500" title={c.rating ? `${c.rating} de 5` : 'Sin puntaje'}>
                  {c.rating ? '★'.repeat(c.rating) : <span className="text-slate-300">—</span>}
                </td>
                <td className="text-right" onClick={(e) => e.stopPropagation()}>
                  <button className={buttonDanger} onClick={() => void remove(c)}>
                    Desactivar
                  </button>
                </td>
              </tr>
            ))}
            {rows && rows.length === 0 && (
              <EmptyRow
                colSpan={7}
                action={
                  hayFiltros ? (
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setQ('');
                        setSource('');
                        setTag('');
                      }}
                    >
                      Limpiar filtros
                    </Button>
                  ) : (
                    <Button variant="soft" onClick={() => setNuevo(true)}>
                      Crear el primer cliente
                    </Button>
                  )
                }
              >
                {hayFiltros
                  ? 'Ningún cliente coincide con la búsqueda.'
                  : 'Todavía no hay clientes. Los que escriben por WhatsApp se crean solos; los demás se cargan acá.'}
              </EmptyRow>
            )}
            {rows === null && !error && <EmptyRow colSpan={7}>Cargando…</EmptyRow>}
          </tbody>
        </table>
        <LoadMore nextCursor={nextCursor} loading={loadingMore} onLoad={() => void loadMore()} />
      </div>

      {nuevo && (
        <Modal
          title="Nuevo cliente"
          description="Solo el nombre es obligatorio; al guardar se abre la ficha para completar el resto."
          onClose={() => setNuevo(false)}
        >
          <form className="space-y-3" onSubmit={(e) => void create(e)}>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Nombre *">
                <input className={inputClass} value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} required autoFocus />
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
            </div>
            {duplicateId && (
              <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
                Ya existe un cliente con ese celular, email o documento.{' '}
                <Link className="font-medium underline" href={`/app/customers/${duplicateId}`}>
                  Abrir su ficha
                </Link>
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setNuevo(false)}>
                Volver
              </Button>
              <Button variant="primary" type="submit" loading={guardando}>
                Crear y abrir ficha
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
