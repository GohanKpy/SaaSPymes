import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { TenantContext, TenantTx } from '@pymes/db';
import type {
  AppointmentCreate,
  AppointmentListQuery,
  AppointmentReschedule,
  AvailabilityQuery,
} from '@pymes/shared';
import { MIN_APPOINTMENT_MIN } from '@pymes/shared';

import { crearConsumosDeTurno } from '../invoicing/charges';

import { AppPrisma } from '../prisma/app-prisma.service';

export const DEFAULT_DURATION_MIN = 30;
// Toda reserva queda asignada a un empleado agendable (ADR 0009, regla
// obligatoria desde 2026-09-08): sin empleados cargados no se agenda.
export const SIN_EMPLEADOS_TITULO =
  'Para agendar hace falta al menos un empleado que atienda clientes con turno: cargalo en Personal.';

/** Un horario libre y quienes del equipo podrian tomarlo. */
export interface SlotLibre {
  startsAt: string;
  employeeIds: string[];
}
// Grilla de inicio de los turnos (2026-09-03): antes el paso era la duracion
// del servicio, asi que una keratina de 180 min solo podia empezar a las
// 08:00, 11:00 o 14:00 aunque la agenda estuviera vacia ("se cierra en
// horarios especificos"). Ahora cualquier inicio cada 30 min que quepa
// entero antes del cierre; los servicios mas cortos usan su propia duracion.
// Default de sistema: el paso por negocio llega con la config del panel.
export const DEFAULT_SLOT_STEP_MIN = 30;

/** Duracion efectiva del turno (ADR 0009 fase 2): la tarea del servicio, o
 *  la reunion inicial cuando el producto es un item. */
function slotDurationMin(s: { kind: string; durationMin: number | null; meetingMin: number | null }): number {
  return (s.kind === 'item' ? s.meetingMin : s.durationMin) ?? DEFAULT_DURATION_MIN;
}

type ServicioTurno = { id: string; kind: string; durationMin: number | null; meetingMin: number | null; comboDurationMin: number | null };

/**
 * Minutos que aporta cada servicio de un turno combinado (2026-09-07): el mas
 * largo cuenta entero; los demas, su "duracion cuando se combina" (o la
 * completa si no la tienen). El total del turno es la suma.
 */
export function minutosPorServicio(services: ServicioTurno[]): number[] {
  const full = services.map((s) => slotDurationMin(s));
  if (full.length <= 1) return full;
  const principal = full.indexOf(Math.max(...full));
  return services.map((s, i) => (i === principal ? full[i]! : (s.comboDurationMin ?? full[i]!)));
}

export function duracionTurnoMin(services: ServicioTurno[]): number {
  if (services.length === 0) return DEFAULT_DURATION_MIN;
  return minutosPorServicio(services).reduce((a, b) => a + b, 0);
}

/** Servicios en el orden pedido (el primero es el principal). */
function ordenar<T extends { id: string }>(rows: T[], ids: string[]): T[] {
  return ids.map((id) => rows.find((r) => r.id === id)).filter((r): r is T => Boolean(r));
}

/** Lo que devuelve la API por turno: cliente, servicio principal, empleado y todos los servicios. */
const APPT_INCLUDE = {
  customer: { select: { id: true, firstName: true, lastName: true, phoneE164: true, billingMode: true } },
  service: { select: { id: true, name: true, durationMin: true } },
  employee: { select: { id: true, firstName: true, lastName: true } },
  services: {
    orderBy: { sort: 'asc' as const },
    select: { durationMin: true, service: { select: { id: true, name: true } } },
  },
} as const;

/** Aplana appointment_services a services: [{ id, name, durationMin }]. */
type ServicioPlano = { id: string; name: string; durationMin: number };
function conServicios<T extends { services: { durationMin: number; service: { id: string; name: string } }[] }>(
  a: T,
): Omit<T, 'services'> & { services: ServicioPlano[] } {
  const { services, ...rest } = a;
  return { ...rest, services: services.map((x) => ({ id: x.service.id, name: x.service.name, durationMin: x.durationMin })) };
}

