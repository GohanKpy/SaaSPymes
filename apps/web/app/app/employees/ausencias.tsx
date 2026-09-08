'use client';

import { useEffect, useState } from 'react';

import { ApiError, api } from '../../../lib/api';
import { useToast } from '../../../lib/feedback';
import { errorMessage } from '../../../lib/labels';
import { Button, Field, Modal, inputClass } from '../../../lib/ui';

// Ausencias de empleados (pedido de Johan 2026-09-08): registrar que alguien
// se ausenta o se retira; si tenia turnos en el periodo, el sistema lo avisa
// (409 con la lista) y el dueno decide si se avisa a los clientes.

export interface Ausencia {
  id: string;
  employeeId: string;
  startsOn: string;
  endsOn: string | null;
  reason: string | null;
}

export interface TurnoAfectado {
  id: string;
  fecha: string;
  hora: string;
  cliente: string;
  servicio: string;
  telefono: string | null;
}

export type Decision = 'notify' | 'keep';

export const fechaCorta = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/');
const hoyIso = () => new Date().toISOString().slice(0, 10);

/** Ausencia que cubre el dia de hoy (para el badge "ausente"), o null. */
export function ausenciaVigente(absences: Ausencia[] | undefined, dia = hoyIso()): Ausencia | null {
  return (absences ?? []).find((a) => a.startsOn.slice(0, 10) <= dia && (!a.endsOn || a.endsOn.slice(0, 10) >= dia)) ?? null;
}

export function textoAusencia(a: Ausencia): string {
  return a.endsOn ? `ausente hasta el ${fechaCorta(a.endsOn)}` : 'ausente hasta nuevo aviso';
}

/** Lee los turnos afectados de un 409 de la API; null si el error es otro. */
export function conflictosDe(e: unknown): TurnoAfectado[] | null {
  if (e instanceof ApiError && e.status === 409) {
    const c = (e.problem as { conflicts?: TurnoAfectado[] }).conflicts;
    if (Array.isArray(c)) return c;
  }
  return null;
}

/**
 * Segundo paso cuando la persona tiene turnos en el periodo: la lista es el
 * aviso al dueno; "avisar" manda a cada cliente el mensaje para que elija
 * otra persona u otro dia por el chat.
 */
