'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

import { ApiError, api, sseUrl } from '../../../lib/api';
import { CustomerPicker, customerName, type PickedCustomer } from '../../../lib/customer-picker';
import { useAskText, useConfirm, useToast } from '../../../lib/feedback';
import { APPOINTMENT_STATUS, SOURCE_LABEL, errorMessage, statusOf } from '../../../lib/labels';
import {
  Badge,
  Button,
  EmptyRow,
  ErrorNote,
  Field,
  Modal,
  PageHeader,
  buttonGhost,
  buttonSoft,
  inputClass,
  tableCard,
} from '../../../lib/ui';

// Agenda del negocio (fase 1 auditoria de paneles 2026-09-05): la agenda del
// dia arriba y con fecha, alta en una ventana con la fecha adentro y un
// buscador de clientes (adios al desplegable de 50), y todas las acciones
// por turno: confirmar, atendido, no vino, reprogramar y cancelar con motivo.

const TZ = 'America/Asuncion';

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
interface Appointment {
  id: string;
  startsAt: string;
  endsAt: string;
  status: string;
  source: string;
  notes: string | null;
  customer: { id: string; firstName: string; lastName: string | null; phoneE164: string | null };
  service: { id: string; name: string; durationMin: number | null } | null;
  employee: { id: string; firstName: string; lastName: string } | null;
}
interface Service {
  id: string;
  name: string;
  isActive?: boolean;
}
interface Employee {
  id: string;
  firstName: string;
  lastName: string;
  bookable: boolean;
  isActive: boolean;
}

// Inputs compactos: inputClass trae w-full y para hora/fecha un ancho fijo
// chico es lo correcto.
const timeInput =
  'w-[5rem] rounded border border-slate-300 bg-white px-1 py-0.5 text-xs tabular-nums focus:border-sky-500 focus:outline-none';
const dateInput =
  'w-40 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm focus:border-sky-500 focus:outline-none';

const DIAS: { dow: string; label: string }[] = [
  { dow: '1', label: 'Lunes' },
  { dow: '2', label: 'Martes' },
  { dow: '3', label: 'Miércoles' },
  { dow: '4', label: 'Jueves' },
  { dow: '5', label: 'Viernes' },
  { dow: '6', label: 'Sábado' },
  { dow: '0', label: 'Domingo' },
];