export interface BranchSchedule {
  week?: Record<string, { from: string; to: string }[]>;
  closed_dates?: string[];
}

// Sin configuracion rige el horario por defecto del laboratorio (08-18).
const DEFAULT_RANGES = [{ from: '08:00', to: '18:00' }];

/** Franjas de atencion vigentes para una fecha (dia cerrado = []). */
export function rangesForDate(schedule: BranchSchedule, date: string): { from: string; to: string }[] {
  if (schedule.closed_dates?.includes(date)) return [];
  if (!schedule.week) return DEFAULT_RANGES;
  const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
  return schedule.week[String(dow)] ?? [];
}

/** Franjas de una fecha como intervalos UTC en ms (para comparar con slots). */
function utcRanges(
  schedule: BranchSchedule,
  date: string,
  timezone: string,
): { start: number; end: number }[] {
  return rangesForDate(schedule, date).map((r) => {
    const [fromH, fromM] = r.from.split(':').map(Number);
    const [toH, toM] = r.to.split(':').map(Number);
    return {
      start: localToUtc(date, fromH ?? 0, fromM ?? 0, timezone).getTime(),
      end: localToUtc(date, toH ?? 0, toM ?? 0, timezone).getTime(),
    };
  });
}

const dentroDe = (ranges: { start: number; end: number }[], start: number, end: number) =>
  ranges.some((r) => r.start <= start && end <= r.end);

/** Instante UTC de una hora local del tenant (dos pasadas con Intl). */
export function localToUtc(date: string, hour: number, minute: number, timeZone: string): Date {
  const guess = new Date(`${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00Z`);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  const parts = Object.fromEntries(formatter.formatToParts(guess).map((p) => [p.type, p.value]));
  const rendered = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour === '24' ? '0' : parts.hour),
    Number(parts.minute),
  );
  return new Date(guess.getTime() + (guess.getTime() - rendered));
}

@Injectable()
export class AppointmentsService {
  constructor(private readonly appDb: AppPrisma) {}

  list(ctx: TenantContext, query: AppointmentListQuery) {
    return this.appDb.tx(ctx, async (tx) =>
      (
        await tx.appointment.findMany({
        where: {
          deletedAt: null,
          ...(query.branch_id ? { branchId: query.branch_id } : {}),
          ...(query.customer_id ? { customerId: query.customer_id } : {}),
          ...(query.status ? { status: query.status } : {}),
          ...(query.from || query.to
            ? {
                startsAt: {
                  ...(query.from ? { gte: new Date(query.from) } : {}),
                  ...(query.to ? { lte: new Date(query.to) } : {}),
                },
              }
            : {}),
        },
        include: APPT_INCLUDE,
        orderBy: { startsAt: 'asc' },
        take: 500,
        })
      ).map(conServicios),
    );
  }

  /** Slots libres segun duracion del servicio y horario (doc 04 §3.6). */
  async availability(ctx: TenantContext, query: AvailabilityQuery): Promise<string[]> {
    return (await this.slotsDetallados(ctx, query)).map((s) => s.startsAt);
  }

