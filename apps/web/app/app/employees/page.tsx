'use client';

import { useCallback, useEffect, useState } from 'react';

import { ApiError, api } from '../../../lib/api';
import { ErrorNote, Field, buttonClass, buttonGhost, inputClass, money } from '../../../lib/ui';

interface Employee {
  id: string;
  firstName: string;
  lastName: string;
  ciNumber: string | null;
  birthDate: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  position: string | null;
  hiredAt: string | null;
  ipsNumber: string | null;
  emergencyContact: string | null;
  salary: string | null;
  notes: string | null;
  bookable: boolean;
  isActive: boolean;
}

const VACIO = {
  first_name: '',
  last_name: '',
  ci_number: '',
  birth_date: '',
  phone: '',
  email: '',
  address: '',
  position: '',
  hired_at: '',
  ips_number: '',
  emergency_contact: '',
  salary: '',
  notes: '',
  bookable: true,
  is_active: true,
};

const soloFecha = (d: string | null) => (d ? d.slice(0, 10) : '');

/** Planilla de RRHH (ADR 0009): ficha completa del empleado. Los agendables
 *  participan de la agenda: los turnos se les asignan sin solaparse. */
export default function EmployeesPage() {
  const [rows, setRows] = useState<Employee[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Employee | 'nuevo' | null>(null);
  const [form, setForm] = useState(VACIO);

  const load = useCallback(() => {
    void api<Employee[]>('/employees').then(setRows).catch((e) => setError(String(e.message)));
  }, []);
  useEffect(() => load(), [load]);

  function openNew() {
    setEditing('nuevo');
    setForm(VACIO);
  }
  function openEdit(e: Employee) {
    setEditing(e);
    setForm({
      first_name: e.firstName,
      last_name: e.lastName,
      ci_number: e.ciNumber ?? '',
      birth_date: soloFecha(e.birthDate),
      phone: e.phone ?? '',
      email: e.email ?? '',
      address: e.address ?? '',
      position: e.position ?? '',
      hired_at: soloFecha(e.hiredAt),
      ips_number: e.ipsNumber ?? '',
      emergency_contact: e.emergencyContact ?? '',
      salary: e.salary ?? '',
      notes: e.notes ?? '',
      bookable: e.bookable,
      is_active: e.isActive,
    });
  }

  async function save(ev: React.FormEvent) {
    ev.preventDefault();
    setError(null);
    const json: Record<string, unknown> = {
      first_name: form.first_name,
      last_name: form.last_name,
      bookable: form.bookable,
      is_active: form.is_active,
    };
    for (const [k, v] of Object.entries(form)) {
      if (typeof v === 'string' && v.trim()) json[k] = v.trim();
    }
    try {
      if (editing === 'nuevo') await api('/employees', { method: 'POST', json });
      else if (editing) await api(`/employees/${editing.id}`, { method: 'PATCH', json });
      setEditing(null);
      load();
    } catch (e) {
      const fields =
        e instanceof ApiError && e.problem.errors
          ? ': ' + Object.keys(e.problem.errors).join(', ')
          : '';
      setError((e instanceof Error ? e.message : 'Error') + fields);
    }
  }

  async function remove(e: Employee) {
    if (!confirm(`¿Dar de baja a ${e.firstName} ${e.lastName}? Su historial de turnos se conserva.`)) return;
    try {
      await api(`/employees/${e.id}`, { method: 'DELETE' });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    }
  }

  return (
    <div className="space-y-5">
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/40 p-4">
          <form className="w-full max-w-2xl space-y-3 rounded-lg bg-white p-5 shadow-xl" onSubmit={(e) => void save(e)}>
            <h3 className="font-semibold">{editing === 'nuevo' ? 'Nuevo empleado' : 'Editar empleado'}</h3>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              <Field label="Nombres">
                <input className={inputClass} value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} required />
              </Field>
              <Field label="Apellidos">
                <input className={inputClass} value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} required />
              </Field>
              <Field label="CI">
                <input className={inputClass} value={form.ci_number} onChange={(e) => setForm({ ...form, ci_number: e.target.value })} />
              </Field>
              <Field label="Fecha de nacimiento">
                <input className={inputClass} type="date" value={form.birth_date} onChange={(e) => setForm({ ...form, birth_date: e.target.value })} />
              </Field>
              <Field label="Telefono">
                <input className={inputClass} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </Field>
              <Field label="Email">
                <input className={inputClass} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </Field>
              <Field label="Cargo / puesto">
                <input className={inputClass} value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} />
              </Field>
              <Field label="Fecha de ingreso">
                <input className={inputClass} type="date" value={form.hired_at} onChange={(e) => setForm({ ...form, hired_at: e.target.value })} />
              </Field>
              <Field label="Nro asegurado IPS">
                <input className={inputClass} value={form.ips_number} onChange={(e) => setForm({ ...form, ips_number: e.target.value })} />
              </Field>
              <Field label="Salario (Gs; solo lo ven root/admin)">
                <input className={inputClass} value={form.salary} onChange={(e) => setForm({ ...form, salary: e.target.value })} />
              </Field>
              <div className="col-span-2">
                <Field label="Direccion">
                  <input className={inputClass} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
                </Field>
              </div>
              <div className="col-span-2 md:col-span-3">
                <Field label="Contacto de emergencia (nombre y telefono)">
                  <input className={inputClass} value={form.emergency_contact} onChange={(e) => setForm({ ...form, emergency_contact: e.target.value })} />
                </Field>
              </div>
              <div className="col-span-2 md:col-span-3">
                <Field label="Notas">
                  <textarea className={`${inputClass} h-16`} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
                </Field>
              </div>
            </div>
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.bookable} onChange={(e) => setForm({ ...form, bookable: e.target.checked })} />
                Agendable (recibe turnos de la agenda)
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
                Activo
              </label>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" className={buttonGhost} onClick={() => setEditing(null)}>
                Cancelar
              </button>
              <button className={buttonClass}>Guardar</button>
            </div>
          </form>
        </div>
      )}

      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Empleados</h1>
        <button className={buttonClass} onClick={openNew}>
          Nuevo empleado
        </button>
      </div>
      <p className="text-xs text-slate-500">
        Ficha de RRHH del equipo. Los marcados como agendables reciben los turnos de la agenda: el
        sistema los asigna automaticamente y nunca superpone dos turnos de la misma persona.
      </p>
      <ErrorNote error={error} />

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="text-left text-slate-500">
            <tr>
              <th className="p-2">Nombre</th>
              <th>Cargo</th>
              <th>CI</th>
              <th>Telefono</th>
              <th>Salario</th>
              <th>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id} className="border-t border-slate-100">
                <td className="p-2">
                  {e.firstName} {e.lastName}
                  {e.bookable && (
                    <span className="ml-2 rounded bg-sky-100 px-1.5 py-0.5 text-[10px] text-sky-700">agendable</span>
                  )}
                </td>
                <td>{e.position ?? '—'}</td>
                <td>{e.ciNumber ?? '—'}</td>
                <td>{e.phone ?? '—'}</td>
                <td>{e.salary ? money(e.salary) : '—'}</td>
                <td>
                  <span className={`rounded px-2 py-0.5 text-xs ${e.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                    {e.isActive ? 'activo' : 'inactivo'}
                  </span>
                </td>
                <td className="space-x-1 p-2 text-right">
                  <button className={buttonGhost} onClick={() => openEdit(e)}>
                    Editar
                  </button>
                  <button
                    className="rounded border border-red-200 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50"
                    onClick={() => void remove(e)}
                  >
                    Dar de baja
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="p-4 text-center text-sm text-slate-400">
                  Sin empleados cargados. Sin empleados, la agenda funciona con capacidad simple;
                  al cargar el primero, cada turno queda asignado a una persona.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
