'use client';

import { useCallback, useEffect, useState } from 'react';

import { ApiError, api } from '../../../../lib/api';
import { useToast } from '../../../../lib/feedback';
import { errorMessage } from '../../../../lib/labels';
import { Button, Card, ErrorNote, Field, Modal, inputClass } from '../../../../lib/ui';

// Horarios de atencion (fase 2 auditoria de paneles 2026-09-05): antes vivian
// dentro de la Agenda; es configuracion semanal, no operacion diaria. El flujo
// de conflictos con turnos ya agendados se conserva tal cual.

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

const DEFAULT_WEEK: Record<string, Franja[]> = {
  '1': [{ from: '08:00', to: '18:00' }],
  '2': [{ from: '08:00', to: '18:00' }],
  '3': [{ from: '08:00', to: '18:00' }],
  '4': [{ from: '08:00', to: '18:00' }],
  '5': [{ from: '08:00', to: '18:00' }],
  '6': [{ from: '08:00', to: '18:00' }],
};

export default function HorariosPage() {
  const toast = useToast();
  const [branch, setBranch] = useState<string | null>(null);
  const [week, setWeek] = useState<Record<string, Franja[]> | null>(null);
  const [closedDates, setClosedDates] = useState<string[]>([]);
  const [newClosed, setNewClosed] = useState('');
  const [conflicts, setConflicts] = useState<Conflict[] | null>(null);
  const [cancelMsg, setCancelMsg] = useState('');
  const [askMessage, setAskMessage] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sinConfigurar, setSinConfigurar] = useState(false);

  const load = useCallback(async () => {
    try {
      const branches = await api<{ id: string; isMain: boolean }[]>('/branches');
      const main = branches.find((b) => b.isMain) ?? branches[0];
      if (!main) {
        setError('El negocio no tiene ninguna sucursal cargada.');
        return;
      }
      setBranch(main.id);
      const s = await api<{ week: Record<string, Franja[]> | null; closed_dates: string[] }>(`/branches/${main.id}/schedule`);
      setSinConfigurar(!s.week);
      setWeek(s.week ?? DEFAULT_WEEK);
      setClosedDates(s.closed_dates);
    } catch (e) {
      setError(errorMessage(e, 'No se pudieron cargar los horarios.'));
    }
  }, []);
  useEffect(() => void load(), [load]);

  async function save(onConflict: 'abort' | 'keep' | 'cancel_notify') {
    if (!branch || !week) return;
    setGuardando(true);
    const cleanWeek = Object.fromEntries(Object.entries(week).map(([d, franjas]) => [d, franjas.filter((f) => f.from && f.to)]));
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
      setSinConfigurar(false);
      toast.success(
        onConflict === 'cancel_notify'
          ? `Horarios guardados; ${res.conflicts} turno(s) cancelados y avisados por chat`
          : onConflict === 'keep'
            ? `Horarios guardados (los ${res.conflicts} turno(s) existentes se mantienen)`
            : 'Horarios de atención guardados',
      );
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setConflicts(((e.problem as { conflicts?: Conflict[] }).conflicts ?? []) as Conflict[]);
        return;
      }
      toast.error(errorMessage(e));
    } finally {
      setGuardando(false);
    }
  }

  // Turnos recurrentes (2026-09-07): con cuanta anticipacion se crean y se pide confirmacion.
  // Va antes del return anticipado de abajo: los hooks no pueden declararse despues de un return.
  const [leadDays, setLeadDays] = useState(7);
  const [guardandoLead, setGuardandoLead] = useState(false);
  useEffect(() => {
    void api<{ recurring_lead_days: number }>('/tenant/settings').then((r) => setLeadDays(r.recurring_lead_days)).catch(() => undefined);
  }, []);
  async function saveLead(e: React.FormEvent) {
    e.preventDefault();
    setGuardandoLead(true);
    try {
      await api('/tenant/settings', { method: 'PUT', json: { recurring_lead_days: leadDays } });
      toast.success('Turnos recurrentes guardados');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setGuardandoLead(false);
    }
  }

  if (!week) return <ErrorNote error={error} />;

  return (
    <>
      <ErrorNote error={error} />
      {sinConfigurar && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Todavía no definiste tus horarios: mientras tanto rige lunes a sábado de 08:00 a 18:00. Ajustalos y guardá.
        </p>
      )}
      <Card
        title="Horarios de atención"
        description="Hasta dos franjas por día: el hueco entre ambas es el corte del mediodía. Destildá un día para cerrarlo. El bot y la agenda solo dan turnos dentro de estas franjas."
        actions={
          <Button variant="primary" loading={guardando} onClick={() => void save('abort')}>
            Guardar horarios
          </Button>
        }
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
              <div className="mt-2 flex gap-3 text-xs">
                <button
                  type="button"
                  className="text-sky-700 hover:underline"
                  onClick={() => {
                    const lunes = week['1'];
                    if (!lunes || lunes.length === 0) return;
                    setWeek({ ...week, '2': lunes, '3': lunes, '4': lunes, '5': lunes });
                  }}
                >
                  Copiar lunes a martes–viernes
                </button>
              </div>
            </div>
          </div>
          <div className="lg:border-l lg:border-slate-100 lg:pl-6">
            <p className="mb-1 text-sm font-medium">Días cerrados</p>
            <p className="mb-2 text-xs text-slate-500">Feriados o vacaciones puntuales: esos días no se dan turnos.</p>
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
            <div className="flex max-h-48 flex-wrap content-start gap-1.5 overflow-y-auto">
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
      </Card>

      <Card
        title="Turnos recurrentes"
        description="Para los clientes que toman lo mismo cada semana, cada dos semanas o cada mes (se configura en su ficha): el sistema crea el turno con anticipación y le pide por WhatsApp que lo confirme con SÍ o NO."
      >
        <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => void saveLead(e)}>
          <Field label="Crear el turno y pedir confirmación (días antes)">
            <input className={inputClass} type="number" min={1} max={60} value={leadDays} onChange={(e) => setLeadDays(Number(e.target.value))} />
          </Field>
          <Button variant="primary" type="submit" loading={guardandoLead}>
            Guardar
          </Button>
        </form>
      </Card>

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
            <Button variant="ghost" loading={guardando} onClick={() => void save('keep')}>
              Guardar y mantener esos turnos
            </Button>
            {askMessage ? (
              <Button variant="danger-solid" loading={guardando} disabled={cancelMsg.trim().length < 3} onClick={() => void save('cancel_notify')}>
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
    </>
  );
}