  /**
   * Slots libres con los empleados que podrian atender cada uno (2026-09-08):
   * el bot lo usa para explicar alternativas cuando el profesional pedido no
   * esta libre ("a esa hora podria atenderte Ana"). Con employee_id, solo
   * los horarios de esa persona.
   */
  async slotsDetallados(ctx: TenantContext, query: AvailabilityQuery): Promise<SlotLibre[]> {
    return this.appDb.tx(ctx, async (tx) => {
      const ids = [...new Set(query.service_ids ?? (query.service_id ? [query.service_id] : []))];
      const [encontrados, branch, tenant] = await Promise.all([
        tx.service.findMany({ where: { id: { in: ids }, deletedAt: null, isActive: true } }),
        tx.branch.findFirst({ where: { id: query.branch_id, deletedAt: null } }),
        tx.tenant.findUnique({ where: { id: ctx.tenantId }, select: { timezone: true } }),
      ]);
      if (encontrados.length !== ids.length || !branch) throw new NotFoundException();
      const timezone = tenant?.timezone ?? 'America/Asuncion';
      // Varios servicios (2026-09-07): el total lo calcula el servidor y el
      // panel puede ajustarlo a mano (duration_min).
      const duration = query.duration_min ?? duracionTurnoMin(ordenar(encontrados, ids));

      // Franjas configuradas por la sucursal (almuerzo = hueco entre franjas;
      // dia cerrado = sin franjas). Sin configuracion: 08-18.
      const ranges = rangesForDate((branch.schedule ?? {}) as BranchSchedule, query.date);
      if (ranges.length === 0) return [];

      const dayStart = localToUtc(query.date, 0, 0, timezone);
      const dayEnd = localToUtc(query.date, 23, 59, timezone);
      const busy = await tx.appointment.findMany({
        where: {
          branchId: query.branch_id,
          deletedAt: null,
          status: { in: ['pending', 'confirmed'] },
          startsAt: { lt: dayEnd },
          endsAt: { gt: dayStart },
        },
        select: { startsAt: true, endsAt: true, employeeId: true },
      });
      // Capacidad por franja (ADR 0009): la cantidad de empleados agendables
      // LIBRES Y EN SU HORARIO (cada uno puede tener horario propio; null =
      // el del negocio). Sin empleados cargados no hay horarios: toda
      // reserva necesita un empleado (2026-09-08).
      const agendables = await tx.employee.findMany({
        where: { deletedAt: null, isActive: true, bookable: true },
        select: { id: true, schedule: true },
      });
      if (agendables.length === 0) return [];
      // Bloqueos del Google Calendar (ADR 0007 fase C): employee_id NULL tapa
      // el hueco para todo el negocio; con valor solo saca a ese empleado.
      const blocks = await tx.calendarBlock.findMany({
        where: { startsAt: { lt: dayEnd }, endsAt: { gt: dayStart } },
        select: { startsAt: true, endsAt: true, employeeId: true },
      });
      const tenantBlocks = blocks.filter((b) => !b.employeeId);
      const branchSchedule = (branch.schedule ?? {}) as BranchSchedule;
      // Todo el equipo con su horario del dia: la capacidad se calcula
      // siempre sobre el equipo entero (los turnos sin asignar los cubre
      // cualquiera), y el empleado pedido solo tiene que estar libre el.
      // Antes, con un empleado elegido, el turno sin asignar se le
      // descontaba a el solo y desaparecian horarios reales (2026-09-03).
      const equipo = agendables.map((e) => ({
        id: e.id,
        ranges: e.schedule
          ? utcRanges(e.schedule as BranchSchedule, query.date, timezone)
          : utcRanges(branchSchedule, query.date, timezone),
      }));

      const overlap = (s: { startsAt: Date; endsAt: Date }, start: number, end: number) =>
        s.startsAt.getTime() < end && s.endsAt.getTime() > start;

      const slots: SlotLibre[] = [];
      const durationMs = duration * 60_000;
      const stepMs = Math.min(duration, DEFAULT_SLOT_STEP_MIN) * 60_000;
      const now = Date.now();
      for (const range of ranges) {
        const [fromH, fromM] = range.from.split(':').map(Number);
        const [toH, toM] = range.to.split(':').map(Number);
        const rangeStart = localToUtc(query.date, fromH ?? 0, fromM ?? 0, timezone).getTime();
        const rangeEnd = localToUtc(query.date, toH ?? 0, toM ?? 0, timezone).getTime();
        for (let start = rangeStart; start + durationMs <= rangeEnd; start += stepMs) {
          const end = start + durationMs;
          if (start < now) continue;
          if (tenantBlocks.some((b) => overlap(b, start, end))) continue;
          const libres = equipo.filter(
            (e) =>
              dentroDe(e.ranges, start, end) &&
              !blocks.some((b) => b.employeeId === e.id && overlap(b, start, end)) &&
              !busy.some((b) => b.employeeId === e.id && overlap(b, start, end)),
          );
          // Turnos sin asignar (previos a cargar empleados) igual consumen a
          // alguien del equipo: se descuentan del total de libres.
          const sinAsignar = busy.filter((b) => !b.employeeId && overlap(b, start, end)).length;
          const elegidoLibre = query.employee_id
            ? libres.some((e) => e.id === query.employee_id)
            : true;
          if (elegidoLibre && libres.length - sinAsignar > 0) {
            slots.push({
              startsAt: new Date(start).toISOString(),
              employeeIds: query.employee_id ? [query.employee_id] : libres.map((e) => e.id),
            });
          }
        }
      }
      return slots;
    });
  }

