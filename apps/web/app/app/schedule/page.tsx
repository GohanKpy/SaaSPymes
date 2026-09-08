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
// buscador de clientes, y todas las acciones por turno: confirmar, atendido,
// no vino, reprogramar y cancelar con motivo.
// 2026-09-07 (pedido de Johan): solo se agendan SERVICIOS (los items del
// catalogo no aparecen), un turno puede combinar varios servicios y la
// duracion total se calcula (el mas largo entero + lo que suma cada otro) y
// se puede ajustar a mano antes de buscar horario.

const TZ = 'America/Asuncion';
const DURACION_DEFAULT = 30;

interface Appointment {
  id: string;
  startsAt: string;
  endsAt: string;
  status: string;
  source: string;
  notes: string | null;
  customer: { id: string; firstName: string; lastName: string | null; phoneE164: string | null; billingMode?: string };
  service: { id: string; name: string; durationMin: number | null } | null;
  services: { id: string; name: string; durationMin: number }[];
  employee: { id: string; firstName: string; lastName: string } | null;
  recurringBookingId?: string | null;
  confirmationRequestedAt?: string | null;
}
interface Service {
  id: string;
  name: string;
  kind: string;
  durationMin: number | null;
  comboDurationMin: number | null;
  isActive?: boolean;
}
interface Employee {
  id: string;
  firstName: string;
  lastName: string;
  bookable: boolean;
  isActive: boolean;
}

// Input compacto: inputClass trae w-full y para la fecha un ancho fijo es lo correcto.
const dateInput =
  'w-40 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm focus:border-sky-500 focus:outline-none';

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

/** Nombres de los servicios del turno ("Corte + Color"); cae al principal en turnos viejos. */
const nombreServicios = (a: Appointment) =>
  a.services?.length ? a.services.map((s) => s.name).join(' + ') : (a.service?.name ?? null);

const idsServicios = (a: Appointment) => (a.services?.length ? a.services.map((s) => s.id) : a.service ? [a.service.id] : []);

const minutosTurno = (a: Appointment) => Math.max(5, Math.round((new Date(a.endsAt).getTime() - new Date(a.startsAt).getTime()) / 60_000));

/**
 * Misma regla que el servidor (que es quien manda): el servicio mas largo
 * cuenta entero; los demas suman su "duracion cuando se combina" o la completa.
 */
function duracionCalculada(elegidos: Service[]): number {
  if (elegidos.length === 0) return 0;
  const full = elegidos.map((s) => s.durationMin ?? DURACION_DEFAULT);
  const principal = full.indexOf(Math.max(...full));
  return elegidos.reduce((acc, s, i) => acc + (i === principal ? full[i]! : (s.comboDurationMin ?? full[i]!)), 0);
}

