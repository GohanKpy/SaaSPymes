'use client';

import { useCallback, useEffect, useState } from 'react';

import { ApiError, api } from '../../../lib/api';
import { ErrorNote, Field, buttonClass, buttonGhost, dt, inputClass } from '../../../lib/ui';

interface Franja {
  from: string;
  to: string;
}
interface Conflict {
  id: string;
  fecha: string;
  hora: string;
  cliente: string;
  servicio: string;
}
const DIAS: { dow: string; label: string }[] = [
  { dow: '1', label: 'Lunes' },
  { dow: '2', label: 'Martes' },
  { dow: '3', label: 'Miercoles' },
  { dow: '4', label: 'Jueves' },
  { dow: '5', label: 'Viernes' },
  { dow: '6', label: 'Sabado' },
  { dow: '0', label: 'Domingo' },
];

interface Appointment {
  id: string;
  startsAt: string;
  endsAt: string;
  status: string;
  source: string;
  customer: { firstName: string; lastName: string | null };
  service: { name: string } | null;
}
interface Option {
  id: string;
  name?: string;
  firstName?: string;
  lastName?: string | null;
}

function today(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Asuncion' });
}

export default function SchedulePage() {
  const [date, setDate] = useState(today());
  const [rows, setRows] = useState<Appointment[]>([]);
  const [branches, setBranches] = useState<Option[]>([]);
  const [services, setServices] = useState<Option[]>([]);
  const [customers, setCustomers] = useState<Option[]>([]);
  const [slots, setSlots] = useState<string[]>([]);
  const [form, setForm] = useState({ customer_id: '', service_id: '', slot: '' });
  const [error, setError] = useState<string | null>(null);

  const branch = branches[0]?.id;

  // Horarios de atencion (editor + flujo de conflicto con turnos).
  const [showSchedule, setShowSchedule] = useState(false);
  const [week, setWeek] = useState<Record<string, Franja[]>>({});
  const [closedDates, setClosedDates] = useState<string[]>([]);
  const [newClosed, setNewClosed] = useState('');
  const [conflicts, setConflicts] = useState<Conflict[] | null>(null);
  const [cancelMsg, setCancelMsg] = useState('');
  const [askMessage, setAskMessage] = useState(false);
  const [scheduleMsg, setScheduleMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    // Fecha incompleta (mientras se tipea) no dispara consultas.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    const from = `${date}T00:00:00-03:00`;
    const to = `${date}T23:59:59-03:00`;
    void api<Appointment[]>(`/appointments?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
      .then(setRows)
      .catch((e) =>
        setError(
          e instanceof ApiError
            ? String(e.message)
            : 'No se pudo conectar con la API (puede estar reiniciandose); proba de nuevo en unos segundos.',
        ),
      );
  }, [date]);

  useEffect(() => {
    void api<Option[]>('/branches').then(setBranches).catch(() => undefined);
    void api<Option[]>('/catalog/services').then(setServices).catch(() => undefined);
    void api<{ data: Option[] }>('/customers').then((r) => setCustomers(r.data)).catch(() => undefined);
  }, []);
  useEffect(() => load(), [load]);

  useEffect(() => {
    if (!branch || !form.service_id) return;
    void api<string[]>(`/appointments/availability?branch_id=${branch}&service_id=${form.service_id}&date=${date}`)
      .then(setSlots)
      .catch(() => setSlots([]));
  }, [branch, form.service_id, date]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api('/appointments', {
        method: 'POST',
        json: { branch_id: branch, customer_id: form.customer_id, service_id: form.service_id, starts_at: form.slot },
      });
      setForm({ ...form, slot: '' });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  }

  async function action(id: string, verb: string) {
    try {
      await api(`/appointments/${id}/${verb}`, { method: 'POST', json: {} });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  }

  const badge = (s: string) =>
    s === 'confirmed'
      ? 'bg-emerald-100 text-emerald-700'
      : s === 'pending'
        ? 'bg-amber-100 text-amber-700'
        : s === 'completed'
          ? 'bg-sky-100 text-sky-700'
          : 'bg-slate-100 text-slate-500';

  async function openSchedule() {
    if (!branch) return;
    try {
      const s = await api<{ week: Record<string, Franja[]> | null; closed_dates: string[] }>(
        `/branches/${branch}/schedule`,
      );
      // Sin configuracion previa: precarga del horario por defecto (08-18,
      // lunes a sabado) para editar sobre algo concreto.
      setWeek(
        s.week ?? {
          '1': [{ from: '08:00', to: '18:00' }],
          '2': [{ from: '08:00', to: '18:00' }],
          '3': [{ from: '08:00', to: '18:00' }],
          '4': [{ from: '08:00', to: '18:00' }],
          '5': [{ from: '08:00', to: '18:00' }],
          '6': [{ from: '08:00', to: '18:00' }],
        },
      );
      setClosedDates(s.closed_dates);
      setShowSchedule(true);
      setScheduleMsg(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  }

  async function saveSchedule(onConflict: 'abort' | 'keep' | 'cancel_notify') {
    if (!branch) return;
    setScheduleMsg(null);
    const cleanWeek = Object.fromEntries(
      Object.entries(week).map(([d, franjas]) => [d, franjas.filter((f) => f.from && f.to)]),
    );
    try {
      const res = await api<{ saved: boolean; conflicts: number }>(`/branches/${branch}/schedule`, {
        method: 'PUT',
        json: {
          week: cleanWeek,
          closed_dates: closedDates,
          on_conflict: onConflict,
          ...(onConflict === 'cancel_notify' ? { message: cancelMsg.trim() } : {}),
        },
      });
      setConflicts(null);
      setAskMessage(false);
      setCancelMsg('');
      setScheduleMsg(
        onConflict === 'cancel_notify'
          ? `✓ Horario guardado; ${res.conflicts} turno(s) cancelados y avisados por chat`
          : onConflict === 'keep'
            ? `✓ Horario guardado (los ${res.conflicts} turno(s) existentes se mantienen)`
            : '✓ Horario guardado',
      );
      load();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setConflicts(((e.problem as { conflicts?: Conflict[] }).conflicts ?? []) as Conflict[]);
        return;
      }
      setScheduleMsg(e instanceof Error ? e.message : 'Error');
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="text-xl font-semibold">Agenda</h1>
        <input type="date" className={`${inputClass} w-40`} value={date} onChange={(e) => setDate(e.target.value)} />
        <button className={`${buttonGhost} ml-auto`} onClick={() => (showSchedule ? setShowSchedule(false) : void openSchedule())}>
          {showSchedule ? 'Cerrar horarios' : 'Horarios de atencion'}
        </button>
      </div>
      <ErrorNote error={error} />

      {showSchedule && (
        <section className="space-y-3 rounded-lg border border-amber-200 bg-white p-4">
          <div>
            <h2 className="font-medium">Horarios de atencion</h2>
            <p className="text-xs text-slate-500">
              Hasta dos franjas por dia: el hueco entre la primera y la segunda es tu corte
              (almuerzo). Destilda un dia para cerrarlo. Nada se agenda fuera de estas franjas.
            </p>
          </div>
          <div className="space-y-1.5">
            {DIAS.map(({ dow, label }) => {
              const franjas = week[dow] ?? [];
              const abierto = franjas.length > 0;
              const f1 = franjas[0] ?? { from: '', to: '' };
              const f2 = franjas[1] ?? { from: '', to: '' };
              return (
                <div key={dow} className="flex flex-wrap items-center gap-2 text-sm">
                  <label className="flex w-28 items-center gap-2">
                    <input
                      type="checkbox"
                      checked={abierto}
                      onChange={(e) =>
                        setWeek({ ...week, [dow]: e.target.checked ? [{ from: '08:00', to: '18:00' }] : [] })
                      }
                    />
                    {label}
                  </label>
                  {abierto ? (
                    <>
                      <input type="time" className={`${inputClass} w-28`} value={f1.from} onChange={(e) => setWeek({ ...week, [dow]: [{ ...f1, from: e.target.value }, ...(franjas[1] ? [f2] : [])] })} />
                      <span className="text-slate-400">a</span>
                      <input type="time" className={`${inputClass} w-28`} value={f1.to} onChange={(e) => setWeek({ ...week, [dow]: [{ ...f1, to: e.target.value }, ...(franjas[1] ? [f2] : [])] })} />
                      {franjas[1] ? (
                        <>
                          <span className="text-xs text-slate-400">· 2da franja</span>
                          <input type="time" className={`${inputClass} w-28`} value={f2.from} onChange={(e) => setWeek({ ...week, [dow]: [f1, { ...f2, from: e.target.value }] })} />
                          <span className="text-slate-400">a</span>
                          <input type="time" className={`${inputClass} w-28`} value={f2.to} onChange={(e) => setWeek({ ...week, [dow]: [f1, { ...f2, to: e.target.value }] })} />
                          <button type="button" className="text-xs text-red-600 hover:underline" onClick={() => setWeek({ ...week, [dow]: [f1] })}>
                            quitar
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="text-xs text-sky-700 hover:underline"
                          onClick={() => setWeek({ ...week, [dow]: [{ ...f1, to: '12:00' }, { from: '13:00', to: f1.to || '18:00' }] })}
                        >
                          + corte al mediodia
                        </button>
                      )}
                    </>
                  ) : (
                    <span className="text-xs text-slate-400">cerrado</span>
                  )}
                </div>
              );
            })}
          </div>

          <div className="border-t border-slate-100 pt-3">
            <p className="mb-1 text-sm font-medium">Dias cerrados (feriados, vacaciones)</p>
            <div className="flex flex-wrap items-center gap-2">
              <input type="date" className={`${inputClass} w-40`} value={newClosed} onChange={(e) => setNewClosed(e.target.value)} />
              <button
                type="button"
                className={buttonGhost}
                onClick={() => {
                  if (/^\d{4}-\d{2}-\d{2}$/.test(newClosed) && !closedDates.includes(newClosed)) {
                    setClosedDates([...closedDates, newClosed].sort());
                    setNewClosed('');
                  }
                }}
              >
                Agregar dia cerrado
              </button>
              {closedDates.map((d) => (
                <span key={d} className="flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 text-xs">
                  {d.split('-').reverse().join('/')}
                  <button type="button" className="text-red-600" onClick={() => setClosedDates(closedDates.filter((x) => x !== d))}>
                    ✕
                  </button>
                </span>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button className={buttonClass} onClick={() => void saveSchedule('abort')}>
              Guardar horarios
            </button>
            {scheduleMsg && <span className="text-sm text-emerald-600">{scheduleMsg}</span>}
          </div>
        </section>
      )}

      {conflicts && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg space-y-3 rounded-lg bg-white p-5 shadow-xl">
            <h3 className="font-semibold text-amber-700">
              ⚠ Hay {conflicts.length} turno(s) agendados en el horario que queres cerrar
            </h3>
            <ul className="max-h-40 space-y-1 overflow-y-auto text-sm">
              {conflicts.map((c) => (
                <li key={c.id} className="rounded bg-slate-50 px-2 py-1">
                  {c.fecha.split('-').reverse().join('/')} {c.hora} — {c.cliente} ({c.servicio})
                </li>
              ))}
            </ul>
            {askMessage && (
              <Field label="Mensaje breve para los clientes (se envia al cancelar)">
                <textarea
                  className={`${inputClass} h-20`}
                  placeholder="Ej: por un imprevisto debemos reprogramar; escribinos y coordinamos un nuevo horario."
                  value={cancelMsg}
                  onChange={(e) => setCancelMsg(e.target.value)}
                />
              </Field>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              {askMessage ? (
                <button
                  className={buttonClass}
                  disabled={cancelMsg.trim().length < 3}
                  onClick={() => void saveSchedule('cancel_notify')}
                >
                  Cancelar turnos y enviar mensaje
                </button>
              ) : (
                <button className={buttonGhost} onClick={() => setAskMessage(true)}>
                  Enviar un mensaje y cancelar
                </button>
              )}
              <button className={buttonGhost} onClick={() => void saveSchedule('keep')}>
                Aceptar de todos modos
              </button>
              <button
                className={buttonGhost}
                onClick={() => {
                  setConflicts(null);
                  setAskMessage(false);
                }}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      <form className="grid grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-white p-4 md:grid-cols-4" onSubmit={(e) => void create(e)}>
        <Field label="Cliente">
          <select className={inputClass} value={form.customer_id} onChange={(e) => setForm({ ...form, customer_id: e.target.value })} required>
            <option value="">Elegir…</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.firstName} {c.lastName}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Servicio">
          <select className={inputClass} value={form.service_id} onChange={(e) => setForm({ ...form, service_id: e.target.value })} required>
            <option value="">Elegir…</option>
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={`Horario (${slots.length} libres)`}>
          <select className={inputClass} value={form.slot} onChange={(e) => setForm({ ...form, slot: e.target.value })} required>
            <option value="">Elegir…</option>
            {slots.map((s) => (
              <option key={s} value={s}>
                {new Date(s).toLocaleTimeString('es-PY', { timeZone: 'America/Asuncion', hour: '2-digit', minute: '2-digit' })}
              </option>
            ))}
          </select>
        </Field>
        <div className="flex items-end">
          <button className={buttonClass}>Agendar</button>
        </div>
      </form>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="text-left text-slate-500">
            <tr>
              <th className="p-2">Hora</th>
              <th>Cliente</th>
              <th>Servicio</th>
              <th>Estado</th>
              <th>Origen</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id} className="border-t border-slate-100">
                <td className="p-2">{dt(a.startsAt)}</td>
                <td>
                  {a.customer.firstName} {a.customer.lastName}
                </td>
                <td>{a.service?.name ?? '—'}</td>
                <td>
                  <span className={`rounded px-2 py-0.5 text-xs ${badge(a.status)}`}>{a.status}</span>
                </td>
                <td className="text-xs text-slate-500">{a.source}</td>
                <td className="space-x-1 p-2 text-right">
                  {a.status === 'pending' && (
                    <button className={buttonGhost} onClick={() => void action(a.id, 'confirm')}>
                      Confirmar
                    </button>
                  )}
                  {['pending', 'confirmed'].includes(a.status) && (
                    <>
                      <button className={buttonGhost} onClick={() => void action(a.id, 'complete')}>
                        Atendido
                      </button>
                      <button className={buttonGhost} onClick={() => void action(a.id, 'cancel')}>
                        Cancelar
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="p-4 text-center text-slate-400">
                  Sin turnos para este dia
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
