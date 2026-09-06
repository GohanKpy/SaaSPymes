'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

import { api } from '../../../lib/api';
import { ACTIVITY_TYPES } from '../../../lib/crm';
import { CustomerPicker, customerName, type PickedCustomer } from '../../../lib/customer-picker';
import { useToast } from '../../../lib/feedback';
import { errorMessage } from '../../../lib/labels';
import {
  Badge,
  Button,
  EmptyRow,
  ErrorNote,
  Field,
  Modal,
  PageHeader,
  Tabs,
  buttonGhost,
  dt,
  inputClass,
  tableCard,
  useSession,
  useUrlParam,
} from '../../../lib/ui';

// Tareas y seguimientos (fase 1 auditoria de paneles 2026-09-05): la pantalla
// "Tareas" ahora crea tareas (antes habia que ir a la ficha del cliente),
// filtra vencidas de un clic y deja editar o posponer sin salir.

interface TaskRow {
  id: string;
  activityType: string;
  body: string;
  dueAt: string | null;
  doneAt: string | null;
  assignedUserId: string | null;
  createdAt: string;
  customer: { id: string; firstName: string; lastName: string | null; phoneE164: string | null };
}
interface TeamUser {
  id: string;
  fullName: string;
}

const TIPO_TONE: Record<string, 'sky' | 'violet' | 'slate'> = { tarea: 'sky', seguimiento: 'violet' };
const tipoLabel = (t: string) => ACTIVITY_TYPES.find((x) => x.value === t)?.label ?? t;

function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const VACIA = { customer: null as PickedCustomer | null, activity_type: 'tarea', body: '', due_at: '', assigned_user_id: '' };

