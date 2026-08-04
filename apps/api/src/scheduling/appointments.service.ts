import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { TenantContext, TenantTx } from '@pymes/db';
import type { AppointmentCreate, AppointmentListQuery, AvailabilityQuery } from '@pymes/shared';

import { AppPrisma } from '../prisma/app-prisma.service';

// Horario laboral por defecto del laboratorio; la configuracion por sucursal
// llega con "recursos agendables" (extension prevista fase 2, doc 03 §3.3).
const OPEN_HOUR = 8;
const CLOSE_HOUR = 18;
const DEFAULT_DURATION_MIN = 30;
// Capacidad por franja v1 = 1 (doc 03: la capacidad se valida en la app).
const SLOT_CAPACITY = 1;

/** Instante UTC de una hora local del tenant (dos pasadas con Intl). */
function localToUtc(date: string, hour: number, minute: number, timeZone: string): Date {
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
      const duration = service.durationMin ?? DEFAULT_DURATION_MIN;

      const dayStart = localToUtc(query.date, OPEN_HOUR, 0, timezone);
      const dayEnd = localToUtc(query.date, CLOSE_HOUR, 0, timezone);
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

      const slots: string[] = [];
      const stepMs = duration * 60_000;
      const now = Date.now();
      for (let start = dayStart.getTime(); start + stepMs <= dayEnd.getTime(); start += stepMs) {
        const end = start + stepMs;
        if (start < now) continue;
        const overlapping = busy.filter(
          (b) => b.startsAt.getTime() < end && b.endsAt.getTime() > start,
        ).length;
        if (overlapping < SLOT_CAPACITY) slots.push(new Date(start).toISOString());
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
      : new Date(startsAt.getTime() + (service?.durationMin ?? DEFAULT_DURATION_MIN) * 60_000);

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

    // Turnos por bot nacen pending o confirmed segun auto_confirm_bookings
    // (doc 01 §3.3); los del panel nacen pending hasta confirmar.
    const status = source === 'bot' && autoConfirm ? 'confirmed' : 'pending';
    return tx.appointment.create({
      data: {
        tenantId: ctx.tenantId,
        branchId: dto.branch_id,
        customerId: dto.customer_id,
        serviceId: dto.service_id,
        startsAt,
        endsAt,
        status,
        source,
        notes: dto.notes,
        ...(status === 'confirmed' ? { confirmedAt: new Date() } : {}),
      },
      include: { service: { select: { name: true } } },
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
