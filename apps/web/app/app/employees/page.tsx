'use client';

import { useCallback, useEffect, useState } from 'react';

import { ApiError, api } from '../../../lib/api';
import { useConfirm, useToast } from '../../../lib/feedback';
import { errorMessage } from '../../../lib/labels';
import {
  Badge,
  EmptyRow,
  ErrorNote,
  Field,
  GroupTitle,
  PageHeader,
  buttonClass,
  buttonDanger,
  buttonGhost,
  inputClass,
  money,
  tableCard,
  useSession,
} from '../../../lib/ui';

// Campos configurables como obligatorios (espejo de EMPLOYEE_REQUIRABLE_FIELDS
// en packages/shared/src/dtos/employee.ts; nombre y apellido son siempre
// obligatorios y no se configuran).
const CONFIGURABLES: { key: string; label: string }[] = [
  { key: 'ci_number', label: 'CI' },
  { key: 'birth_date', label: 'Fecha de nacimiento' },
  { key: 'phone', label: 'Telefono' },
  { key: 'email', label: 'Email' },
  { key: 'address', label: 'Direccion' },
  { key: 'marital_status', label: 'Estado civil' },
  { key: 'children_count', label: 'Cantidad de hijos' },
  { key: 'position', label: 'Cargo / puesto' },
  { key: 'hired_at', label: 'Fecha de ingreso' },
  { key: 'ips_number', label: 'Nro asegurado IPS' },
  { key: 'salary', label: 'Salario' },
  { key: 'emergency_contact_name', label: 'Emergencia: nombre' },
  { key: 'emergency_contact_phone', label: 'Emergencia: telefono' },
  { key: 'emergency_contact_relation', label: 'Emergencia: relacion' },
];

interface Franja {
  from: string;
  to: string;
}
interface Schedule {
  week: Record<string, Franja[]>;
  closed_dates: string[];
}

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
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  emergencyContactRelation: string | null;
  maritalStatus: string | null;
  childrenCount: number | null;
  salary: string | null;
  notes: string | null;
  bookable: boolean;
  isActive: boolean;
  schedule: Schedule | null;
  googleCalendar: string | null; // 'connected' | 'disconnected' | null
}

const VACIO = {
  first_name: '',
  last_name: '',
  ci_number: '',
  birth_date: '',
  phone: '',
  email: '',
  address: '',
  marital_status: '',
  children_count: '',
  emergency_contact_name: '',
  emergency_contact_phone: '',
  emergency_contact_relation: '',
  position: '',
  hired_at: '',
  ips_number: '',
  salary: '',
  notes: '',
  bookable: true,
  is_active: true,
};

const soloFecha = (d: string | null) => (d ? d.slice(0, 10) : '');

const DIAS: { key: string; label: string }[] = [
  { key: '1', label: 'Lunes' },
  { key: '2', label: 'Martes' },
  { key: '3', label: 'Miercoles' },
  { key: '4', label: 'Jueves' },
  { key: '5', label: 'Viernes' },
  { key: '6', label: 'Sabado' },
  { key: '0', label: 'Domingo' },
];

type DayForm = { mFrom: string; mTo: string; tFrom: string; tTo: string };
const timeInput = 'w-[5rem] rounded border border-slate-300 px-1 py-1 text-sm';

function parseWeek(schedule: Schedule | null): Record<string, DayForm> {
  const out: Record<string, DayForm> = {};
  for (const d of DIAS) {
    const ranges = schedule?.week[d.key] ?? [];
    out[d.key] = {
      mFrom: ranges[0]?.from ?? '',
      mTo: ranges[0]?.to ?? '',
      tFrom: ranges[1]?.from ?? '',
      tTo: ranges[1]?.to ?? '',
    };
  }
  return out;
}

function buildWeek(days: Record<string, DayForm>): Record<string, Franja[]> {
  const week: Record<string, Franja[]> = {};
  for (const [key, d] of Object.entries(days)) {
    const ranges: Franja[] = [];
    if (d.mFrom && d.mTo) ranges.push({ from: d.mFrom, to: d.mTo });
    if (d.tFrom && d.tTo) ranges.push({ from: d.tFrom, to: d.tTo });
    if (ranges.length > 0) week[key] = ranges;
  }
  return week;
}

/** Planilla de RRHH (ADR 0009): ficha completa del empleado. Los agendables
 *  participan de la agenda: los turnos se les asignan sin solaparse. Fase 3:
 *  horario propio (o el del negocio) y Google Calendar personal. */
