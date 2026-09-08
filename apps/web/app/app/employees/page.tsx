'use client';

import { useCallback, useEffect, useState } from 'react';

import { api } from '../../../lib/api';
import { useConfirm, useToast } from '../../../lib/feedback';
import { errorMessage } from '../../../lib/labels';
import { MoneyInput } from '../../../lib/money-input';

import { AusenciaModal, ConflictosTurnos, ausenciaVigente, conflictosDe, textoAusencia, type Ausencia, type TurnoAfectado } from './ausencias';
import {
  Badge,
  Button,
  EmptyRow,
  ErrorNote,
  Field,
  GroupTitle,
  Modal,
  PageHeader,
  Tabs,
  buttonDanger,
  buttonGhost,
  buttonSoft,
  inputClass,
  money,
  tableCard,
  useSession,
  useUrlParam,
} from '../../../lib/ui';

import { AccesosSection, type Prefill, type TeamUser } from './accesos';

// Personal (fase 2 auditoria de paneles 2026-09-05): las fichas de quienes
// trabajan y las cuentas con las que entran al panel, en una sola pantalla
// con dos pestañas. Desde la ficha de un empleado se crea su acceso con los
// datos ya puestos. Antes eran dos pantallas ("Empleados" y "Equipo") que
// nadie distinguia y sin ningun enlace entre ellas.

const CONFIGURABLES: { key: string; label: string }[] = [
  { key: 'ci_number', label: 'Cédula' },
  { key: 'birth_date', label: 'Fecha de nacimiento' },
  { key: 'phone', label: 'Teléfono' },
  { key: 'email', label: 'Email' },
  { key: 'address', label: 'Dirección' },
  { key: 'marital_status', label: 'Estado civil' },
  { key: 'children_count', label: 'Cantidad de hijos' },
  { key: 'position', label: 'Cargo / puesto' },
  { key: 'hired_at', label: 'Fecha de ingreso' },
  { key: 'ips_number', label: 'Nro. de asegurado IPS' },
  { key: 'salary', label: 'Salario' },
  { key: 'emergency_contact_name', label: 'Emergencia: nombre' },
  { key: 'emergency_contact_phone', label: 'Emergencia: teléfono' },
  { key: 'emergency_contact_relation', label: 'Emergencia: relación' },
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
  googleCalendar: string | null;
  absences?: Ausencia[];
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
  { key: '3', label: 'Miércoles' },
  { key: '4', label: 'Jueves' },
  { key: '5', label: 'Viernes' },
  { key: '6', label: 'Sábado' },
  { key: '0', label: 'Domingo' },
];

type DayForm = { mFrom: string; mTo: string; tFrom: string; tTo: string };
const timeInput = 'w-[5rem] rounded border border-slate-300 px-1 py-1 text-sm';