function today(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: TZ });
}
function shiftDate(d: string, days: number): string {
  const x = new Date(`${d}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + days);
  return x.toISOString().slice(0, 10);
}
function hora(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
}
function fechaLarga(d: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  return new Date(`${d}T12:00:00Z`).toLocaleDateString('es-PY', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}
const nombreEmpleado = (e: { firstName: string; lastName: string } | null) =>
  e ? `${e.firstName} ${e.lastName}` : null;

/** Horarios libres para servicio + fecha (+ profesional). Dice por que esta vacio. */
function SlotSelect({
  branch,
  serviceId,
  date,
  employeeId,
  value,
  onChange,
}: {
  branch: string | undefined;
  serviceId: string;
  date: string;
  employeeId: string;
  value: string;
  onChange: (iso: string) => void;
}) {
  const [slots, setSlots] = useState<string[] | null>([]);
  useEffect(() => {
    if (!branch || !serviceId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setSlots([]);
      return;
    }
    setSlots(null);
    const params = new URLSearchParams({ branch_id: branch, service_id: serviceId, date });
    if (employeeId) params.set('employee_id', employeeId);
    api<string[]>(`/appointments/availability?${params.toString()}`)
      .then(setSlots)
      .catch(() => setSlots([]));
  }, [branch, serviceId, date, employeeId]);

  const sinServicio = !serviceId;
  const cargando = slots === null;
  const vacio = !cargando && slots.length === 0;
  return (
    <Field
      label={
        sinServicio
          ? 'Horario (elegí primero el servicio)'
          : cargando
            ? 'Horario (buscando…)'
            : `Horario (${slots.length} libre${slots.length === 1 ? '' : 's'})`
      }
    >
      <select
        className={inputClass}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required
        disabled={sinServicio || cargando || vacio}
      >
        <option value="">
          {sinServicio
            ? '—'
            : cargando
              ? 'Buscando horarios…'
              : vacio
                ? 'No hay horarios libres ese día'
                : 'Elegí un horario…'}
        </option>
        {(slots ?? []).map((s) => (
          <option key={s} value={s}>
            {hora(s)}
          </option>
        ))}
      </select>
    </Field>
  );
}

export default function SchedulePage() {
  const confirmar = useConfirm();
  const askText = useAskText();
  const toast = useToast();

  const [date, setDate] = useState(today());
  const [rows, setRows] = useState<Appointment[] | null>(null);
  const [branches, setBranches] = useState<{ id: string }[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [vista, setVista] = useState<'lista' | 'profesional'>('lista');
  const [highlight, setHighlight] = useState<string | null>(null);

  const branch = branches[0]?.id;

  // --- alta ---
  const [nuevo, setNuevo] = useState(false);
  const [nuevoForm, setNuevoForm] = useState({
    date: today(),
    customer: null as PickedCustomer | null,
    service_id: '',
    employee_id: '',
    slot: '',
    notes: '',
  });
  const [guardando, setGuardando] = useState(false);

  // --- reprogramar ---
  const [reprog, setReprog] = useState<Appointment | null>(null);
  const [reprogForm, setReprogForm] = useState({ date: '', employee_id: '', slot: '' });

  // --- horarios de atencion (se mudan a Ajustes en la fase 2) ---
  const [horarios, setHorarios] = useState(false);
  const [week, setWeek] = useState<Record<string, Franja[]>>({});
  const [closedDates, setClosedDates] = useState<string[]>([]);
  const [newClosed, setNewClosed] = useState('');
  const [conflicts, setConflicts] = useState<Conflict[] | null>(null);
  const [cancelMsg, setCancelMsg] = useState('');
  const [askMessage, setAskMessage] = useState(false);
  const [guardandoHorarios, setGuardandoHorarios] = useState(false);

  const load = useCallback(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    const from = `${date}T00:00:00-03:00`;
    const to = `${date}T23:59:59-03:00`;
    api<Appointment[]>(`/appointments?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
      .then((r) => {
        setRows(r);
        setError(null);
      })
      .catch((e) =>
        setError(
          e instanceof ApiError
            ? errorMessage(e)
            : 'No se pudo cargar la agenda: revisá la conexión y probá de nuevo en unos segundos.',
        ),
      );
  }, [date]);

  useEffect(() => {
    void api<{ id: string }[]>('/branches').then(setBranches).catch(() => setError('No se pudieron cargar las sucursales.'));
    void api<Service[]>('/catalog/services')
      .then((s) => setServices(s.filter((x) => x.isActive !== false)))
      .catch(() => undefined);
    void api<Employee[]>('/employees')
      .then((r) => setEmployees(r.filter((e) => e.bookable && e.isActive)))
      .catch(() => undefined);
  }, []);
  useEffect(() => load(), [load]);

  // Links desde otras pantallas: ?nuevo=1&customer=<id>&fecha=YYYY-MM-DD, ?horarios=1
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const fecha = q.get('fecha');
    if (fecha && /^\d{4}-\d{2}-\d{2}$/.test(fecha)) setDate(fecha);
    if (q.get('horarios') === '1') void openHorarios();
    if (q.get('nuevo') === '1') {
      const customerId = q.get('customer');
      setNuevoForm((f) => ({ ...f, date: fecha ?? today() }));
      if (customerId) {
        void api<PickedCustomer>(`/customers/${customerId}`)
          .then((c) => setNuevoForm((f) => ({ ...f, customer: c })))
          .catch(() => undefined);
      }
      setNuevo(true);
    }
  }, []);

  // Los turnos que entran por el bot aparecen solos (mismo stream que la bandeja).
  useEffect(() => {
    const source = new EventSource(sseUrl('/conversations/stream'));
    const onUpdate = (e: MessageEvent) => {
      const payload = JSON.parse(e.data as string) as { appointment_id?: string };
      if (payload.appointment_id) load();
    };
    source.addEventListener('conversation.updated', onUpdate);
    return () => source.close();
  }, [load]);

  const resumen = useMemo(() => {
    const r = rows ?? [];
    const cuenta = (s: string) => r.filter((a) => a.status === s).length;
    return {
      total: r.length,
      confirmados: cuenta('confirmed'),
      pendientes: cuenta('pending'),
      atendidos: cuenta('completed'),
      cancelados: cuenta('cancelled') + cuenta('no_show'),
    };
  }, [rows]);

  // ------------------------------- acciones -------------------------------

  async function crearTurno(e: React.FormEvent) {
    e.preventDefault();
    if (!branch || !nuevoForm.customer) return;
    setGuardando(true);
    try {
      const created = await api<Appointment>('/appointments', {
        method: 'POST',
        json: {
          branch_id: branch,
          customer_id: nuevoForm.customer.id,
          service_id: nuevoForm.service_id,
          starts_at: nuevoForm.slot,
          ...(nuevoForm.employee_id ? { employee_id: nuevoForm.employee_id } : {}),
          ...(nuevoForm.notes.trim() ? { notes: nuevoForm.notes.trim() } : {}),
        },
      });
      toast.success(
        `Turno agendado: ${customerName(nuevoForm.customer)}, ${fechaLarga(nuevoForm.date)} a las ${hora(nuevoForm.slot)}`,
      );
      setNuevo(false);
      setNuevoForm({ date: nuevoForm.date, customer: null, service_id: '', employee_id: '', slot: '', notes: '' });
      setHighlight(created.id);
      setTimeout(() => setHighlight(null), 6000);
      if (nuevoForm.date !== date) setDate(nuevoForm.date);
      else load();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setGuardando(false);
    }
  }

  async function transicion(a: Appointment, verb: 'confirm' | 'complete' | 'no-show', body: object = {}) {
    try {
      await api(`/appointments/${a.id}/${verb}`, { method: 'POST', json: body });
      toast.success(
        verb === 'confirm'
          ? `Turno de ${customerName(a.customer)} confirmado`
          : verb === 'complete'
            ? `${customerName(a.customer)} marcado como atendido`
            : `${customerName(a.customer)} marcado como "no vino"`,
      );
      load();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  async function noVino(a: Appointment) {
    const ok = await confirmar({
      title: `Marcar que ${customerName(a.customer)} no vino`,
      message: 'Queda registrado como ausencia en su historial. No se puede volver a un turno pendiente.',
      confirmLabel: 'No vino',
    });
    if (ok) await transicion(a, 'no-show');
  }

  async function cancelar(a: Appointment) {
    const reason = await askText({
      title: `Cancelar el turno de ${customerName(a.customer)}`,
      message: `${a.service?.name ?? 'Turno'} del ${fechaLarga(date)} a las ${hora(a.startsAt)}. El horario queda libre; el motivo queda en el historial.`,
      label: 'Motivo (opcional)',
      placeholder: 'Ej: el cliente avisó que no llega',
      required: false,
      confirmLabel: 'Cancelar el turno',
    });
    if (reason === null) return;
    try {
      await api(`/appointments/${a.id}/cancel`, { method: 'POST', json: reason ? { reason } : {} });
      toast.success('Turno cancelado');
      load();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  function openReprog(a: Appointment) {
    setReprogForm({ date, employee_id: a.employee?.id ?? '', slot: '' });
    setReprog(a);
  }

  async function reprogramar(e: React.FormEvent) {
    e.preventDefault();
    if (!reprog) return;
    setGuardando(true);
    try {
      const nuevoTurno = await api<Appointment>(`/appointments/${reprog.id}/reschedule`, {
        method: 'POST',
        json: {
          starts_at: reprogForm.slot,
          ...(reprogForm.employee_id ? { employee_id: reprogForm.employee_id } : {}),
        },
      });
      toast.success(`Turno movido al ${fechaLarga(reprogForm.date)} a las ${hora(reprogForm.slot)}`);
      setReprog(null);
      setHighlight(nuevoTurno.id);
      setTimeout(() => setHighlight(null), 6000);
      if (reprogForm.date !== date) setDate(reprogForm.date);
      else load();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setGuardando(false);
    }
  }

  // --------------------------- horarios de atencion --------------------------

  async function openHorarios() {
    if (!branch) {
      // La sucursal llega asincrona: reintento corto.
      setTimeout(() => void openHorarios(), 400);
      return;
    }
    try {
      const s = await api<{ week: Record<string, Franja[]> | null; closed_dates: string[] }>(
        `/branches/${branch}/schedule`,
      );
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
      setHorarios(true);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  async function saveSchedule(onConflict: 'abort' | 'keep' | 'cancel_notify') {
    if (!branch) return;
    setGuardandoHorarios(true);
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
      setHorarios(false);
      toast.success(
        onConflict === 'cancel_notify'
          ? `Horarios guardados; ${res.conflicts} turno(s) cancelados y avisados por chat`
          : onConflict === 'keep'
            ? `Horarios guardados (los ${res.conflicts} turno(s) existentes se mantienen)`
            : 'Horarios de atención guardados',
      );
      load();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setConflicts(((e.problem as { conflicts?: Conflict[] }).conflicts ?? []) as Conflict[]);
        return;
      }
      toast.error(errorMessage(e));
    } finally {
      setGuardandoHorarios(false);
    }
  }

  // --------------------------------- render ---------------------------------

  const activos = (a: Appointment) => ['pending', 'confirmed'].includes(a.status);

  const acciones = (a: Appointment) => (
    <span className="inline-flex flex-wrap justify-end gap-1">
      {a.status === 'pending' && (
        <button className={buttonSoft} onClick={() => void transicion(a, 'confirm')}>
          Confirmar
        </button>
      )}
      {activos(a) && (
        <>
          <button className={buttonGhost} onClick={() => void transicion(a, 'complete')}>
            Atendido
          </button>
          <button className={buttonGhost} onClick={() => void noVino(a)}>
            No vino
          </button>
          <button className={buttonGhost} onClick={() => openReprog(a)}>
            Reprogramar
          </button>
          <button className={buttonGhost} onClick={() => void cancelar(a)}>
            Cancelar
          </button>
        </>
      )}
      {a.status === 'completed' && (
        <Link
          className={buttonSoft}
          href={`/app/invoices?nueva=1&customer=${a.customer.id}${a.service ? `&service=${a.service.id}` : ''}`}
        >
          Cobrar
        </Link>
      )}
    </span>
  );

  const porEmpleado = useMemo(() => {
    const grupos = new Map<string, { nombre: string; turnos: Appointment[] }>();
    for (const e of employees) grupos.set(e.id, { nombre: `${e.firstName} ${e.lastName}`, turnos: [] });
    for (const a of rows ?? []) {
      const key = a.employee?.id ?? 'sin';
      if (!grupos.has(key)) grupos.set(key, { nombre: nombreEmpleado(a.employee) ?? 'Sin profesional asignado', turnos: [] });
      grupos.get(key)!.turnos.push(a);
    }
    return [...grupos.values()];
  }, [rows, employees]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Agenda"
        description={`${fechaLarga(date)} · ${resumen.total} turno${resumen.total === 1 ? '' : 's'}${
          resumen.total > 0
            ? ` · ${resumen.confirmados} confirmado${resumen.confirmados === 1 ? '' : 's'} · ${resumen.pendientes} a confirmar${
                resumen.atendidos ? ` · ${resumen.atendidos} atendido${resumen.atendidos === 1 ? '' : 's'}` : ''
              }${resumen.cancelados ? ` · ${resumen.cancelados} cancelado${resumen.cancelados === 1 ? '' : 's'}` : ''}`
            : ''
        }`}
        actions={
          <>
            <span className="inline-flex items-center gap-1">
              <button className={buttonGhost} aria-label="Día anterior" onClick={() => setDate(shiftDate(date, -1))}>
                ‹
              </button>
              <button className={buttonGhost} onClick={() => setDate(today())} disabled={date === today()}>
                Hoy
              </button>
              <button className={buttonGhost} aria-label="Día siguiente" onClick={() => setDate(shiftDate(date, 1))}>
                ›
              </button>
              <input type="date" className={dateInput} value={date} onChange={(e) => setDate(e.target.value)} />
            </span>
            {employees.length > 0 && (
              <span className="inline-flex rounded-md border border-slate-300 text-sm">
                <button
                  className={`px-3 py-1.5 ${vista === 'lista' ? 'bg-slate-100 font-medium' : 'text-slate-600'}`}
                  onClick={() => setVista('lista')}
                >
                  Lista
                </button>
                <button
                  className={`border-l border-slate-300 px-3 py-1.5 ${vista === 'profesional' ? 'bg-slate-100 font-medium' : 'text-slate-600'}`}
                  onClick={() => setVista('profesional')}
                >
                  Por profesional
                </button>
              </span>
            )}
            <button className={buttonGhost} onClick={() => void openHorarios()}>
              Horarios de atención
            </button>
            <Button
              variant="primary"
              onClick={() => {
                setNuevoForm((f) => ({ ...f, date }));
                setNuevo(true);
              }}
            >
              Nuevo turno
            </Button>
          </>
        }
      />
      <ErrorNote error={error} />

      {vista === 'lista' || employees.length === 0 ? (
        <div className={tableCard}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Hora</th>
                <th>Cliente</th>
                <th>Servicio</th>
                <th>Atiende</th>
                <th>Estado</th>
                <th>Origen</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {(rows ?? []).map((a) => {
                const st = statusOf(APPOINTMENT_STATUS, a.status);
                return (
                  <tr
                    key={a.id}
                    className={`${highlight === a.id ? 'bg-emerald-50' : 'hover:bg-slate-50'} ${
                      ['cancelled', 'no_show'].includes(a.status) ? 'text-slate-400' : ''
                    }`}
                  >
                    <td className="whitespace-nowrap tabular-nums">
                      {hora(a.startsAt)}
                      <span className="text-slate-400"> – {hora(a.endsAt)}</span>
                    </td>
                    <td>
                      <Link className="font-medium text-sky-700 hover:underline" href={`/app/customers/${a.customer.id}`}>
                        {customerName(a.customer)}
                      </Link>
                      {a.customer.phoneE164 && <span className="block text-xs text-slate-400">{a.customer.phoneE164}</span>}
                    </td>
                    <td>
                      {a.service?.name ?? '—'}
                      {a.notes && <span className="block max-w-[16rem] truncate text-xs text-slate-400" title={a.notes}>{a.notes}</span>}
                    </td>
                    <td>{nombreEmpleado(a.employee) ?? '—'}</td>
                    <td>
                      <Badge tone={st.tone}>{st.label}</Badge>
                    </td>
                    <td className="text-xs text-slate-500">{SOURCE_LABEL[a.source] ?? a.source}</td>
                    <td className="text-right">{acciones(a)}</td>
                  </tr>
                );
              })}
              {rows && rows.length === 0 && (
                <EmptyRow
                  colSpan={7}
                  action={
                    <Button
                      variant="soft"
                      onClick={() => {
                        setNuevoForm((f) => ({ ...f, date }));
                        setNuevo(true);
                      }}
                    >
                      Agendar el primero
                    </Button>
                  }
                >
                  Sin turnos para el {fechaLarga(date)}
                </EmptyRow>
              )}
              {rows === null && !error && <EmptyRow colSpan={7}>Cargando la agenda…</EmptyRow>}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {porEmpleado.map((g) => (
            <section key={g.nombre} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
              <h2 className="mb-2 flex items-center justify-between font-medium text-slate-900">
                {g.nombre}
                <span className="text-xs font-normal text-slate-400">
                  {g.turnos.length} turno{g.turnos.length === 1 ? '' : 's'}
                </span>
              </h2>
              <ul className="space-y-2">
                {g.turnos.map((a) => {
                  const st = statusOf(APPOINTMENT_STATUS, a.status);
                  return (
                    <li
                      key={a.id}
                      className={`rounded-md border p-2 text-sm ${highlight === a.id ? 'border-emerald-300 bg-emerald-50' : 'border-slate-100'}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium tabular-nums">
                          {hora(a.startsAt)}–{hora(a.endsAt)}
                        </span>
                        <Badge tone={st.tone}>{st.label}</Badge>
                      </div>
                      <Link className="text-sky-700 hover:underline" href={`/app/customers/${a.customer.id}`}>
                        {customerName(a.customer)}
                      </Link>
                      <span className="block text-xs text-slate-500">{a.service?.name ?? '—'}</span>
                      <div className="mt-2 text-right">{acciones(a)}</div>
                    </li>
                  );
                })}
                {g.turnos.length === 0 && <li className="py-3 text-center text-xs text-slate-400">Libre todo el día</li>}
              </ul>
            </section>
          ))}
        </div>
      )}

      {/* ------------------------------ Nuevo turno ------------------------------ */}
      {nuevo && (
        <Modal
          title="Nuevo turno"
          description="Elegí cliente, servicio y horario. Si el cliente no existe, lo creás desde el buscador."
          onClose={() => setNuevo(false)}
          size="lg"
        >
          <form className="grid gap-3 md:grid-cols-2" onSubmit={(e) => void crearTurno(e)}>
            <Field label="Fecha">
              <input
                type="date"
                className={inputClass}
                value={nuevoForm.date}
                onChange={(e) => setNuevoForm({ ...nuevoForm, date: e.target.value, slot: '' })}
                required
              />
            </Field>
            <div className="md:col-span-2 md:-order-1">
              <Field label="Cliente">
                <CustomerPicker
                  value={nuevoForm.customer}
                  onChange={(c) => setNuevoForm({ ...nuevoForm, customer: c })}
                  autoFocus={!nuevoForm.customer}
                />
              </Field>
            </div>
            <Field label="Servicio">
              <select
                className={inputClass}
                value={nuevoForm.service_id}
                onChange={(e) => setNuevoForm({ ...nuevoForm, service_id: e.target.value, slot: '' })}
                required
              >
                <option value="">Elegí un servicio…</option>
                {services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
            {employees.length > 0 && (
              <Field label="Atiende">
                <select
                  className={inputClass}
                  value={nuevoForm.employee_id}
                  onChange={(e) => setNuevoForm({ ...nuevoForm, employee_id: e.target.value, slot: '' })}
                >
                  <option value="">Cualquiera (se asigna al menos cargado)</option>
                  {employees.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.firstName} {e.lastName}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <SlotSelect
              branch={branch}
              serviceId={nuevoForm.service_id}
              date={nuevoForm.date}
              employeeId={nuevoForm.employee_id}
              value={nuevoForm.slot}
              onChange={(slot) => setNuevoForm({ ...nuevoForm, slot })}
            />
            <div className="md:col-span-2">
              <Field label="Nota para el equipo (opcional)">
                <input
                  className={inputClass}
                  placeholder="Ej: trae foto de referencia; alérgica al amoníaco"
                  value={nuevoForm.notes}
                  onChange={(e) => setNuevoForm({ ...nuevoForm, notes: e.target.value })}
                />
              </Field>
            </div>
            <div className="flex justify-end gap-2 md:col-span-2">
              <Button variant="ghost" onClick={() => setNuevo(false)}>
                Volver
              </Button>
              <Button variant="primary" type="submit" loading={guardando} disabled={!nuevoForm.customer || !nuevoForm.slot}>
                Agendar
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* ------------------------------ Reprogramar ------------------------------ */}
      {reprog && (
        <Modal
          title={`Reprogramar a ${customerName(reprog.customer)}`}
          description={`${reprog.service?.name ?? 'Turno'} · hoy ${fechaLarga(date)} a las ${hora(reprog.startsAt)}${
            reprog.employee ? ` con ${nombreEmpleado(reprog.employee)}` : ''
          }. Se cancela el actual y se crea el nuevo; si algo falla, el original queda como está.`}
          onClose={() => setReprog(null)}
        >
          <form className="grid gap-3 md:grid-cols-2" onSubmit={(e) => void reprogramar(e)}>
            <Field label="Nueva fecha">
              <input
                type="date"
                className={inputClass}
                value={reprogForm.date}
                onChange={(e) => setReprogForm({ ...reprogForm, date: e.target.value, slot: '' })}
                required
              />
            </Field>
            {employees.length > 0 && (
              <Field label="Atiende">
                <select
                  className={inputClass}
                  value={reprogForm.employee_id}
                  onChange={(e) => setReprogForm({ ...reprogForm, employee_id: e.target.value, slot: '' })}
                >
                  <option value="">Cualquiera</option>
                  {employees.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.firstName} {e.lastName}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <div className="md:col-span-2">
              <SlotSelect
                branch={branch}
                serviceId={reprog.service?.id ?? ''}
                date={reprogForm.date}
                employeeId={reprogForm.employee_id}
                value={reprogForm.slot}
                onChange={(slot) => setReprogForm({ ...reprogForm, slot })}
              />
            </div>
            <div className="flex justify-end gap-2 md:col-span-2">
              <Button variant="ghost" onClick={() => setReprog(null)}>
                Volver
              </Button>
              <Button variant="primary" type="submit" loading={guardando} disabled={!reprogForm.slot}>
                Mover el turno
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* --------------------------- Horarios de atencion --------------------------- */}
      {horarios && (
        <Modal
          title="Horarios de atención"
          description="Hasta dos franjas por día: el hueco entre ambas es el corte del mediodía. Destildá un día para cerrarlo. Nada se agenda fuera de estas franjas."
          onClose={() => setHorarios(false)}
          size="xl"
        >
          <div className="grid gap-x-8 gap-y-4 lg:grid-cols-[auto_minmax(220px,1fr)]">
            <div className="overflow-x-auto">
              <div className="w-fit text-sm">
                <div className="grid grid-cols-[5.5rem_10rem_12rem] gap-x-3 pb-1 text-[11px] uppercase tracking-wide text-slate-400">
                  <span>Día</span>
                  <span>Mañana / única</span>
                  <span>Tarde (2ª franja)</span>
                </div>
                {DIAS.map(({ dow, label }) => {
                  const franjas = week[dow] ?? [];
                  const abierto = franjas.length > 0;
                  const f1 = franjas[0] ?? { from: '', to: '' };
                  const f2 = franjas[1] ?? { from: '', to: '' };
                  return (
                    <div key={dow} className="grid grid-cols-[5.5rem_10rem_12rem] items-center gap-x-3 border-t border-slate-50 py-1">
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={abierto}
                          onChange={(e) => setWeek({ ...week, [dow]: e.target.checked ? [{ from: '08:00', to: '18:00' }] : [] })}
                        />
                        {label}
                      </label>
                      {abierto ? (
                        <>
                          <div className="flex items-center gap-1">
                            <input type="time" className={timeInput} value={f1.from} onChange={(e) => setWeek({ ...week, [dow]: [{ ...f1, from: e.target.value }, ...(franjas[1] ? [f2] : [])] })} />
                            <span className="text-slate-400">–</span>
                            <input type="time" className={timeInput} value={f1.to} onChange={(e) => setWeek({ ...week, [dow]: [{ ...f1, to: e.target.value }, ...(franjas[1] ? [f2] : [])] })} />
                          </div>
                          {franjas[1] ? (
                            <div className="flex items-center gap-1">
                              <input type="time" className={timeInput} value={f2.from} onChange={(e) => setWeek({ ...week, [dow]: [f1, { ...f2, from: e.target.value }] })} />
                              <span className="text-slate-400">–</span>
                              <input type="time" className={timeInput} value={f2.to} onChange={(e) => setWeek({ ...week, [dow]: [f1, { ...f2, to: e.target.value }] })} />
                              <button type="button" className="ml-1 text-xs text-red-600 hover:underline" aria-label="Quitar la segunda franja" onClick={() => setWeek({ ...week, [dow]: [f1] })}>
                                ✕
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              className="w-fit text-xs text-sky-700 hover:underline"
                              onClick={() => setWeek({ ...week, [dow]: [{ ...f1, to: '12:00' }, { from: '13:00', to: f1.to || '18:00' }] })}
                            >
                              + corte al mediodía
                            </button>
                          )}
                        </>
                      ) : (
                        <>
                          <span className="text-xs text-slate-400">cerrado</span>
                          <span />
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="lg:border-l lg:border-slate-100 lg:pl-6">
              <p className="mb-1 text-sm font-medium">Días cerrados</p>
              <p className="mb-2 text-xs text-slate-500">Feriados o vacaciones puntuales.</p>
              <div className="mb-2 flex items-center gap-2">
                <input type="date" className={`${dateInput} w-36 py-1 text-xs`} value={newClosed} onChange={(e) => setNewClosed(e.target.value)} />
                <Button
                  variant="ghost"
                  disabled={!/^\d{4}-\d{2}-\d{2}$/.test(newClosed) || closedDates.includes(newClosed)}
                  onClick={() => {
                    setClosedDates([...closedDates, newClosed].sort());
                    setNewClosed('');
                  }}
                >
                  Agregar día
                </Button>
              </div>
              <div className="flex max-h-40 flex-wrap content-start gap-1.5 overflow-y-auto">
                {closedDates.map((d) => (
                  <span key={d} className="flex h-fit items-center gap-1 rounded bg-slate-100 px-2 py-0.5 text-xs">
                    {d.split('-').reverse().join('/')}
                    <button type="button" className="text-red-600" aria-label={`Quitar ${d}`} onClick={() => setClosedDates(closedDates.filter((x) => x !== d))}>
                      ✕
                    </button>
                  </span>
                ))}
                {closedDates.length === 0 && <p className="text-xs text-slate-400">Ninguno cargado.</p>}
              </div>
            </div>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setHorarios(false)}>
              Volver
            </Button>
            <Button variant="primary" loading={guardandoHorarios} onClick={() => void saveSchedule('abort')}>
              Guardar horarios
            </Button>
          </div>
        </Modal>
      )}

      {conflicts && (
        <Modal
          title={`Hay ${conflicts.length} turno${conflicts.length === 1 ? '' : 's'} en el horario que querés cerrar`}
          description="Podés guardar igual y dejar esos turnos como están, o cancelarlos avisando a los clientes por chat."
          onClose={() => {
            setConflicts(null);
            setAskMessage(false);
          }}
          role="alertdialog"
        >
          <ul className="max-h-40 space-y-1 overflow-y-auto text-sm">
            {conflicts.map((c) => (
              <li key={c.id} className="rounded bg-slate-50 px-2 py-1">
                {c.fecha.split('-').reverse().join('/')} {c.hora} — {c.cliente} ({c.servicio})
              </li>
            ))}
          </ul>
          {askMessage && (
            <div className="mt-3">
              <Field label="Mensaje para esos clientes (se envía al cancelar)">
                <textarea
                  className={`${inputClass} h-20`}
                  placeholder="Ej: por un imprevisto debemos reprogramar; escribinos y coordinamos un nuevo horario."
                  value={cancelMsg}
                  onChange={(e) => setCancelMsg(e.target.value)}
                />
              </Field>
            </div>
          )}
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                setConflicts(null);
                setAskMessage(false);
              }}
            >
              Volver
            </Button>
            <Button variant="ghost" loading={guardandoHorarios} onClick={() => void saveSchedule('keep')}>
              Guardar y mantener esos turnos
            </Button>
            {askMessage ? (
              <Button
                variant="danger-solid"
                loading={guardandoHorarios}
                disabled={cancelMsg.trim().length < 3}
                onClick={() => void saveSchedule('cancel_notify')}
              >
                Cancelar esos turnos y avisar
              </Button>
            ) : (
              <Button variant="danger" onClick={() => setAskMessage(true)}>
                Cancelarlos y avisar a los clientes…
              </Button>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
