'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

import { api } from '../../../lib/api';
import { ErrorNote, buttonGhost, dt, inputClass, useSession } from '../../../lib/ui';

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

export default function TasksPage() {
  const user = useSession('tenant');
  const [rows, setRows] = useState<TaskRow[]>([]);
  const [users, setUsers] = useState<TeamUser[]>([]);
  const [status, setStatus] = useState<'pending' | 'done'>('pending');
  const [onlyMine, setOnlyMine] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    (st: 'pending' | 'done', mine: boolean) => {
      const params = new URLSearchParams({ status: st });
      if (mine && user) params.set('assigned_user_id', user.id);
      void api<TaskRow[]>(`/activities?${params.toString()}`)
        .then(setRows)
        .catch((e) => setError(String(e.message)));
    },
    [user],
  );

  useEffect(() => {
    load('pending', false);
    void api<TeamUser[]>('/users').then(setUsers).catch(() => setUsers([]));
  }, [load]);

  async function toggleDone(t: TaskRow) {
    try {
      await api(`/customers/${t.customer.id}/activities/${t.id}`, {
        method: 'PATCH',
        json: { done: !t.doneAt },
      });
      load(status, onlyMine);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  }

  const overdue = (t: TaskRow) => !t.doneAt && t.dueAt && new Date(t.dueAt) < new Date();
  const vencidas = rows.filter(overdue).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Tareas y seguimientos</h1>
        {status === 'pending' && vencidas > 0 && (
          <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
            {vencidas} vencida{vencidas === 1 ? '' : 's'}
          </span>
        )}
      </div>
      <p className="text-sm text-slate-500">
        Todo lo pendiente con tus clientes en un solo lugar: las tareas que carga tu equipo en cada
        ficha y los seguimientos que el bot sugiere al cerrar una conversacion.
      </p>
      <ErrorNote error={error} />

      <div className="flex flex-wrap items-center gap-3">
        <select
          className={`${inputClass} max-w-[180px]`}
          value={status}
          onChange={(e) => {
            const st = e.target.value as 'pending' | 'done';
            setStatus(st);
            load(st, onlyMine);
          }}
        >
          <option value="pending">Pendientes</option>
          <option value="done">Hechas</option>
        </select>
        {users.length > 0 && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={onlyMine}
              onChange={(e) => {
                setOnlyMine(e.target.checked);
                load(status, e.target.checked);
              }}
            />
            Solo las mias
          </label>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="text-left text-slate-500">
            <tr>
              <th className="w-8 p-2"></th>
              <th>Tarea</th>
              <th>Cliente</th>
              <th>Vence</th>
              <th>Responsable</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id} className={`border-t border-slate-100 ${overdue(t) ? 'bg-red-50/50' : ''}`}>
                <td className="p-2">
                  <input
                    type="checkbox"
                    title={t.doneAt ? 'Reabrir' : 'Marcar hecha'}
                    checked={Boolean(t.doneAt)}
                    onChange={() => void toggleDone(t)}
                  />
                </td>
                <td className={t.doneAt ? 'text-slate-400 line-through' : ''}>
                  <span className="mr-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs uppercase text-slate-500">
                    {t.activityType}
                  </span>
                  {t.body}
                </td>
                <td>
                  <Link className="text-sky-700 hover:underline" href={`/app/customers/${t.customer.id}`}>
                    {t.customer.firstName} {t.customer.lastName}
                  </Link>
                  {t.customer.phoneE164 && <span className="block text-xs text-slate-400">{t.customer.phoneE164}</span>}
                </td>
                <td className={overdue(t) ? 'font-medium text-red-600' : ''}>{t.dueAt ? dt(t.dueAt) : '—'}</td>
                <td>{users.find((u) => u.id === t.assignedUserId)?.fullName ?? '—'}</td>
                <td className="p-2 text-right">
                  <Link className={buttonGhost} href={`/app/customers/${t.customer.id}`}>
                    Ficha
                  </Link>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="p-4 text-center text-slate-400">
                  {status === 'pending' ? 'Nada pendiente 🎉' : 'Sin tareas hechas todavia'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