function parseWeek(schedule: Schedule | null): Record<string, DayForm> {
  const out: Record<string, DayForm> = {};
  for (const d of DIAS) {
    const ranges = schedule?.week[d.key] ?? [];
    out[d.key] = { mFrom: ranges[0]?.from ?? '', mTo: ranges[0]?.to ?? '', tFrom: ranges[1]?.from ?? '', tTo: ranges[1]?.to ?? '' };
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

export default function PersonalPage() {
  const confirmar = useConfirm();
  const toast = useToast();
  const user = useSession('tenant');
  const [vista, setVista] = useUrlParam('vista', 'fichas');
  const [rows, setRows] = useState<Employee[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Employee | 'nuevo' | null>(null);
  const [form, setForm] = useState(VACIO);
  const [guardando, setGuardando] = useState(false);
  const [accounts, setAccounts] = useState<TeamUser[]>([]);
  const [prefill, setPrefill] = useState<Prefill | null>(null);

  // Ausencias (2026-09-08) y el paso de conflictos al dar de baja.
  const [ausenciaDe, setAusenciaDe] = useState<Employee | null>(null);
  const [conflicto, setConflicto] = useState<{ nombre: string; conflicts: TurnoAfectado[]; reintentar: (d: 'notify' | 'keep') => Promise<void> } | null>(null);
  const [required, setRequired] = useState<string[]>([]);
  const [showCfg, setShowCfg] = useState(false);
  const [cfg, setCfg] = useState<string[]>([]);
  const req = (f: string) => required.includes(f);
  const lbl = (f: string, base: string) => (req(f) ? `${base} *` : base);
  const isAdmin = user ? ['root', 'admin'].includes(user.role) : false;

  const load = useCallback(() => {
    api<Employee[]>('/employees')
      .then((r) => {
        setRows(r);
        setError(null);
      })
      .catch((e) => setError(errorMessage(e, 'No se pudo cargar el personal.')));
    void api<{ required_fields: string[] }>('/employees/form-settings')
      .then((r) => setRequired(r.required_fields))
      .catch(() => undefined);
    void api<TeamUser[]>('/users').then(setAccounts).catch(() => setAccounts([]));
  }, []);
  useEffect(() => load(), [load]);

  // Retorno del OAuth de Google del empleado (?google=connected|error).
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('google');
    if (q === 'connected') toast.success('Google Calendar del empleado conectado');
    if (q === 'error') toast.error('No se pudo conectar el Google Calendar del empleado.');
    if (q) {
      const url = new URL(window.location.href);
      url.searchParams.delete('google');
      window.history.replaceState(null, '', url.toString());
    }
  }, []);

  async function saveCfg(e: React.FormEvent) {
    e.preventDefault();
    setGuardando(true);
    try {
      const res = await api<{ required_fields: string[] }>('/employees/form-settings', { method: 'PUT', json: { required_fields: cfg } });
      setRequired(res.required_fields);
      setShowCfg(false);
      toast.success('Campos obligatorios guardados');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setGuardando(false);
    }
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
    const json: Record<string, unknown> = { first_name: form.first_name, last_name: form.last_name, bookable: form.bookable, is_active: form.is_active };
    for (const [k, v] of Object.entries(form)) {
      if (typeof v === 'string' && v.trim()) json[k] = v.trim();
    }
    setGuardando(true);
    const guardar = async (onConflict?: 'notify' | 'keep') => {
      if (editing === 'nuevo') await api('/employees', { method: 'POST', json });
      else if (editing) await api(`/employees/${editing.id}`, { method: 'PATCH', json: { ...json, ...(onConflict ? { on_conflict: onConflict } : {}) } });
      toast.success(editing === 'nuevo' ? `${form.first_name} agregado al personal` : 'Ficha guardada');
      setEditing(null);
      setConflicto(null);
      load();
    };
    try {
      await guardar();
    } catch (e) {
      // Deja de trabajar con turnos futuros (2026-09-08): el sistema avisa y se decide.
      const c = conflictosDe(e);
      if (c && editing && editing !== 'nuevo') {
        setConflicto({ nombre: `${editing.firstName} ${editing.lastName}`, conflicts: c, reintentar: guardar });
      } else toast.error(errorMessage(e));
    } finally {
      setGuardando(false);
    }
  }

  async function remove(e: Employee) {
    const ok = await confirmar({
      title: `Dar de baja a ${e.firstName} ${e.lastName}`,
      message: 'Deja de aparecer en la agenda y no recibe más turnos. Su ficha y su historial de turnos se conservan.',
      confirmLabel: 'Dar de baja',
    });
    if (!ok) return;
    const baja = async (onConflict?: 'notify' | 'keep') => {
      await api(`/employees/${e.id}${onConflict ? `?on_conflict=${onConflict}` : ''}`, { method: 'DELETE' });
      toast.success(onConflict === 'notify' ? `${e.firstName} dado de baja; sus clientes fueron avisados` : `${e.firstName} dado de baja`);
      setConflicto(null);
      load();
    };
    try {
      await baja();
    } catch (err) {
      // Se retira con turnos futuros (2026-09-08): el sistema avisa y se decide.
      const c = conflictosDe(err);
      if (c) setConflicto({ nombre: `${e.firstName} ${e.lastName}`, conflicts: c, reintentar: baja });
      else toast.error(errorMessage(err));
    }
  }

  // ---------------------- horario propio ----------------------
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
    setGuardando(true);
    try {
      await api(`/employees/${schedEmployee.id}`, {
        method: 'PATCH',
        json: { schedule: propio ? { week: buildWeek(days), closed_dates: libres } : null },
      });
      toast.success(`Horario de ${schedEmployee.firstName} guardado`);
      setSchedEmployee(null);
      load();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setGuardando(false);
    }
  }
  const setDay = (key: string, patch: Partial<DayForm>) => setDays((d) => ({ ...d, [key]: { ...(d[key] as DayForm), ...patch } }));

  // ---------------------- Google Calendar del empleado ----------------------
  async function googleConnect(e: Employee, copiar: boolean) {
    try {
      const res = await api<{ auth_url: string }>('/integrations/google/connect', { method: 'POST', json: { employee_id: e.id } });
      if (copiar) {
        await navigator.clipboard.writeText(res.auth_url);
        toast.success(`Link copiado: pasáselo a ${e.firstName} para que autorice su cuenta (vale 10 minutos)`);
      } else {
        window.location.href = res.auth_url;
      }
    } catch (err) {
      toast.error(errorMessage(err));
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
      toast.error(errorMessage(err));
    }
  }

  const tieneCuenta = (e: Employee) => Boolean(e.email && accounts.some((u) => u.email.toLowerCase() === e.email!.toLowerCase()));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Personal"
        description="Quién trabaja en tu negocio (fichas, horarios, quién atiende turnos) y con qué cuentas entran al panel."
        actions={
          vista === 'fichas' ? (
            <>
              {isAdmin && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setCfg(required);
                    setShowCfg(true);
                  }}
                >
                  Campos obligatorios
                </Button>
              )}
              <Button variant="primary" onClick={openNew}>
                Nuevo empleado
              </Button>
            </>
          ) : undefined
        }
      />
      <ErrorNote error={error} />

      <Tabs
        value={vista}
        onChange={setVista}
        items={[
          { key: 'fichas', label: 'Fichas', count: rows?.filter((e) => e.isActive).length },
          { key: 'accesos', label: 'Accesos al panel', count: accounts.length || undefined },
        ]}
      />

      {vista === 'fichas' && (
        <div className={tableCard}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Cargo</th>
                <th>Horario</th>
                <th>Google Calendar</th>
                {isAdmin && <th className="text-right">Salario</th>}
                <th>Acceso al panel</th>
                <th>
                  <span className="sr-only">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {(rows ?? []).map((e) => (
                <tr key={e.id} className={e.isActive ? 'hover:bg-slate-50' : 'text-slate-400'}>
                  <td>
                    <span className="font-medium">
                      {e.firstName} {e.lastName}
                    </span>
                    <span className="mt-0.5 flex flex-wrap gap-1">
                      {e.bookable ? <Badge tone="sky">atiende turnos</Badge> : <Badge tone="slate">no atiende turnos</Badge>}
                      {!e.isActive && <Badge tone="red">dado de baja</Badge>}
                      {e.isActive && ausenciaVigente(e.absences) && <Badge tone="amber">{textoAusencia(ausenciaVigente(e.absences)!)}</Badge>}
                      {e.isActive && !ausenciaVigente(e.absences) && (e.absences?.length ?? 0) > 0 && (
                        <Badge tone="slate">ausencia programada</Badge>
                      )}
                    </span>
                  </td>
                  <td>{e.position ?? '—'}</td>
                  <td>
                    <button className={buttonGhost} onClick={() => openSchedule(e)}>
                      {e.schedule ? 'Horario propio' : 'El del negocio'}
                    </button>
                  </td>
                  <td>
                    {e.googleCalendar === 'connected' ? (
                      <span className="inline-flex items-center gap-1.5">
                        <Badge tone="emerald">conectado</Badge>
                        <button className={buttonGhost} onClick={() => void googleDisconnect(e)}>
                          Desconectar
                        </button>
                      </span>
                    ) : (
                      <span className="inline-flex flex-wrap items-center gap-1.5">
                        {e.googleCalendar === 'disconnected' && <Badge tone="amber">acceso revocado</Badge>}
                        <button className={buttonGhost} onClick={() => void googleConnect(e, false)}>
                          Conectar
                        </button>
                        <button className={buttonGhost} title="Copiar el link para que la persona autorice su propia cuenta" onClick={() => void googleConnect(e, true)}>
                          Copiar link
                        </button>
                      </span>
                    )}
                  </td>
                  {isAdmin && <td className="text-right tabular-nums">{e.salary ? money(e.salary) : '—'}</td>}
                  <td>
                    {tieneCuenta(e) ? (
                      <Badge tone="emerald">tiene cuenta</Badge>
                    ) : isAdmin && e.isActive ? (
                      <button
                        className={buttonSoft}
                        onClick={() => {
                          setPrefill({ email: e.email ?? '', full_name: `${e.firstName} ${e.lastName}` });
                          setVista('accesos');
                        }}
                      >
                        Crear acceso
                      </button>
                    ) : (
                      <span className="text-xs text-slate-400">sin cuenta</span>
                    )}
                  </td>
                  <td className="text-right">
                    <span className="inline-flex gap-1">
                      <button className={buttonGhost} onClick={() => openEdit(e)}>
                        Editar
                      </button>
                      {e.isActive && isAdmin && (
                        <button className={buttonGhost} title="Registrar días en que no atiende (licencia, vacaciones, se ausenta)" onClick={() => setAusenciaDe(e)}>
                          Ausencia
                        </button>
                      )}
                      {e.isActive && (
                        <button className={buttonDanger} onClick={() => void remove(e)}>
                          Dar de baja
                        </button>
                      )}
                    </span>
                  </td>
                </tr>
              ))}
              {rows && rows.length === 0 && (
                <EmptyRow
                  colSpan={isAdmin ? 7 : 6}
                  action={
                    <Button variant="soft" onClick={openNew}>
                      Cargar al primero
                    </Button>
                  }
                >
                  Sin personal cargado. Sin empleados, la agenda funciona con capacidad simple; al cargar al primero, cada turno queda asignado a una persona y el cliente puede elegir con quién.
                </EmptyRow>
              )}
              {rows === null && !error && <EmptyRow colSpan={7}>Cargando…</EmptyRow>}
            </tbody>
          </table>
        </div>
      )}

      {vista === 'accesos' && <AccesosSection prefill={prefill} onPrefillUsed={() => setPrefill(null)} onUsers={setAccounts} />}

      {ausenciaDe && <AusenciaModal employee={ausenciaDe} onClose={() => setAusenciaDe(null)} onSaved={load} />}
      {conflicto && (
        <ConflictosTurnos
          titulo={`${conflicto.nombre} tiene ${conflicto.conflicts.length} turno${conflicto.conflicts.length === 1 ? '' : 's'} agendado${conflicto.conflicts.length === 1 ? '' : 's'}`}
          nombre={conflicto.nombre}
          conflicts={conflicto.conflicts}
          guardando={guardando}
          onElegir={(d) => {
            setGuardando(true);
            void conflicto.reintentar(d).catch((err) => toast.error(errorMessage(err))).finally(() => setGuardando(false));
          }}
          onClose={() => setConflicto(null)}
        />
      )}

      {schedEmployee && (
        <Modal title={`Horario de ${schedEmployee.firstName} ${schedEmployee.lastName}`} onClose={() => setSchedEmployee(null)} size="lg">
          <form className="space-y-3" onSubmit={(e) => void saveSchedule(e)}>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-0.5" checked={!propio} onChange={(e) => setPropio(!e.target.checked)} />
              <span>
                <b>Usa el horario de atención del negocio</b>
                <span className="block text-xs text-slate-500">Destildá para cargarle un horario propio (por ejemplo, medio turno).</span>
              </span>
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
                  <p className="text-xs text-slate-500">Día sin horas = no trabaja ese día. Solo recibe turnos dentro de su franja (y dentro del horario del negocio).</p>
                </div>
                <div className="space-y-1">
                  <span className="text-sm font-medium">Días libres / vacaciones</span>
                  <div className="flex flex-wrap gap-1">
                    {libres.map((f) => (
                      <span key={f} className="flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 text-xs">
                        {f.split('-').reverse().join('/')}
                        <button type="button" className="text-red-500" aria-label={`Quitar ${f}`} onClick={() => setLibres(libres.filter((x) => x !== f))}>
                          ×
                        </button>
                      </span>
                    ))}
                    {libres.length === 0 && <span className="text-xs text-slate-400">Sin días libres cargados.</span>}
                  </div>
                  <div className="flex gap-2">
                    <input className={`${inputClass} w-40`} type="date" value={nuevoLibre} onChange={(e) => setNuevoLibre(e.target.value)} />
                    <Button
                      variant="ghost"
                      disabled={!nuevoLibre || libres.includes(nuevoLibre)}
                      onClick={() => {
                        setLibres([...libres, nuevoLibre].sort());
                        setNuevoLibre('');
                      }}
                    >
                      Agregar día
                    </Button>
                  </div>
                </div>
              </>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setSchedEmployee(null)}>
                Volver
              </Button>
              <Button variant="primary" type="submit" loading={guardando}>
                Guardar
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {editing && (
        <Modal
          title={editing === 'nuevo' ? 'Nuevo empleado' : `Editar a ${editing.firstName} ${editing.lastName}`}
          description={`Solo nombres y apellidos son obligatorios; todo lo demás se puede completar después.${isAdmin ? ' Los campos con * los definiste vos en "Campos obligatorios".' : ''}`}
          onClose={() => setEditing(null)}
          size="xl"
        >
          <form className="space-y-3" onSubmit={(e) => void save(e)}>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              <GroupTitle>Datos personales</GroupTitle>
              <Field label="Nombres *">
                <input className={inputClass} value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} required autoFocus />
              </Field>
              <Field label="Apellidos *">
                <input className={inputClass} value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} required />
              </Field>
              <Field label={lbl('ci_number', 'Cédula')}>
                <input className={inputClass} required={req('ci_number')} value={form.ci_number} onChange={(e) => setForm({ ...form, ci_number: e.target.value })} />
              </Field>
              <Field label={lbl('birth_date', 'Fecha de nacimiento')}>
                <input className={inputClass} type="date" required={req('birth_date')} value={form.birth_date} onChange={(e) => setForm({ ...form, birth_date: e.target.value })} />
              </Field>
              <Field label={lbl('phone', 'Teléfono')}>
                <input className={inputClass} required={req('phone')} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </Field>
              <Field label={lbl('email', 'Email')}>
                <input className={inputClass} type="email" required={req('email')} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </Field>
              <Field label={lbl('marital_status', 'Estado civil')}>
                <select className={inputClass} required={req('marital_status')} value={form.marital_status} onChange={(e) => setForm({ ...form, marital_status: e.target.value })}>
                  <option value="">—</option>
                  <option value="soltero">Soltero/a</option>
                  <option value="casado">Casado/a</option>
                  <option value="divorciado">Divorciado/a</option>
                  <option value="viudo">Viudo/a</option>
                  <option value="union_de_hecho">Unión de hecho</option>
                </select>
              </Field>
              <Field label={lbl('children_count', 'Cantidad de hijos')}>
                <input className={inputClass} type="number" min="0" max="30" placeholder="0 = no tiene" required={req('children_count')} value={form.children_count} onChange={(e) => setForm({ ...form, children_count: e.target.value })} />
              </Field>
              <Field label={lbl('address', 'Dirección')}>
                <input className={inputClass} required={req('address')} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
              </Field>

              <GroupTitle>Datos laborales</GroupTitle>
              <Field label={lbl('position', 'Cargo / puesto')}>
                <input className={inputClass} required={req('position')} value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} />
              </Field>
              <Field label={lbl('hired_at', 'Fecha de ingreso')}>
                <input className={inputClass} type="date" required={req('hired_at')} value={form.hired_at} onChange={(e) => setForm({ ...form, hired_at: e.target.value })} />
              </Field>
              <Field label={lbl('ips_number', 'Nro. de asegurado IPS')}>
                <input className={inputClass} required={req('ips_number')} value={form.ips_number} onChange={(e) => setForm({ ...form, ips_number: e.target.value })} />
              </Field>
              {isAdmin && (
                <Field label={lbl('salary', 'Salario (Gs; solo lo ven dueño y administradores)')}>
                  <MoneyInput required={req('salary')} value={form.salary} onChange={(salary) => setForm({ ...form, salary })} />
                </Field>
              )}
              <div className="col-span-2">
                <Field label="Notas">
                  <textarea className={`${inputClass} h-16`} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
                </Field>
              </div>

              <GroupTitle>Contacto de emergencia (a quién llamar si le pasa algo)</GroupTitle>
              <Field label={lbl('emergency_contact_name', 'Nombre')}>
                <input className={inputClass} required={req('emergency_contact_name')} value={form.emergency_contact_name} onChange={(e) => setForm({ ...form, emergency_contact_name: e.target.value })} />
              </Field>
              <Field label={lbl('emergency_contact_phone', 'Teléfono')}>
                <input className={inputClass} required={req('emergency_contact_phone')} value={form.emergency_contact_phone} onChange={(e) => setForm({ ...form, emergency_contact_phone: e.target.value })} />
              </Field>
              <Field label={lbl('emergency_contact_relation', 'Relación con el empleado')}>
                <input className={inputClass} list="relaciones-emergencia" placeholder="padre, madre, esposo/a…" required={req('emergency_contact_relation')} value={form.emergency_contact_relation} onChange={(e) => setForm({ ...form, emergency_contact_relation: e.target.value })} />
              </Field>
              <datalist id="relaciones-emergencia">
                {['padre', 'madre', 'esposo/a', 'hijo/a', 'hermano/a', 'abuelo/a', 'tío/a', 'amigo/a', 'otro'].map((r) => (
                  <option key={r} value={r} />
                ))}
              </datalist>
            </div>
            <div className="space-y-2">
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-0.5" checked={form.bookable} onChange={(e) => setForm({ ...form, bookable: e.target.checked })} />
                <span>
                  <b>Atiende clientes con turno</b>
                  <span className="block text-xs text-slate-500">Aparece en la agenda y el sistema le asigna turnos automáticamente (nunca dos a la misma hora). Destildalo para personal que no atiende clientes (limpieza, administración).</span>
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-0.5" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
                <span>
                  <b>Trabaja actualmente</b>
                  <span className="block text-xs text-slate-500">Destildalo si ya no trabaja en tu empresa: deja de recibir turnos y de aparecer en las listas, pero su historial se conserva.</span>
                </span>
              </label>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setEditing(null)}>
                Volver
              </Button>
              <Button variant="primary" type="submit" loading={guardando}>
                {editing === 'nuevo' ? 'Agregar al personal' : 'Guardar'}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {showCfg && (
        <Modal
          title="Campos obligatorios de la ficha"
          description="Definí qué datos son obligatorios al cargar un empleado en tu empresa. Se marcan con * y el sistema no deja guardar sin completarlos."
          onClose={() => setShowCfg(false)}
        >
          <form className="space-y-3" onSubmit={(e) => void saveCfg(e)}>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
              <label className="flex items-center gap-2 text-slate-400">
                <input type="checkbox" checked disabled /> Nombres (siempre)
              </label>
              <label className="flex items-center gap-2 text-slate-400">
                <input type="checkbox" checked disabled /> Apellidos (siempre)
              </label>
              {CONFIGURABLES.map((f) => (
                <label key={f.key} className="flex items-center gap-2">
                  <input type="checkbox" checked={cfg.includes(f.key)} onChange={(e) => setCfg(e.target.checked ? [...cfg, f.key] : cfg.filter((k) => k !== f.key))} />
                  {f.label}
                </label>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setShowCfg(false)}>
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