export function ConflictosTurnos({
  titulo,
  nombre,
  conflicts,
  guardando,
  onElegir,
  onClose,
}: {
  titulo: string;
  nombre: string;
  conflicts: TurnoAfectado[];
  guardando: boolean;
  onElegir: (decision: Decision) => void;
  onClose: () => void;
}) {
  return (
    <Modal title={titulo} description="Esos clientes ya tienen turno con esta persona. Elegí qué hacer." onClose={onClose} role="alertdialog">
      <ul className="max-h-48 space-y-1 overflow-y-auto text-sm">
        {conflicts.map((c) => (
          <li key={c.id} className="rounded bg-slate-50 px-2 py-1">
            {fechaCorta(c.fecha)} {c.hora} — {c.cliente} ({c.servicio}){c.telefono ? <span className="text-slate-400"> · {c.telefono}</span> : null}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-slate-500">
        Al avisar, cada cliente recibe por WhatsApp (o por email si no tiene celular) que {nombre} no va a poder atenderlo, con quién más podría
        atenderlo a esa misma hora, y elige otra persona u otro día respondiendo por el chat. Queda una tarea por turno en Tareas y un correo
        resumen para el negocio.
      </p>
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Volver
        </Button>
        <Button variant="ghost" loading={guardando} onClick={() => onElegir('keep')}>
          Registrar sin avisar
        </Button>
        <Button variant="primary" loading={guardando} onClick={() => onElegir('notify')}>
          Registrar y avisar a los clientes
        </Button>
      </div>
    </Modal>
  );
}

/** Alta de una ausencia con el paso de conflictos; lista y quita las ya cargadas. */
export function AusenciaModal({
  employee,
  fechaInicial,
  onClose,
  onSaved,
}: {
  employee: { id: string; firstName: string; lastName: string };
  fechaInicial?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const nombre = `${employee.firstName} ${employee.lastName}`;
  const [desde, setDesde] = useState(fechaInicial ?? hoyIso());
  const [hasta, setHasta] = useState(fechaInicial ?? hoyIso());
  const [indefinida, setIndefinida] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [conflicts, setConflicts] = useState<TurnoAfectado[] | null>(null);
  const [existentes, setExistentes] = useState<Ausencia[]>([]);

  const cargar = () => {
    void api<Ausencia[]>(`/employees/${employee.id}/absences`).then(setExistentes).catch(() => setExistentes([]));
  };
  useEffect(cargar, [employee.id]);

  async function enviar(onConflict: 'abort' | Decision) {
    setGuardando(true);
    try {
      const res = await api<{ affected: number; notified: number }>(`/employees/${employee.id}/absences`, {
        method: 'POST',
        json: {
          starts_on: desde,
          ends_on: indefinida ? null : hasta,
          ...(motivo.trim() ? { reason: motivo.trim() } : {}),
          on_conflict: onConflict,
        },
      });
      toast.success(
        res.affected === 0
          ? `Ausencia de ${employee.firstName} registrada: no tenía turnos en ese período`
          : onConflict === 'notify'
            ? `Ausencia registrada; ${res.notified} de ${res.affected} cliente(s) avisados por chat (los demás quedan como tarea)`
            : `Ausencia registrada; ${res.affected} turno(s) quedan asignados a ${employee.firstName} sin avisar`,
      );
      onSaved();
      onClose();
    } catch (e) {
      const c = conflictosDe(e);
      if (c) setConflicts(c);
      else toast.error(errorMessage(e));
    } finally {
      setGuardando(false);
    }
  }

  async function quitar(a: Ausencia) {
    try {
      await api(`/employees/${employee.id}/absences/${a.id}`, { method: 'DELETE' });
      toast.success('Ausencia quitada');
      cargar();
      onSaved();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  if (conflicts) {
    return (
      <ConflictosTurnos
        titulo={`${nombre} tiene ${conflicts.length} turno${conflicts.length === 1 ? '' : 's'} en ese período`}
        nombre={nombre}
        conflicts={conflicts}
        guardando={guardando}
        onElegir={(d) => void enviar(d)}
        onClose={() => setConflicts(null)}
      />
    );
  }

  return (
    <Modal
      title={`Ausencia de ${nombre}`}
      description="Mientras dure la ausencia no recibe turnos. Si ya tenía clientes agendados en esas fechas, el sistema te lo avisa antes de registrarla."
      onClose={onClose}
    >
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void enviar('abort');
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Desde">
            <input type="date" className={inputClass} value={desde} required onChange={(e) => setDesde(e.target.value)} />
          </Field>
          <Field label={indefinida ? 'Hasta (sin fecha)' : 'Hasta'}>
            <input type="date" className={inputClass} value={hasta} min={desde} required={!indefinida} disabled={indefinida} onChange={(e) => setHasta(e.target.value)} />
          </Field>
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5" checked={indefinida} onChange={(e) => setIndefinida(e.target.checked)} />
          <span>
            Hasta nuevo aviso
            <span className="block text-xs text-slate-500">Para cuando no se sabe cuándo vuelve. Si se retira definitivamente, usá &quot;Dar de baja&quot;.</span>
          </span>
        </label>
        <Field label="Motivo (opcional, solo lo ve el equipo)">
          <input className={inputClass} value={motivo} maxLength={300} placeholder="Ej: licencia médica, vacaciones" onChange={(e) => setMotivo(e.target.value)} />
        </Field>
        {existentes.length > 0 && (
          <div className="rounded-md border border-slate-100 bg-slate-50 p-2 text-sm">
            <p className="mb-1 text-xs uppercase tracking-wide text-slate-400">Ausencias cargadas</p>
            <ul className="space-y-1">
              {existentes.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-2">
                  <span>
                    {fechaCorta(a.startsOn)} → {a.endsOn ? fechaCorta(a.endsOn) : 'sin fecha'}
                    {a.reason && <span className="text-slate-500"> · {a.reason}</span>}
                  </span>
                  <button type="button" className="text-xs text-red-600 hover:underline" onClick={() => void quitar(a)}>
                    Quitar
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" type="button" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" type="submit" loading={guardando}>
            Registrar ausencia
          </Button>
        </div>
      </form>
    </Modal>
  );
}