  /** Crea turno validando solape segun capacidad (doc 04 §3.6). */
  async create(
    ctx: TenantContext,
    dto: AppointmentCreate,
    source: 'panel' | 'bot',
    autoConfirm = false,
  ) {
    return this.appDb.tx(ctx, (tx) => this.createInTx(tx, ctx, dto, source, autoConfirm));
  }

  /** Variante para llamar dentro de una transaccion existente (bot). */
  async createInTx(
    tx: TenantTx,
    ctx: TenantContext,
    dto: AppointmentCreate,
    source: 'panel' | 'bot',
    autoConfirm: boolean,
  ) {
    // Uno o varios servicios (2026-09-07); el primero es el principal.
    const ids = [...new Set(dto.service_ids ?? (dto.service_id ? [dto.service_id] : []))];
    const encontrados = ids.length ? await tx.service.findMany({ where: { id: { in: ids }, deletedAt: null } }) : [];
    if (encontrados.length !== ids.length) throw new NotFoundException();
    const services = ordenar(encontrados, ids);
    const minutos = minutosPorServicio(services);
    const duracion = dto.duration_min ?? (services.length ? minutos.reduce((a, b) => a + b, 0) : DEFAULT_DURATION_MIN);

    const startsAt = new Date(dto.starts_at);
    const endsAt = dto.ends_at ? new Date(dto.ends_at) : new Date(startsAt.getTime() + duracion * 60_000);

    // Asignacion de empleado (ADR 0009; obligatoria desde 2026-09-08): toda
    // reserva queda a nombre de un empleado agendable libre; sin empleados
    // cargados no se agenda. El advisory lock por tenant serializa las
    // reservas concurrentes: dos clientes pidiendo el mismo horario jamas
    // terminan con el mismo empleado en dos turnos solapados.
    const agendables = await tx.employee.findMany({
      where: { deletedAt: null, isActive: true, bookable: true },
      select: { id: true, firstName: true, lastName: true, schedule: true },
    });
    if (agendables.length === 0) {
      throw new ConflictException({ title: SIN_EMPLEADOS_TITULO });
    }
    let employeeId: string;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${ctx.tenantId}:employee-scheduling`}, 0))`;
    const candidatos = dto.employee_id
      ? agendables.filter((e) => e.id === dto.employee_id)
      : agendables;
    if (dto.employee_id && candidatos.length === 0) {
      throw new ConflictException({ title: 'El empleado elegido no existe o no es agendable' });
    }
    // Horario individual (fase 3): solo cuentan los que trabajan en esa
    // franja segun SU horario (o el de la sucursal si no tienen propio).
    const [branch, tenant] = await Promise.all([
      tx.branch.findFirst({ where: { id: dto.branch_id, deletedAt: null } }),
      tx.tenant.findUnique({ where: { id: ctx.tenantId }, select: { timezone: true } }),
    ]);
    const timezone = tenant?.timezone ?? 'America/Asuncion';
    const branchSchedule = (branch?.schedule ?? {}) as BranchSchedule;
    const dateLocal = startsAt.toLocaleDateString('en-CA', { timeZone: timezone });
    const trabajando = candidatos.filter((e) =>
      dentroDe(
        utcRanges(((e.schedule as BranchSchedule | null) ?? branchSchedule), dateLocal, timezone),
        startsAt.getTime(),
        endsAt.getTime(),
      ),
    );
    if (trabajando.length === 0) {
      throw new ConflictException({
        title: dto.employee_id
          ? 'El empleado elegido no trabaja en ese horario'
          : 'Ningun empleado agendable trabaja en ese horario',
      });
    }
    const solapados = await tx.appointment.findMany({
      where: {
        deletedAt: null,
        status: { in: ['pending', 'confirmed'] },
        employeeId: { in: trabajando.map((e) => e.id) },
        startsAt: { lt: endsAt },
        endsAt: { gt: startsAt },
      },
      select: { employeeId: true },
    });
    const ocupados = new Set(solapados.map((s) => s.employeeId));
    // Bloqueo personal del Google del empleado (fase 3): tambien lo ocupa.
    const bloqueosPersonales = await tx.calendarBlock.findMany({
      where: {
        employeeId: { in: trabajando.map((e) => e.id) },
        startsAt: { lt: endsAt },
        endsAt: { gt: startsAt },
      },
      select: { employeeId: true },
    });
    for (const b of bloqueosPersonales) if (b.employeeId) ocupados.add(b.employeeId);
    const libres = trabajando.filter((e) => !ocupados.has(e.id));
    if (libres.length === 0) {
      throw new ConflictException({
        title: dto.employee_id
          ? 'El empleado elegido ya tiene un turno en ese horario'
          : 'Sin empleados libres en ese horario',
      });
    }
    if (dto.employee_id) {
      employeeId = dto.employee_id;
    } else {
      // Auto-asignacion (pedido de Johan 2026-09-08): entre los libres, el
      // de MENOS carga ese dia = minutos ya agendados en el dia local del
      // turno (antes se contaban turnos en una ventana de ±24 h). Empate:
      // menos turnos, y despues por nombre para que sea predecible.
      const dayStart = localToUtc(dateLocal, 0, 0, timezone);
      const dayEnd = localToUtc(dateLocal, 23, 59, timezone);
      const delDia = await tx.appointment.findMany({
        where: {
          deletedAt: null,
          status: { in: ['pending', 'confirmed'] },
          employeeId: { in: libres.map((e) => e.id) },
          startsAt: { lt: dayEnd },
          endsAt: { gt: dayStart },
        },
        select: { employeeId: true, startsAt: true, endsAt: true },
      });
      const carga = new Map<string, { min: number; n: number }>();
      for (const a of delDia) {
        if (!a.employeeId) continue;
        const c = carga.get(a.employeeId) ?? { min: 0, n: 0 };
        c.min += (a.endsAt.getTime() - a.startsAt.getTime()) / 60_000;
        c.n += 1;
        carga.set(a.employeeId, c);
      }
      const peso = (id: string) => carga.get(id) ?? { min: 0, n: 0 };
      const nombre = (e: { firstName: string; lastName: string }) => `${e.firstName} ${e.lastName}`;
      libres.sort(
        (a, b) =>
          peso(a.id).min - peso(b.id).min || peso(a.id).n - peso(b.id).n || nombre(a).localeCompare(nombre(b), 'es'),
      );
      employeeId = libres[0]!.id;
    }

    // Turnos por bot nacen pending o confirmed segun auto_confirm_bookings
    // (doc 01 §3.3); los del panel nacen pending hasta confirmar.
    const status = source === 'bot' && autoConfirm ? 'confirmed' : 'pending';
    const created = await tx.appointment.create({
      data: {
        tenantId: ctx.tenantId,
        branchId: dto.branch_id,
        customerId: dto.customer_id,
        serviceId: ids[0] ?? null,
        employeeId,
        startsAt,
        endsAt,
        status,
        source,
        notes: dto.notes,
        ...(status === 'confirmed' ? { confirmedAt: new Date() } : {}),
      },
    });
    // Todos los servicios del turno, con los minutos que aporta cada uno.
    // createMany: el create anidado no fija tenant_id con FK compuesta y RLS lo exige.
    if (services.length > 0) {
      await tx.appointmentService.createMany({
        data: services.map((svc, i) => ({
          tenantId: ctx.tenantId,
          appointmentId: created.id,
          serviceId: svc.id,
          sort: i,
          durationMin: minutos[i] ?? slotDurationMin(svc),
        })),
      });
    }
    const full = await tx.appointment.findFirstOrThrow({ where: { id: created.id }, include: APPT_INCLUDE });
    return conServicios(full);
  }