export default function TasksPage() {
  const user = useSession('tenant');
  const toast = useToast();
  const [rows, setRows] = useState<TaskRow[] | null>(null);
  const [users, setUsers] = useState<TeamUser[]>([]);
  const [vista, setVista] = useUrlParam('vista', 'pendientes');
  const [tipo, setTipo] = useState('');
  const [responsable, setResponsable] = useState('');
  const [vence, setVence] = useState('');
  const [error, setError] = useState<string | null>(null);

  const [nueva, setNueva] = useState(false);
  const [form, setForm] = useState(VACIA);
  const [editando, setEditando] = useState<TaskRow | null>(null);
  const [editForm, setEditForm] = useState({ body: '', due_at: '', assigned_user_id: '' });
  const [guardando, setGuardando] = useState(false);

  const status = vista === 'hechas' ? 'done' : 'pending';

  const load = useCallback(() => {
    const params = new URLSearchParams({ status });
    if (responsable) params.set('assigned_user_id', responsable);
    api<TaskRow[]>(`/activities?${params.toString()}`)
      .then((r) => {
        setRows(r);
        setError(null);
      })
      .catch((e) => setError(errorMessage(e, 'No se pudieron cargar las tareas.')));
  }, [status, responsable]);

  useEffect(() => load(), [load]);
  useEffect(() => {
    void api<TeamUser[]>('/users').then(setUsers).catch(() => setUsers([]));
    if (new URLSearchParams(window.location.search).get('nueva') === '1') setNueva(true);
  }, []);

  const esVencida = (t: TaskRow) => !t.doneAt && !!t.dueAt && new Date(t.dueAt) < new Date();
  const vencidas = useMemo(() => (rows ?? []).filter(esVencida).length, [rows]);

  const visibles = useMemo(() => {
    let r = rows ?? [];
    if (vista === 'vencidas') r = r.filter(esVencida);
    if (tipo) r = r.filter((t) => t.activityType === tipo);
    if (vence) {
      const hoy = new Date();
      const finHoy = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate(), 23, 59, 59);
      const finSemana = new Date(finHoy.getTime() + 6 * 86_400_000);
      r = r.filter((t) => {
        if (vence === 'sin') return !t.dueAt;
        if (!t.dueAt) return false;
        const d = new Date(t.dueAt);
        return vence === 'hoy' ? d <= finHoy : d <= finSemana;
      });
    }
    return r;
  }, [rows, vista, tipo, vence]);

  async function toggleDone(t: TaskRow) {
    const done = !t.doneAt;
    // Cambio inmediato y reversible: la fila no desaparece, se tacha. Para
    // deshacer, se destilda.
    setRows((prev) => (prev ?? []).map((x) => (x.id === t.id ? { ...x, doneAt: done ? new Date().toISOString() : null } : x)));
    try {
      await api(`/customers/${t.customer.id}/activities/${t.id}`, { method: 'PATCH', json: { done } });
      toast.success(done ? 'Tarea marcada como hecha (destildá para deshacer)' : 'Tarea reabierta');
    } catch (e) {
      toast.error(errorMessage(e));
      load();
    }
  }

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    if (!form.customer) return;
    setGuardando(true);
    try {
      await api(`/customers/${form.customer.id}/activities`, {
        method: 'POST',
        json: {
          activity_type: form.activity_type,
          body: form.body.trim(),
          due_at: form.due_at ? new Date(form.due_at).toISOString() : undefined,
          assigned_user_id: form.assigned_user_id || undefined,
        },
      });
      toast.success(`Tarea creada para ${customerName(form.customer)}`);
      setNueva(false);
      setForm(VACIA);
      if (vista !== 'pendientes') setVista('pendientes');
      load();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setGuardando(false);
    }
  }

  function openEdit(t: TaskRow) {
    setEditForm({ body: t.body, due_at: toLocalInput(t.dueAt), assigned_user_id: t.assignedUserId ?? '' });
    setEditando(t);
  }

  async function guardarEdicion(e: React.FormEvent) {
    e.preventDefault();
    if (!editando) return;
    setGuardando(true);
    try {
      await api(`/customers/${editando.customer.id}/activities/${editando.id}`, {
        method: 'PATCH',
        json: {
          body: editForm.body.trim(),
          due_at: editForm.due_at ? new Date(editForm.due_at).toISOString() : null,
          assigned_user_id: editForm.assigned_user_id || null,
        },
      });
      toast.success('Tarea actualizada');
      setEditando(null);
      load();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setGuardando(false);
    }
  }

  async function posponer(t: TaskRow, dias: number) {
    const base = t.dueAt && new Date(t.dueAt) > new Date() ? new Date(t.dueAt) : new Date();
    const nueva = new Date(base.getTime() + dias * 86_400_000);
    try {
      await api(`/customers/${t.customer.id}/activities/${t.id}`, {
        method: 'PATCH',
        json: { due_at: nueva.toISOString() },
      });
      toast.success(`Pospuesta al ${dt(nueva.toISOString())}`);
      load();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  const tipoTarea = ACTIVITY_TYPES.filter((t) => t.task);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Tareas"
        description="Todo lo pendiente con tus clientes en un solo lugar: las tareas que carga tu equipo y los seguimientos que el bot sugiere al cerrar una conversación."
        actions={
          <Button variant="primary" onClick={() => setNueva(true)}>
            Nueva tarea
          </Button>
        }
      />
      <ErrorNote error={error} />

      <div className={tableCard}>
        <div className="px-3 pt-2">
          <Tabs
            value={vista}
            onChange={setVista}
            items={[
              { key: 'pendientes', label: 'Pendientes', count: status === 'pending' ? (rows ?? []).length : undefined },
              { key: 'vencidas', label: 'Vencidas', count: status === 'pending' ? vencidas : undefined },
              { key: 'hechas', label: 'Hechas' },
            ]}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
          <select className={`${inputClass} max-w-[200px]`} value={tipo} onChange={(e) => setTipo(e.target.value)}>
            <option value="">Todas: del equipo y del bot</option>
            <option value="tarea">Tareas del equipo</option>
            <option value="seguimiento">Seguimientos del bot</option>
          </select>
          {users.length > 0 && (
            <select
              className={`${inputClass} max-w-[220px]`}
              value={responsable}
              onChange={(e) => setResponsable(e.target.value)}
            >
              <option value="">Cualquier responsable</option>
              {user && <option value={user.id}>Solo las mías</option>}
              {users
                .filter((u) => u.id !== user?.id)
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.fullName}
                  </option>
                ))}
            </select>
          )}
          {status === 'pending' && (
            <select className={`${inputClass} max-w-[180px]`} value={vence} onChange={(e) => setVence(e.target.value)}>
              <option value="">Vence: cuando sea</option>
              <option value="hoy">Vence hoy</option>
              <option value="semana">Vence esta semana</option>
              <option value="sin">Sin fecha</option>
            </select>
          )}
          {(tipo || responsable || vence) && (
            <button
              className="text-xs text-sky-700 hover:underline"
              onClick={() => {
                setTipo('');
                setResponsable('');
                setVence('');
              }}
            >
              Limpiar filtros
            </button>
          )}
        </div>
        <table className="tbl">
          <thead>
            <tr>
              <th className="w-8">
                <span className="sr-only">Hecha</span>
              </th>
              <th>Tarea</th>
              <th>Cliente</th>
              <th>Vence</th>
              <th>Responsable</th>
              <th>
                <span className="sr-only">Acciones</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {visibles.map((t) => (
              <tr key={t.id} className={esVencida(t) ? 'bg-red-50/50' : 'hover:bg-slate-50'}>
                <td>
                  <input
                    type="checkbox"
                    aria-label={t.doneAt ? 'Reabrir' : 'Marcar hecha'}
                    title={t.doneAt ? 'Reabrir' : 'Marcar hecha'}
                    checked={Boolean(t.doneAt)}
                    onChange={() => void toggleDone(t)}
                  />
                </td>
                <td className={t.doneAt ? 'text-slate-400 line-through' : ''}>
                  <Badge tone={TIPO_TONE[t.activityType] ?? 'slate'} className="mr-2">
                    {tipoLabel(t.activityType)}
                  </Badge>
                  {t.body}
                </td>
                <td>
                  <Link className="text-sky-700 hover:underline" href={`/app/customers/${t.customer.id}`}>
                    {customerName(t.customer)}
                  </Link>
                  {t.customer.phoneE164 && <span className="block text-xs text-slate-400">{t.customer.phoneE164}</span>}
                </td>
                <td className={esVencida(t) ? 'font-medium text-red-600' : ''}>{t.dueAt ? dt(t.dueAt) : '—'}</td>
                <td>{users.find((u) => u.id === t.assignedUserId)?.fullName ?? <span className="text-slate-400">nadie</span>}</td>
                <td className="text-right">
                  {!t.doneAt && (
                    <span className="inline-flex gap-1">
                      <button className={buttonGhost} onClick={() => openEdit(t)}>
                        Editar
                      </button>
                      <button className={buttonGhost} title="Posponer un día" onClick={() => void posponer(t, 1)}>
                        +1 día
                      </button>
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {rows && visibles.length === 0 && (
              <EmptyRow
                colSpan={6}
                action={
                  vista === 'hechas' ? undefined : (
                    <Button variant="soft" onClick={() => setNueva(true)}>
                      Nueva tarea
                    </Button>
                  )
                }
              >
                {vista === 'hechas'
                  ? 'Todavía no hay tareas hechas.'
                  : vista === 'vencidas'
                    ? 'Ninguna tarea vencida. Bien.'
                    : tipo || responsable || vence
                      ? 'Nada coincide con esos filtros.'
                      : 'Nada pendiente. Cuando haga falta recordar algo de un cliente, cargalo acá.'}
              </EmptyRow>
            )}
            {rows === null && !error && <EmptyRow colSpan={6}>Cargando…</EmptyRow>}
          </tbody>
        </table>
      </div>

      {nueva && (
        <Modal title="Nueva tarea" description="Un recordatorio ligado a un cliente. Aparece acá y en su ficha." onClose={() => setNueva(false)}>
          <form className="space-y-3" onSubmit={(e) => void crear(e)}>
            <Field label="Cliente">
              <CustomerPicker value={form.customer} onChange={(c) => setForm({ ...form, customer: c })} autoFocus />
            </Field>
            <Field label="Qué hay que hacer">
              <input
                className={inputClass}
                placeholder="Ej: llamar para confirmar el color elegido"
                value={form.body}
                onChange={(e) => setForm({ ...form, body: e.target.value })}
                required
              />
            </Field>
            <div className="grid gap-3 md:grid-cols-3">
              <Field label="Tipo">
                <select className={inputClass} value={form.activity_type} onChange={(e) => setForm({ ...form, activity_type: e.target.value })}>
                  {tipoTarea.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Vence (opcional)">
                <input className={inputClass} type="datetime-local" value={form.due_at} onChange={(e) => setForm({ ...form, due_at: e.target.value })} />
              </Field>
              {users.length > 0 && (
                <Field label="Responsable (opcional)">
                  <select className={inputClass} value={form.assigned_user_id} onChange={(e) => setForm({ ...form, assigned_user_id: e.target.value })}>
                    <option value="">Nadie en particular</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.fullName}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setNueva(false)}>
                Volver
              </Button>
              <Button variant="primary" type="submit" loading={guardando} disabled={!form.customer || !form.body.trim()}>
                Crear tarea
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {editando && (
        <Modal title={`Editar tarea de ${customerName(editando.customer)}`} onClose={() => setEditando(null)}>
          <form className="space-y-3" onSubmit={(e) => void guardarEdicion(e)}>
            <Field label="Qué hay que hacer">
              <input className={inputClass} value={editForm.body} onChange={(e) => setEditForm({ ...editForm, body: e.target.value })} required />
            </Field>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Vence">
                <input className={inputClass} type="datetime-local" value={editForm.due_at} onChange={(e) => setEditForm({ ...editForm, due_at: e.target.value })} />
              </Field>
              {users.length > 0 && (
                <Field label="Responsable">
                  <select className={inputClass} value={editForm.assigned_user_id} onChange={(e) => setEditForm({ ...editForm, assigned_user_id: e.target.value })}>
                    <option value="">Nadie en particular</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.fullName}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setEditando(null)}>
                Volver
              </Button>
              <Button variant="primary" type="submit" loading={guardando}>
                Guardar
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
