import { Controller, Get, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

import type { AuthRequest } from '../auth/decorators';
import { tenantCtx } from '../common/tenant-ctx';
import { AppPrisma } from '../prisma/app-prisma.service';
import { localToUtc } from '../scheduling/appointments.service';

/**
 * KPIs del inicio del panel (P1 del replanteo 2026-08-26): el dueno abre la
 * app y ve el dia y el mes de un vistazo. Todo se recalcula en el server con
 * la zona horaria del tenant; "hoy" y "este mes" son locales, no UTC.
 */
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly appDb: AppPrisma) {}

  @Get()
  async summary(@Req() req: FastifyRequest & AuthRequest) {
    const ctx = tenantCtx(req);
    const tenant = await this.appDb.client.tenant.findUnique({
      where: { id: ctx.tenantId },
      select: { timezone: true },
    });
    const timezone = tenant?.timezone ?? 'America/Asuncion';
    const today = new Date().toLocaleDateString('en-CA', { timeZone: timezone });
    const dayStart = localToUtc(today, 0, 0, timezone);
    const dayEnd = new Date(dayStart.getTime() + 24 * 3600_000);
    const weekEnd = new Date(dayStart.getTime() + 7 * 24 * 3600_000);
    const monthStart = localToUtc(`${today.slice(0, 7)}-01`, 0, 0, timezone);
    const now = new Date();

    return this.appDb.tx(ctx, async (tx) => {
      const todayAppointments = await tx.appointment.findMany({
        where: {
          deletedAt: null,
          status: { notIn: ['cancelled'] },
          startsAt: { gte: dayStart, lt: dayEnd },
        },
        include: {
          customer: { select: { id: true, firstName: true, lastName: true } },
          service: { select: { name: true } },
          employee: { select: { firstName: true, lastName: true } },
        },
        orderBy: { startsAt: 'asc' },
      });
      const weekCount = await tx.appointment.count({
        where: {
          deletedAt: null,
          status: { notIn: ['cancelled', 'no_show'] },
          startsAt: { gte: dayStart, lt: weekEnd },
        },
      });
      const customersTotal = await tx.customer.count({ where: { deletedAt: null } });
      const customersNew = await tx.customer.count({
        where: { deletedAt: null, createdAt: { gte: monthStart } },
      });
      const invoicesMonth = await tx.invoice.aggregate({
        where: { status: 'approved', issuedAt: { gte: monthStart } },
        _count: { id: true },
        _sum: { total: true },
      });
      const paidMonth = await tx.payment.aggregate({
        where: { paidAt: { gte: monthStart } },
        _sum: { amount: true },
      });
      const tasksPending = await tx.customerActivity.count({
        where: {
          activityType: { in: ['tarea', 'seguimiento'] },
          doneAt: null,
          customer: { deletedAt: null },
        },
      });
      const tasksOverdue = await tx.customerActivity.count({
        where: {
          activityType: { in: ['tarea', 'seguimiento'] },
          doneAt: null,
          dueAt: { lt: now },
          customer: { deletedAt: null },
        },
      });
      const needsHuman = await tx.conversation.count({ where: { needsHuman: true } });

      return {
        timezone,
        date: today,
        today: {
          count: todayAppointments.length,
          appointments: todayAppointments.map((a) => ({
            id: a.id,
            starts_at: a.startsAt,
            status: a.status,
            customer_id: a.customer.id,
            customer: `${a.customer.firstName} ${a.customer.lastName ?? ''}`.trim(),
            service: a.service?.name ?? null,
            employee: a.employee ? `${a.employee.firstName} ${a.employee.lastName ?? ''}`.trim() : null,
          })),
        },
        week_appointments: weekCount,
        customers: { total: customersTotal, new_this_month: customersNew },
        invoices_month: {
          issued: invoicesMonth._count.id,
          total: invoicesMonth._sum.total ?? 0n,
          paid: paidMonth._sum.amount ?? 0n,
        },
        tasks: { pending: tasksPending, overdue: tasksOverdue },
        inbox: { needs_human: needsHuman },
      };
    });
  }
}