  async transition(
    ctx: TenantContext,
    id: string,
    action: 'confirm' | 'cancel' | 'complete' | 'no_show',
    reason?: string,
  ) {
    return this.appDb.tx(ctx, async (tx) => {
      const appointment = await tx.appointment.findFirst({ where: { id, deletedAt: null } });
      if (!appointment) throw new NotFoundException();

      if (action === 'confirm') {
        if (appointment.status !== 'pending') {
          throw new ConflictException({ title: 'Solo se confirman turnos pendientes' });
        }
        // La confirmacion manual registra confirmed_by (doc 04 §3.6).
        return tx.appointment.update({
          where: { id },
          data: { status: 'confirmed', confirmedBy: ctx.userId, confirmedAt: new Date() },
        });
      }
      if (action === 'cancel') {
        if (!['pending', 'confirmed'].includes(appointment.status)) {
          throw new ConflictException({ title: 'El turno no se puede cancelar' });
        }
        return tx.appointment.update({
          where: { id },
          data: { status: 'cancelled', notes: reason ? `${appointment.notes ?? ''}\n[cancelacion] ${reason}`.trim() : appointment.notes },
        });
      }
      if (appointment.status !== 'confirmed' && appointment.status !== 'pending') {
        throw new ConflictException({
          title: action === 'no_show' ? 'El turno no se puede marcar como no vino' : 'El turno no se puede completar',
        });
      }
      // "No vino" (fase 1 auditoria 2026-09-05): el estado existia sin boton;
      // marcarlo como cancelado ensuciaba las metricas de ausencias.
      const updated = await tx.appointment.update({
        where: { id },
        data: { status: action === 'no_show' ? 'no_show' : 'completed' },
      });
      // Cuenta mensual (2026-09-07): lo atendido pasa a consumos pendientes
      // del cliente si factura por mes (no hace nada en los demas).
      if (action === 'complete') await crearConsumosDeTurno(tx, ctx.tenantId, id);
      return updated;
    });
  }