export default function EmployeesPage() {
  const confirmar = useConfirm();
  const toast = useToast();
  const user = useSession('tenant');
  const [rows, setRows] = useState<Employee[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<Employee | 'nuevo' | null>(null);
  const [form, setForm] = useState(VACIO);

  // Campos obligatorios definidos por el admin del tenant: pintan el * y el
  // required del formulario; el server los valida ademas por su cuenta.
  const [required, setRequired] = useState<string[]>([]);
  const [showCfg, setShowCfg] = useState(false);
  const [cfg, setCfg] = useState<string[]>([]);
  const req = (f: string) => required.includes(f);
  const lbl = (f: string, base: string) => (req(f) ? `${base} *` : base);
  const isAdmin = user ? ['root', 'admin'].includes(user.role) : false;

  const load = useCallback(() => {
    void api<Employee[]>('/employees').then(setRows).catch((e) => setError(String(e.message)));
    void api<{ required_fields: string[] }>('/employees/form-settings')
      .then((r) => setRequired(r.required_fields))
      .catch(() => undefined);
  }, []);
  useEffect(() => load(), [load]);

  async function saveCfg(e: React.FormEvent) {
    e.preventDefault();
    try {
      const res = await api<{ required_fields: string[] }>('/employees/form-settings', {
        method: 'PUT',
        json: { required_fields: cfg },
      });
      setRequired(res.required_fields);
      setShowCfg(false);
    } catch (err) {
      fail(err);
    }
  }

  // Retorno del OAuth de Google del empleado (?google=connected|error).
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('google');
    if (q === 'connected') setNotice('Google Calendar conectado.');
    if (q === 'error') setError('No se pudo conectar el Google Calendar.');
    if (q) window.history.replaceState(null, '', window.location.pathname);
  }, []);

  function fail(e: unknown) {
    const fields =
      e instanceof ApiError && e.problem.errors ? ': ' + Object.keys(e.problem.errors).join(', ') : '';
    setError((e instanceof Error ? e.message : 'Error') + fields);
  }

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
      marital_status: e.maritalStatus ?? '',
      children_count: e.childrenCount === null ? '' : String(e.childrenCount),
      emergency_contact_name: e.emergencyContactName ?? '',
      emergency_contact_phone: e.emergencyContactPhone ?? '',
      emergency_contact_relation: e.emergencyContactRelation ?? '',
      position: e.position ?? '',
      hired_at: soloFecha(e.hiredAt),
      ips_number: e.ipsNumber ?? '',
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
      fail(e);
    }
  }

  async function remove(e: Employee) {
    const ok = await confirmar({
      title: `Dar de baja a ${e.firstName} ${e.lastName}`,
      message: 'Deja de aparecer en la agenda y no recibe más turnos. Su ficha y su historial de turnos se conservan.',
      confirmLabel: 'Dar de baja',
    });
    if (!ok) return;
    try {
      await api(`/employees/${e.id}`, { method: 'DELETE' });
      toast.success(`${e.firstName} dado de baja`);
      load();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  // ---------------------- horario propio (fase 3) ----------------------

  const [schedEmployee, setSchedEmployee] = useState<Employee | null>(null);
  const [propio, setPropio] = useState(false);
  const [days, setDays] = useState<Record<string, DayForm>>(parseWeek(null));
  const [libres, setLibres] = useState<string[]>([]);
  const [nuevoLibre, setNuevoLibre] = useState('');

  function openSchedule(e: Employee) {
    setSchedEmployee(e);
    setPropio(e.schedule !== null);
    setDays(parseWeek(e.schedule));
    setLibres(e.schedule?.closed_dates ?? []);
    setNuevoLibre('');
  }

  async function saveSchedule(ev: React.FormEvent) {
    ev.preventDefault();
    if (!schedEmployee) return;
    setError(null);
    try {
      await api(`/employees/${schedEmployee.id}`, {
        method: 'PATCH',
        json: { schedule: propio ? { week: buildWeek(days), closed_dates: libres } : null },
      });
      setSchedEmployee(null);
      load();
    } catch (e) {
      fail(e);
    }
  }

  const setDay = (key: string, patch: Partial<DayForm>) =>
    setDays((d) => ({ ...d, [key]: { ...(d[key] as DayForm), ...patch } }));

  // ---------------------- Google Calendar del empleado ----------------------

  async function googleConnect(e: Employee, copiar: boolean) {
    setError(null);
    try {
      const res = await api<{ auth_url: string }>('/integrations/google/connect', {
        method: 'POST',
        json: { employee_id: e.id },
      });
      if (copiar) {
        await navigator.clipboard.writeText(res.auth_url);
        setNotice(
          `Link de conexion copiado: pasaselo a ${e.firstName} para que autorice su propia cuenta (valido 10 minutos).`,
        );
      } else {
        window.location.href = res.auth_url;
      }
    } catch (err) {
      fail(err);
    }
  }

  async function googleDisconnect(e: Employee) {
    const ok = await confirmar({
      title: `Desconectar el Google Calendar de ${e.firstName}`,
      message: 'Sus eventos personales dejan de bloquear horarios en la agenda. Se puede volver a conectar cuando quiera.',
      confirmLabel: 'Desconectar',
    });
    if (!ok) return;
    try {
      await api(`/integrations/google/employee/${e.id}`, { method: 'DELETE' });
      toast.success('Google Calendar desconectado');
      load();
    } catch (err) {
      fail(err);
    }
  }

  return (
    <div className="space-y-5">
      {schedEmployee && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/40 p-4">
          <form className="w-full max-w-lg space-y-3 rounded-xl bg-white p-5 shadow-xl" onSubmit={(e) => void saveSchedule(e)}>
            <h3 className="font-semibold">
              Horario de {schedEmployee.firstName} {schedEmployee.lastName}
            </h3>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={!propio} onChange={(e) => setPropio(!e.target.checked)} />
              Usa el horario de atencion del negocio
            </label>
            {propio && (
              <>
                <div className="space-y-1">
                  <div className="grid grid-cols-[6rem_repeat(4,5rem)] items-center gap-1 text-[11px] text-slate-500">
                    <span></span>
                    <span>Mañana de</span>
                    <span>a</span>
                    <span>Tarde de</span>
                    <span>a</span>
                  </div>
                  {DIAS.map((d) => {
                    const v = days[d.key] as DayForm;
                    return (
                      <div key={d.key} className="grid grid-cols-[6rem_repeat(4,5rem)] items-center gap-1">
                        <span className="text-sm">{d.label}</span>
                        <input className={timeInput} type="time" value={v.mFrom} onChange={(e) => setDay(d.key, { mFrom: e.target.value })} />
                        <input className={timeInput} type="time" value={v.mTo} onChange={(e) => setDay(d.key, { mTo: e.target.value })} />
                        <input className={timeInput} type="time" value={v.tFrom} onChange={(e) => setDay(d.key, { tFrom: e.target.value })} />
                        <input className={timeInput} type="time" value={v.tTo} onChange={(e) => setDay(d.key, { tTo: e.target.value })} />
                      </div>
                    );
                  })}
                  <p className="text-xs text-slate-500">
                    Dia sin horas = no trabaja ese dia. Solo recibe turnos dentro de su franja (y
                    dentro del horario del negocio).
                  </p>
                </div>
                <div className="space-y-1">
                  <span className="text-sm font-medium">Dias libres / vacaciones</span>
                  <div className="flex flex-wrap gap-1">
                    {libres.map((f) => (
                      <span key={f} className="flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 text-xs">
                        {f}
                        <button type="button" className="text-red-500" onClick={() => setLibres(libres.filter((x) => x !== f))}>
                          ×
                        </button>
                      </span>
                    ))}
                    {libres.length === 0 && <span className="text-xs text-slate-400">Sin dias libres cargados.</span>}
                  </div>
                  <div className="flex gap-2">
                    <input className={`${inputClass} w-40`} type="date" value={nuevoLibre} onChange={(e) => setNuevoLibre(e.target.value)} />
                    <button
                      type="button"
                      className={buttonGhost}
                      onClick={() => {
                        if (nuevoLibre && !libres.includes(nuevoLibre)) setLibres([...libres, nuevoLibre].sort());
                        setNuevoLibre('');
                      }}
                    >
                      Agregar
                    </button>
                  </div>
                </div>
              </>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" className={buttonGhost} onClick={() => setSchedEmployee(null)}>
                Cancelar
              </button>
              <button className={buttonClass}>Guardar</button>
            </div>
          </form>
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/40 p-4">
          <form className="w-full max-w-2xl space-y-3 rounded-xl bg-white p-5 shadow-xl" onSubmit={(e) => void save(e)}>
            <h3 className="font-semibold">{editing === 'nuevo' ? 'Nuevo empleado' : 'Editar empleado'}</h3>
            <p className="text-xs text-slate-500">
              Solo nombres y apellidos son obligatorios; todo lo demas es opcional y se puede
              completar despues. (Los campos con * los definiste vos en &quot;Campos obligatorios&quot;.)
            </p>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              <GroupTitle>Datos personales</GroupTitle>
              <Field label="Nombres *">
                <input className={inputClass} value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} required />
              </Field>
              <Field label="Apellidos *">
                <input className={inputClass} value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} required />
              </Field>
              <Field label={lbl('ci_number', 'CI')}>
                <input className={inputClass} required={req('ci_number')} value={form.ci_number} onChange={(e) => setForm({ ...form, ci_number: e.target.value })} />
              </Field>
              <Field label={lbl('birth_date', 'Fecha de nacimiento')}>
                <input className={inputClass} type="date" required={req('birth_date')} value={form.birth_date} onChange={(e) => setForm({ ...form, birth_date: e.target.value })} />
              </Field>
              <Field label={lbl('phone', 'Telefono')}>
                <input className={inputClass} required={req('phone')} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </Field>
              <Field label={lbl('email', 'Email')}>
                <input className={inputClass} type="email" required={req('email')} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </Field>
              <Field label={lbl('marital_status', 'Estado civil')}>
                <select
                  className={inputClass}
                  required={req('marital_status')}
                  value={form.marital_status}
                  onChange={(e) => setForm({ ...form, marital_status: e.target.value })}
                >
                  <option value="">—</option>
                  <option value="soltero">Soltero/a</option>
                  <option value="casado">Casado/a</option>
                  <option value="divorciado">Divorciado/a</option>
                  <option value="viudo">Viudo/a</option>
                  <option value="union_de_hecho">Unión de hecho</option>
                </select>
              </Field>
              <Field label={lbl('children_count', 'Cantidad de hijos')}>
                <input
                  className={inputClass}
                  type="number"
                  min="0"
                  max="30"
                  placeholder="0 = no tiene"
                  required={req('children_count')}
                  value={form.children_count}
                  onChange={(e) => setForm({ ...form, children_count: e.target.value })}
                />
              </Field>
              <Field label={lbl('address', 'Direccion')}>
                <input className={inputClass} required={req('address')} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
              </Field>

              <GroupTitle>Datos laborales</GroupTitle>
              <Field label={lbl('position', 'Cargo / puesto')}>
                <input className={inputClass} required={req('position')} value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} />
              </Field>
              <Field label={lbl('hired_at', 'Fecha de ingreso')}>
                <input className={inputClass} type="date" required={req('hired_at')} value={form.hired_at} onChange={(e) => setForm({ ...form, hired_at: e.target.value })} />
              </Field>
              <Field label={lbl('ips_number', 'Nro asegurado IPS')}>
                <input className={inputClass} required={req('ips_number')} value={form.ips_number} onChange={(e) => setForm({ ...form, ips_number: e.target.value })} />
              </Field>
              <Field label={lbl('salary', 'Salario (Gs; solo lo ven root/admin)')}>
                <input className={inputClass} required={req('salary')} value={form.salary} onChange={(e) => setForm({ ...form, salary: e.target.value })} />
              </Field>
              <div className="col-span-2">
                <Field label="Notas">
                  <textarea className={`${inputClass} h-16`} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
                </Field>
              </div>

              <GroupTitle>Contacto de emergencia (a quien llamar si le pasa algo)</GroupTitle>
              <Field label={lbl('emergency_contact_name', 'Nombre')}>
                <input className={inputClass} required={req('emergency_contact_name')} value={form.emergency_contact_name} onChange={(e) => setForm({ ...form, emergency_contact_name: e.target.value })} />
              </Field>
              <Field label={lbl('emergency_contact_phone', 'Telefono')}>
                <input className={inputClass} required={req('emergency_contact_phone')} value={form.emergency_contact_phone} onChange={(e) => setForm({ ...form, emergency_contact_phone: e.target.value })} />
              </Field>
              <Field label={lbl('emergency_contact_relation', 'Relacion con el empleado')}>
                <input
                  className={inputClass}
                  list="relaciones-emergencia"
                  placeholder="padre, madre, esposo/a…"
                  required={req('emergency_contact_relation')}
                  value={form.emergency_contact_relation}
                  onChange={(e) => setForm({ ...form, emergency_contact_relation: e.target.value })}
                />
              </Field>
              <datalist id="relaciones-emergencia">
                {['padre', 'madre', 'esposo/a', 'hijo/a', 'hermano/a', 'abuelo/a', 'tio/a', 'amigo/a', 'otro'].map((r) => (
                  <option key={r} value={r} />
                ))}
              </datalist>
            </div>
            <div className="space-y-2">
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-0.5" checked={form.bookable} onChange={(e) => setForm({ ...form, bookable: e.target.checked })} />
                <span>
                  <b>Atiende clientes con turno</b>
                  <span className="block text-xs text-slate-500">
                    Aparece en la agenda y el sistema le asigna turnos automaticamente (nunca dos a
                    la misma hora). Desmarcalo para personal que no atiende clientes (ej. limpieza,
                    administracion).
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-0.5" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
                <span>
                  <b>Trabaja actualmente</b>
                  <span className="block text-xs text-slate-500">
                    Desmarcalo si ya no trabaja en tu empresa: se archiva, deja de recibir turnos y
                    de aparecer en las listas, pero su historial se conserva.
                  </span>
                </span>
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

      <PageHeader
        title="Empleados"
        description="Ficha de RRHH del equipo. Los marcados como agendables reciben los turnos de la agenda: el sistema los asigna automáticamente y nunca superpone dos turnos de la misma persona. Cada uno puede tener horario propio y conectar su Google Calendar personal (sus eventos lo sacan de la agenda solo a él)."
        actions={
          <>
            {isAdmin && (
              <button
                className={buttonGhost}
                onClick={() => {
                  setCfg(required);
                  setShowCfg(true);
                }}
              >
                Campos obligatorios
              </button>
            )}
            <button className={buttonClass} onClick={openNew}>
              Nuevo empleado
            </button>
          </>
        }
      />

      {showCfg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/40 p-4">
          <form className="w-full max-w-md space-y-3 rounded-xl bg-white p-5 shadow-xl" onSubmit={(e) => void saveCfg(e)}>
            <h3 className="font-semibold">Campos obligatorios de la planilla</h3>
            <p className="text-xs text-slate-500">
              Definí qué datos son obligatorios al cargar un empleado en TU empresa. Se marcan con *
              en el formulario y el sistema no deja guardar un empleado nuevo sin completarlos.
            </p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
              <label className="flex items-center gap-2 text-slate-400">
                <input type="checkbox" checked disabled /> Nombres (siempre)
              </label>
              <label className="flex items-center gap-2 text-slate-400">
                <input type="checkbox" checked disabled /> Apellidos (siempre)
              </label>
              {CONFIGURABLES.map((f) => (
                <label key={f.key} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={cfg.includes(f.key)}
                    onChange={(e) =>
                      setCfg(e.target.checked ? [...cfg, f.key] : cfg.filter((k) => k !== f.key))
                    }
                  />
                  {f.label}
                </label>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" className={buttonGhost} onClick={() => setShowCfg(false)}>
                Cancelar
              </button>
              <button className={buttonClass}>Guardar</button>
            </div>
          </form>
        </div>
      )}
      {notice && <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{notice}</p>}
      <ErrorNote error={error} />

      <div className={tableCard}>
        <table className="tbl">
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Cargo</th>
              <th>Horario</th>
              <th>Google</th>
              <th className="text-right">Salario</th>
              <th>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id} className="hover:bg-slate-50">
                <td>
                  {e.firstName} {e.lastName}
                  {e.bookable && (
                    <Badge tone="sky" className="ml-2">
                      agendable
                    </Badge>
                  )}
                </td>
                <td>{e.position ?? '—'}</td>
                <td>
                  <button className={buttonGhost} onClick={() => openSchedule(e)}>
                    {e.schedule ? 'Propio' : 'Del negocio'}
                  </button>
                </td>
                <td>
                  {e.googleCalendar === 'connected' ? (
                    <span className="space-x-1">
                      <Badge tone="emerald">conectado</Badge>
                      <button className="text-xs text-red-600 hover:underline" onClick={() => void googleDisconnect(e)}>
                        desconectar
                      </button>
                    </span>
                  ) : (
                    <span className="space-x-1 whitespace-nowrap">
                      {e.googleCalendar === 'disconnected' && <Badge tone="amber">revocado</Badge>}
                      <button className="text-xs text-sky-700 hover:underline" onClick={() => void googleConnect(e, false)}>
                        conectar
                      </button>
                      <button className="text-xs text-slate-500 hover:underline" onClick={() => void googleConnect(e, true)}>
                        copiar link
                      </button>
                    </span>
                  )}
                </td>
                <td className="text-right tabular-nums">{e.salary ? money(e.salary) : '—'}</td>
                <td>
                  <Badge tone={e.isActive ? 'emerald' : 'slate'}>{e.isActive ? 'activo' : 'inactivo'}</Badge>
                </td>
                <td className="text-right">
                  <span className="inline-flex gap-1">
                    <button className={buttonGhost} onClick={() => openEdit(e)}>
                      Editar
                    </button>
                    <button className={buttonDanger} onClick={() => void remove(e)}>
                      Dar de baja
                    </button>
                  </span>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <EmptyRow colSpan={7}>
                Sin empleados cargados. Sin empleados, la agenda funciona con capacidad simple; al cargar el primero,
                cada turno queda asignado a una persona.
              </EmptyRow>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
