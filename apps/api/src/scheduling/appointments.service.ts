import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { TenantContext, TenantTx } from '@pymes/db';
import type { AppointmentCreate, AppointmentListQuery, AvailabilityQuery } from '@pymes/shared';

import { AppPrisma } from '../prisma/app-prisma.service';

export const DEFAULT_DURATION_MIN = 30;
// Capacidad por franja v1 = 1 (doc 03: la capacidad se valida en la app).
const SLOT_CAPACITY = 1;

/** Duracion efectiva del turno (ADR 0009 fase 2): la tarea del servicio, o
 *  la reunion inicial cuando el producto es un item. */
function slotDurationMin(s: { kind: string; durationMin: number | null; meetingMin: number | null }): number {
  return (s.kind === 'item' ? s.meetingMin : s.durationMin) ?? DEFAULT_DURATION_MIN;
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
    return this.appDb.tx(ctx, (tx) =>
      tx.appointment.findMany({
        where: {
          deletedAt: null,
          ...(query.branch_id ? { branchId: query.branch_id } : {}),
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
        include: {
          customer: { select: { id: true, firstName: true, lastName: true, phoneE164: true } },
          service: { select: { id: true, name: true, durationMin: true } },
          employee: { select: { id: true, firstName: true, lastName: true } },
        },
        orderBy: { startsAt: 'asc' },
        take: 500,
      }),
    );
  }

  /** Slots libres segun duracion del servicio y horario (doc 04 §3.6). */
  async availability(ctx: TenantContext, query: AvailabilityQuery): Promise<string[]> {
    return this.appDb.tx(ctx, async (tx) => {
      const [service, branch, tenant] = await Promise.all([
        tx.service.findFirst({ where: { id: query.service_id, deletedAt: null, isActive: true } }),
        tx.branch.findFirst({ where: { id: query.branch_id, deletedAt: null } }),
        tx.tenant.findUnique({ where: { id: ctx.tenantId }, select: { timezone: true } }),
      ]);
      if (!service || !branch) throw new NotFoundException();
      const timezone = tenant?.timezone ?? 'America/Asuncion';
      const duration = slotDurationMin(service);

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
        select: { startsAt: true, endsAt: true },
      });
      // Capacidad por franja (ADR 0009): con empleados agendables cargados,
      // la capacidad es la cantidad de empleados; sin empleados rige el
      // SLOT_CAPACITY fijo (negocio unipersonal, comportamiento historico).
      const agendables = await tx.employee.count({
        where: { deletedAt: null, isActive: true, bookable: true },
      });
      const capacity = agendables > 0 ? agendables : SLOT_CAPACITY;
      // Bloqueos importados del Google Calendar del negocio (ADR 0007 fase C):
      // un evento cargado a mano en Google tapa el hueco por completo, sin
      // importar la capacidad de solape de turnos.
      const blocks = await tx.calendarBlock.findMany({
        where: { startsAt: { lt: dayEnd }, endsAt: { gt: dayStart } },
        select: { startsAt: true, endsAt: true },
      });

      const slots: string[] = [];
      const stepMs = duration * 60_000;
      const now = Date.now();
      for (const range of ranges) {
        const [fromH, fromM] = range.from.split(':').map(Number);
        const [toH, toM] = range.to.split(':').map(Number);
        const rangeStart = localToUtc(query.date, fromH ?? 0, fromM ?? 0, timezone).getTime();
        const rangeEnd = localToUtc(query.date, toH ?? 0, toM ?? 0, timezone).getTime();
        for (let start = rangeStart; start + stepMs <= rangeEnd; start += stepMs) {
          const end = start + stepMs;
          if (start < now) continue;
          if (blocks.some((b) => b.startsAt.getTime() < end && b.endsAt.getTime() > start)) continue;
          const overlapping = busy.filter(
            (b) => b.startsAt.getTime() < end && b.endsAt.getTime() > start,
          ).length;
          if (overlapping < capacity) slots.push(new Date(start).toISOString());
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
    const service = dto.service_id
      ? await tx.service.findFirst({ where: { id: dto.service_id, deletedAt: null } })
      : null;
    if (dto.service_id && !service) throw new NotFoundException();

    const startsAt = new Date(dto.starts_at);
    const endsAt = dto.ends_at
      ? new Date(dto.ends_at)
      : new Date(startsAt.getTime() + (service ? slotDurationMin(service) : DEFAULT_DURATION_MIN) * 60_000);

    // Asignacion de empleado (ADR 0009): con empleados agendables, cada
    // reserva queda asignada a uno libre. El advisory lock por tenant
    // serializa las reservas concurrentes: dos clientes pidiendo el mismo
    // horario jamas terminan con el mismo empleado en dos turnos solapados.
    const agendables = await tx.employee.findMany({
      where: { deletedAt: null, isActive: true, bookable: true },
      select: { id: true, firstName: true, lastName: true },
    });
    let employeeId: string | null = null;
    if (agendables.length > 0) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${ctx.tenantId}:employee-scheduling`}, 0))`;
      const candidatos = dto.employee_id
        ? agendables.filter((e) => e.id === dto.employee_id)
        : agendables;
      if (dto.employee_id && candidatos.length === 0) {
        throw new ConflictException({ title: 'El empleado elegido no existe o no es agendable' });
      }
      const solapados = await tx.appointment.findMany({
        where: {
          deletedAt: null,
          status: { in: ['pending', 'confirmed'] },
          employeeId: { in: candidatos.map((e) => e.id) },
          startsAt: { lt: endsAt },
          endsAt: { gt: startsAt },
        },
        select: { employeeId: true },
      });
      const ocupados = new Set(solapados.map((s) => s.employeeId));
      const libres = candidatos.filter((e) => !ocupados.has(e.id));
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
        // Auto-asignacion: el libre con menos turnos del dia (reparte carga).
        const dia = 86_400_000;
        const cargas = await tx.appointment.groupBy({
          by: ['employeeId'],
          where: {
            deletedAt: null,
            status: { in: ['pending', 'confirmed'] },
            employeeId: { in: libres.map((e) => e.id) },
            startsAt: { gt: new Date(startsAt.getTime() - dia), lt: new Date(startsAt.getTime() + dia) },
          },
          _count: { _all: true },
        });
        const carga = new Map(cargas.map((c) => [c.employeeId, c._count._all]));
        libres.sort((a, b) => (carga.get(a.id) ?? 0) - (carga.get(b.id) ?? 0));
        employeeId = libres[0]?.id ?? null;
      }
    } else {
      // Sin empleados cargados: capacidad fija historica (doc 04 §3.6).
      const overlapping = await tx.appointment.count({
        where: {
          branchId: dto.branch_id,
          deletedAt: null,
          status: { in: ['pending', 'confirmed'] },
          startsAt: { lt: endsAt },
          endsAt: { gt: startsAt },
        },
      });
      if (overlapping >= SLOT_CAPACITY) {
        throw new ConflictException({ title: 'Sin disponibilidad en ese horario' });
      }
    }

    // Turnos por bot nacen pending o confirmed segun auto_confirm_bookings
    // (doc 01 §3.3); los del panel nacen pending hasta confirmar.
    const status = source === 'bot' && autoConfirm ? 'confirmed' : 'pending';
    return tx.appointment.create({
      data: {
        tenantId: ctx.tenantId,
        branchId: dto.branch_id,
        customerId: dto.customer_id,
        serviceId: dto.service_id,
        employeeId,
        startsAt,
        endsAt,
        status,
        source,
        notes: dto.notes,
        ...(status === 'confirmed' ? { confirmedAt: new Date() } : {}),
      },
      include: {
        service: { select: { name: true } },
        employee: { select: { firstName: true, lastName: true } },
      },
    });
  }

  async transition(
    ctx: TenantContext,
    id: string,
    action: 'confirm' | 'cancel' | 'complete',
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
        throw new ConflictException({ title: 'El turno no se puede completar' });
      }
      return tx.appointment.update({ where: { id }, data: { status: 'completed' } });
    });
  }
}
