'use client';

import { useCallback, useEffect, useState } from 'react';

import { api } from '../../../lib/api';
import { ErrorNote, Field, buttonClass, buttonGhost, dt, inputClass } from '../../../lib/ui';

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

  const load = useCallback(() => {
    const from = `${date}T00:00:00-03:00`;
    const to = `${date}T23:59:59-03:00`;
    void api<Appointment[]>(`/appointments?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
      .then(setRows)
      .catch((e) => setError(String(e.message)));
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

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Agenda</h1>
        <input type="date" className={`${inputClass} w-auto`} value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
      <ErrorNote error={error} />

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