  /**
   * Reprogramar desde el panel (fase 1 auditoria 2026-09-05): cancela el
   * original y crea el nuevo en UNA transaccion con la misma validacion que
   * reservar (horario, empleado libre, capacidad). Si la creacion falla, el
   * turno original queda intacto. Conserva servicio, notas y estado
   * confirmado; el profesional se mantiene salvo pedido de cambio.
   */
  async reschedule(ctx: TenantContext, id: string, dto: AppointmentReschedule) {
    return this.appDb.tx(ctx, async (tx) => {
      const old = await tx.appointment.findFirst({
        where: { id, deletedAt: null },
        include: { services: { orderBy: { sort: 'asc' }, select: { serviceId: true } } },
      });
      if (!old) throw new NotFoundException();
      if (!['pending', 'confirmed'].includes(old.status)) {
        throw new ConflictException({ title: 'Solo se reprograman turnos pendientes o confirmados' });
      }
      const nuevaFecha = new Date(dto.starts_at).toISOString();
      const anterior = await tx.appointment.update({
        where: { id },
        data: {
          status: 'cancelled',
          notes: `${old.notes ?? ''}\n[reprogramado a ${nuevaFecha}]`.trim(),
        },
      });
      const nuevo = await this.createInTx(
        tx,
        ctx,
        {
          branch_id: old.branchId,
          customer_id: old.customerId,
          ...(old.services.length > 0
            ? { service_ids: old.services.map((x) => x.serviceId) }
            : { service_id: old.serviceId ?? undefined }),
          // Misma duracion que tenia (puede haber sido ajustada a mano).
          duration_min: Math.max(MIN_APPOINTMENT_MIN, Math.round((old.endsAt.getTime() - old.startsAt.getTime()) / 60_000)),
          employee_id: dto.employee_id ?? old.employeeId ?? undefined,
          starts_at: dto.starts_at,
          notes: old.notes?.trim() || undefined,
        },
        'panel',
        false,
      );
      const final =
        old.status === 'confirmed'
          ? conServicios(
              await tx.appointment.update({
                where: { id: nuevo.id },
                data: { status: 'confirmed', confirmedBy: ctx.userId, confirmedAt: new Date() },
                include: APPT_INCLUDE,
              }),
            )
          : nuevo;
      return { nuevo: final, anterior };
    });
  }
}
