import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { TenantContext } from '@pymes/db';
import type { BranchSchedulePut } from '@pymes/shared';

import { Prisma } from '@pymes/db';

import { serializeMessage } from '../conversations/conversations.service';
import { TenantEventsService } from '../conversations/events.service';
import { WaSenderService } from '../conversations/wa-sender.service';
import { AppPrisma } from '../prisma/app-prisma.service';
import { rangesForDate, type BranchSchedule } from './appointments.service';

const CONFLICT_HORIZON_DAYS = 90;

export interface ScheduleConflict {
  id: string;
  fecha: string;
  hora: string;
  cliente: string;
  servicio: string;
  customerId: string | null;
  phone: string | null;
}

/**
 * Horarios de atencion de la sucursal (pedido 2026-08-07). Al guardar un
 * horario que deja turnos vigentes afuera (dia cerrado, franja recortada,
 * almuerzo) el flujo es explicito: abort (409 con la lista para que el
 * panel pregunte), keep (guardar dejando los turnos) o cancel_notify
 * (cancelar y avisar a cada cliente por su chat, con envio real si la
 * integracion de WhatsApp esta en modo live).
 */
@Injectable()
export class BranchScheduleService {
  private readonly logger = new Logger('BranchSchedule');

  constructor(
    private readonly appDb: AppPrisma,
    private readonly events: TenantEventsService,
    private readonly waSender: WaSenderService,
  ) {}

  async get(ctx: TenantContext, branchId: string) {
    const branch = await this.appDb.tx(ctx, (tx) =>
      tx.branch.findFirst({ where: { id: branchId, deletedAt: null } }),
    );
    if (!branch) throw new NotFoundException();
    const schedule = (branch.schedule ?? {}) as BranchSchedule;
    return { week: schedule.week ?? null, closed_dates: schedule.closed_dates ?? [] };
  }

  async put(ctx: TenantContext, branchId: string, dto: BranchSchedulePut) {
    const branch = await this.appDb.tx(ctx, (tx) =>
      tx.branch.findFirst({ where: { id: branchId, deletedAt: null } }),
    );
    if (!branch) throw new NotFoundException();

    const schedule: BranchSchedule = { week: dto.week, closed_dates: dto.closed_dates };
    const conflicts = await this.findConflicts(ctx, branchId, schedule);

    if (conflicts.length > 0 && dto.on_conflict === 'abort') {
      throw new ConflictException({
        title: `Hay ${conflicts.length} turno(s) agendados dentro del horario que queres cerrar`,
        conflicts,
      });
    }

    await this.appDb.tx(ctx, (tx) =>
      tx.branch.update({
        where: { id: branchId },
        data: { schedule: schedule as unknown as Prisma.InputJsonValue },
      }),
    );

    if (conflicts.length > 0 && dto.on_conflict === 'cancel_notify') {
      await this.cancelAndNotify(ctx, conflicts, dto.message ?? '');
    }
    return { saved: true, conflicts: conflicts.length, action: dto.on_conflict };
  }

  /** Turnos vigentes (90 dias) que el horario nuevo dejaria afuera. */
  private async findConflicts(
    ctx: TenantContext,
    branchId: string,
    schedule: BranchSchedule,
  ): Promise<ScheduleConflict[]> {
    return this.appDb.tx(ctx, async (tx) => {
      const tenant = await tx.tenant.findUnique({
        where: { id: ctx.tenantId },
        select: { timezone: true },
      });
      const tz = tenant?.timezone ?? 'America/Asuncion';
      const horizon = new Date(Date.now() + CONFLICT_HORIZON_DAYS * 24 * 3600_000);
      const upcoming = await tx.appointment.findMany({
        where: {
          branchId,
          deletedAt: null,
          status: { in: ['pending', 'confirmed'] },
          startsAt: { gt: new Date(), lt: horizon },
        },
        include: {
          customer: { select: { id: true, firstName: true, lastName: true, phoneE164: true } },
          service: { select: { name: true } },
        },
        orderBy: { startsAt: 'asc' },
      });

      const local = (d: Date, opts: Intl.DateTimeFormatOptions) =>
        d.toLocaleString('en-CA', { timeZone: tz, hour12: false, ...opts });
      const conflicts: ScheduleConflict[] = [];
      for (const appt of upcoming) {
        const fecha = local(appt.startsAt, { year: 'numeric', month: '2-digit', day: '2-digit' }).slice(0, 10);
        const desde = local(appt.startsAt, { hour: '2-digit', minute: '2-digit' });
        const hasta = local(appt.endsAt, { hour: '2-digit', minute: '2-digit' });
        const ranges = rangesForDate(schedule, fecha);
        const cabe = ranges.some((r) => r.from <= desde && hasta <= r.to);
        if (!cabe) {
          conflicts.push({
            id: appt.id,
            fecha,
            hora: desde,
            cliente: `${appt.customer.firstName} ${appt.customer.lastName ?? ''}`.trim(),
            servicio: appt.service?.name ?? '—',
            customerId: appt.customer.id,
            phone: appt.customer.phoneE164,
          });
        }
      }
      return conflicts;
    });
  }

  /** Cancela los turnos afectados y avisa a cada cliente por su chat. */
  private async cancelAndNotify(
    ctx: TenantContext,
    conflicts: ScheduleConflict[],
    message: string,
  ): Promise<void> {
    for (const conflict of conflicts) {
      try {
        const result = await this.appDb.tx(ctx, async (tx) => {
          await tx.appointment.update({
            where: { id: conflict.id },
            data: { status: 'cancelled' },
          });
          if (!conflict.phone) return null;
          let conversation = await tx.conversation.findFirst({
            where: { phoneE164: conflict.phone },
          });
          conversation ??= await tx.conversation.create({
            data: {
              tenantId: ctx.tenantId,
              phoneE164: conflict.phone,
              customerId: conflict.customerId,
            },
          });
          const fecha = conflict.fecha.split('-').reverse().join('/');
          const body = `Hola ${conflict.cliente.split(' ')[0]}! Lamentamos avisarte que tu turno del ${fecha} a las ${conflict.hora} fue cancelado. ${message}`;
          const stored = await tx.message.create({
            data: {
              tenantId: ctx.tenantId,
              conversationId: conversation.id,
              direction: 'out',
              senderType: 'agent',
              body,
              status: 'sent',
            },
          });
          await tx.conversation.update({
            where: { id: conversation.id },
            data: { lastMessageAt: stored.createdAt },
          });
          return { conversationId: conversation.id, messageId: stored.id, stored };
        });
        if (result) {
          this.events.emit(ctx.tenantId, 'message.new', serializeMessage(result.stored));
          this.waSender.dispatch(ctx.tenantId, result.conversationId, result.messageId);
        }
        this.events.emit(ctx.tenantId, 'conversation.updated', { appointment_id: conflict.id });
      } catch (error) {
        this.logger.error(
          `cancelacion por cierre fallo turno=${conflict.id}`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }
  }
}