/** Elegir uno o varios servicios y ver/ajustar la duracion total. */
function ServiciosPicker({
  services,
  value,
  duracion,
  onChange,
}: {
  services: Service[];
  value: string[];
  /** '' = usar la calculada */
  duracion: string;
  onChange: (ids: string[], duracion: string) => void;
}) {
  const elegidos = value.map((id) => services.find((s) => s.id === id)).filter((s): s is Service => Boolean(s));
  const calculada = duracionCalculada(elegidos);
  const ajustada = duracion !== '' && Number(duracion) !== calculada;
  return (
    <div className="space-y-2">
      <Field label={`Servicios${value.length > 1 ? ` (${value.length})` : ''} *`}>
        <div className="max-h-44 space-y-0.5 overflow-y-auto rounded-md border border-slate-300 p-1.5">
          {services.map((s) => {
            const marcado = value.includes(s.id);
            return (
              <label key={s.id} className={`flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-slate-50 ${marcado ? 'bg-sky-50' : ''}`}>
                <input
                  type="checkbox"
                  checked={marcado}
                  onChange={(e) => onChange(e.target.checked ? [...value, s.id] : value.filter((id) => id !== s.id), '')}
                />
                <span className="flex-1">{s.name}</span>
                <span className="text-xs text-slate-400">
                  {s.durationMin ?? DURACION_DEFAULT} min
                  {s.comboDurationMin ? ` · ${s.comboDurationMin} si se combina` : ''}
                </span>
              </label>
            );
          })}
          {services.length === 0 && <p className="px-1.5 py-2 text-sm text-slate-400">No hay servicios activos en el catálogo.</p>}
        </div>
      </Field>
      {value.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-slate-600">Duración total</span>
          <input
            type="number"
            min={5}
            max={720}
            step={5}
            className="w-20 rounded-md border border-slate-300 px-2 py-1 text-sm"
            value={duracion === '' ? calculada : duracion}
            onChange={(e) => onChange(value, e.target.value)}
            aria-label="Duración total en minutos"
          />
          <span className="text-slate-600">min</span>
          {ajustada ? (
            <button type="button" className="text-xs text-sky-700 hover:underline" onClick={() => onChange(value, '')}>
              Volver a la calculada ({calculada} min)
            </button>
          ) : (
            <span className="text-xs text-slate-400">
              {value.length > 1 ? 'calculada: el más largo entero + lo que suma cada otro; podés ajustarla' : 'la del servicio; podés ajustarla'}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/** Horarios libres para servicios + duracion + fecha (+ profesional). Dice por que esta vacio. */
function SlotSelect({
  branch,
  serviceIds,
  durationMin,
  date,
  employeeId,
  employeeName,
  value,
  onChange,
}: {
  branch: string | undefined;
  serviceIds: string[];
  durationMin: number | null;
  date: string;
  employeeId: string;
  employeeName?: string;
  value: string;
  onChange: (iso: string) => void;
}) {
  const [slots, setSlots] = useState<string[] | null>([]);
  const idsKey = serviceIds.join(',');
  useEffect(() => {
    if (!branch || !idsKey || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setSlots([]);
      return;
    }
    setSlots(null);
    const params = new URLSearchParams({ branch_id: branch, service_ids: idsKey, date });
    if (employeeId) params.set('employee_id', employeeId);
    if (durationMin) params.set('duration_min', String(durationMin));
    api<string[]>(`/appointments/availability?${params.toString()}`)
      .then(setSlots)
      .catch(() => setSlots([]));
  }, [branch, idsKey, durationMin, date, employeeId]);

  const sinServicio = !idsKey;
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
                ? employeeName
                  ? `${employeeName} no tiene horarios libres ese día: probá otro día o "Cualquiera"`
                  : 'No hay horarios libres ese día'
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

const NUEVO_VACIO = {
  date: today(),
  customer: null as PickedCustomer | null,
  service_ids: [] as string[],
  duracion: '',
  employee_id: '',
  slot: '',
  notes: '',
};

export default function SchedulePage() {
  const confirmar = useConfirm();
  const askText = useAskText();
  const toast = useToast();

  const [date, setDate] = useState(today());
  const [rows, setRows] = useState<Appointment[] | null>(null);
  const [branches, setBranches] = useState<{ id: string }[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  // null = todavia no cargo; [] = el negocio no tiene empleados que atiendan
  // turnos (desde 2026-09-08 sin empleado no se agenda).
  const [employeesLoaded, setEmployeesLoaded] = useState<Employee[] | null>(null);
  const employees = useMemo(() => employeesLoaded ?? [], [employeesLoaded]);
  const sinEquipo = employeesLoaded !== null && employeesLoaded.length === 0;
  const [error, setError] = useState<string | null>(null);
  const [vista, setVista] = useState<'lista' | 'profesional'>('lista');
  const [highlight, setHighlight] = useState<string | null>(null);

  const branch = branches[0]?.id;

  // --- alta ---
  const [nuevo, setNuevo] = useState(false);
  const [nuevoForm, setNuevoForm] = useState(NUEVO_VACIO);
  const [guardando, setGuardando] = useState(false);

  // --- reprogramar ---
  const [reprog, setReprog] = useState<Appointment | null>(null);
  const [reprogForm, setReprogForm] = useState({ date: '', employee_id: '', slot: '' });

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
    // Solo servicios: los items (productos) no se agendan desde el panel.
    void api<Service[]>('/catalog/services')
      .then((s) => setServices(s.filter((x) => x.isActive !== false && x.kind === 'servicio')))
      .catch(() => undefined);
    void api<Employee[]>('/employees')
      .then((r) => setEmployeesLoaded(r.filter((e) => e.bookable && e.isActive)))
      .catch(() => undefined);
  }, []);
  useEffect(() => load(), [load]);

  // Links desde otras pantallas: ?nuevo=1&customer=<id>&fecha=YYYY-MM-DD
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const fecha = q.get('fecha');
    if (fecha && /^\d{4}-\d{2}-\d{2}$/.test(fecha)) setDate(fecha);
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

  const duracionNuevo = useMemo(() => {
    if (nuevoForm.duracion !== '') return Number(nuevoForm.duracion) || null;
    const elegidos = nuevoForm.service_ids.map((id) => services.find((s) => s.id === id)).filter((s): s is Service => Boolean(s));
    return elegidos.length ? duracionCalculada(elegidos) : null;
  }, [nuevoForm.duracion, nuevoForm.service_ids, services]);

  // ------------------------------- acciones -------------------------------

  async function crearTurno(e: React.FormEvent) {
    e.preventDefault();
    if (!branch || !nuevoForm.customer || nuevoForm.service_ids.length === 0) return;
    setGuardando(true);
    try {
      const created = await api<Appointment>('/appointments', {
        method: 'POST',
        json: {
          branch_id: branch,
          customer_id: nuevoForm.customer.id,
          service_ids: nuevoForm.service_ids,
          ...(nuevoForm.duracion !== '' ? { duration_min: Number(nuevoForm.duracion) } : {}),
          starts_at: nuevoForm.slot,
          ...(nuevoForm.employee_id ? { employee_id: nuevoForm.employee_id } : {}),
          ...(nuevoForm.notes.trim() ? { notes: nuevoForm.notes.trim() } : {}),
        },
      });
      toast.success(
        `Turno agendado: ${customerName(nuevoForm.customer)}, ${fechaLarga(nuevoForm.date)} a las ${hora(nuevoForm.slot)}${
          nuevoForm.service_ids.length > 1 ? ` (${nuevoForm.service_ids.length} servicios)` : ''
        }`,
      );
      setNuevo(false);
      setNuevoForm({ ...NUEVO_VACIO, date: nuevoForm.date });
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
      message: `${nombreServicios(a) ?? 'Turno'} del ${fechaLarga(date)} a las ${hora(a.startsAt)}. El horario queda libre; el motivo queda en el historial.`,
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
      {a.status === 'completed' &&
        (a.customer.billingMode === 'monthly' ? (
          <Link className={buttonGhost} href={`/app/invoices?vista=cuentas`} title="Este cliente factura por cuenta mensual: lo atendido ya está en su cuenta">
            En su cuenta del mes
          </Link>
        ) : (
          <Link
            className={buttonSoft}
            href={`/app/invoices?nueva=1&customer=${a.customer.id}${idsServicios(a).length ? `&services=${idsServicios(a).join(',')}` : ''}`}
          >
            Cobrar
          </Link>
        ))}
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
            <Link className={buttonGhost} href="/app/settings/horarios">
              Horarios de atención
            </Link>
            <Button
              variant="primary"
              disabled={sinEquipo}
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
      {sinEquipo && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Todo turno se asigna a un empleado. Para agendar (desde acá o por WhatsApp) hace falta al menos un empleado con
          &quot;Atiende clientes con turno&quot; tildado:{' '}
          <Link className="font-medium underline" href="/app/employees">
            cargalo en Personal
          </Link>
          .
        </p>
      )}

      {vista === 'lista' || employees.length === 0 ? (
        <div className={tableCard}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Hora</th>
                <th>Cliente</th>
                <th>Servicios</th>
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
                      <span className="block text-xs text-slate-400">{minutosTurno(a)} min</span>
                    </td>
                    <td>
                      <Link className="font-medium text-sky-700 hover:underline" href={`/app/customers/${a.customer.id}`}>
                        {customerName(a.customer)}
                      </Link>
                      {a.customer.phoneE164 && <span className="block text-xs text-slate-400">{a.customer.phoneE164}</span>}
                    </td>
                    <td>
                      {nombreServicios(a) ?? '—'}
                      {a.notes && <span className="block max-w-[16rem] truncate text-xs text-slate-400" title={a.notes}>{a.notes}</span>}
                    </td>
                    <td>{nombreEmpleado(a.employee) ?? '—'}</td>
                    <td>
                      <span className="inline-flex flex-wrap items-center gap-1">
                        <Badge tone={st.tone}>{st.label}</Badge>
                        {a.confirmationRequestedAt && a.status === 'pending' && <Badge tone="amber">esperando al cliente</Badge>}
                      </span>
                    </td>
                    <td className="text-xs text-slate-500">
                      {SOURCE_LABEL[a.source] ?? a.source}
                      {a.recurringBookingId && <span className="block text-violet-700">recurrente</span>}
                    </td>
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
                      <span className="block text-xs text-slate-500">{nombreServicios(a) ?? '—'}</span>
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
          description="Elegí cliente, uno o más servicios y horario. Si el cliente no existe, lo creás desde el buscador."
          onClose={() => setNuevo(false)}
          size="lg"
        >
          <form className="grid gap-3 md:grid-cols-2" onSubmit={(e) => void crearTurno(e)}>
            <div className="md:col-span-2">
              <Field label="Cliente *">
                <CustomerPicker
                  value={nuevoForm.customer}
                  onChange={(c) => setNuevoForm({ ...nuevoForm, customer: c })}
                  autoFocus={!nuevoForm.customer}
                />
              </Field>
            </div>
            <div className="md:col-span-2">
              <ServiciosPicker
                services={services}
                value={nuevoForm.service_ids}
                duracion={nuevoForm.duracion}
                onChange={(service_ids, duracion) => setNuevoForm({ ...nuevoForm, service_ids, duracion, slot: '' })}
              />
            </div>
            <Field label="Fecha">
              <input
                type="date"
                className={inputClass}
                value={nuevoForm.date}
                onChange={(e) => setNuevoForm({ ...nuevoForm, date: e.target.value, slot: '' })}
                required
              />
            </Field>
            {employees.length > 0 && (
              <Field label="Atiende">
                <select
                  className={inputClass}
                  value={nuevoForm.employee_id}
                  onChange={(e) => setNuevoForm({ ...nuevoForm, employee_id: e.target.value, slot: '' })}
                >
                  <option value="">Cualquiera (se asigna al que esté libre con menos trabajo ese día)</option>
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
                serviceIds={nuevoForm.service_ids}
                durationMin={duracionNuevo}
                date={nuevoForm.date}
                employeeId={nuevoForm.employee_id}
                employeeName={nombreEmpleado(employees.find((e) => e.id === nuevoForm.employee_id) ?? null) ?? undefined}
                value={nuevoForm.slot}
                onChange={(slot) => setNuevoForm({ ...nuevoForm, slot })}
              />
            </div>
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
              <Button
                variant="primary"
                type="submit"
                loading={guardando}
                disabled={!nuevoForm.customer || nuevoForm.service_ids.length === 0 || !nuevoForm.slot}
              >
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
          description={`${nombreServicios(reprog) ?? 'Turno'} (${minutosTurno(reprog)} min) · hoy ${fechaLarga(date)} a las ${hora(reprog.startsAt)}${
            reprog.employee ? ` con ${nombreEmpleado(reprog.employee)}` : ''
          }. Se cancela el actual y se crea el nuevo con los mismos servicios y duración; si algo falla, el original queda como está.`}
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
                serviceIds={idsServicios(reprog)}
                durationMin={minutosTurno(reprog)}
                date={reprogForm.date}
                employeeId={reprogForm.employee_id}
                employeeName={nombreEmpleado(employees.find((e) => e.id === reprogForm.employee_id) ?? null) ?? undefined}
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
    </div>
  );
}
