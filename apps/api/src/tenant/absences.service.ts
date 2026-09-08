import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { TenantContext, TenantTx } from '@pymes/db';
import type { AbsenceCreate } from '@pymes/shared';

import { NotifierService } from '../notifications/notifier.service';
import { AppPrisma } from '../prisma/app-prisma.service';
import { AppointmentsService, localToUtc } from '../scheduling/appointments.service';

export type OnConflict = 'abort' | 'notify' | 'keep';

/** Turno que cae dentro de una ausencia: lo que ve el panel en el 409 y lo que se avisa. */
export interface TurnoAfectado {
  id: string;
  fecha: string;
  hora: string;
  cliente: string;
  servicio: string;
  telefono: string | null;
}

interface TurnoCompleto extends TurnoAfectado {
  startsAt: Date;
  endsAt: Date;
  branchId: string;
  serviceIds: string[];
  durationMin: number;
  customer: { id: string; firstName: string; phoneE164: string | null; email: string | null; notifyWhatsapp: boolean; notifyEmail: boolean };
}

const nombreDe = (e: { firstName: string; lastName: string }) => `${e.firstName} ${e.lastName}`;

/**
 * Ausencias de empleados (pedido de Johan 2026-09-08). Registrar una ausencia
 * (o dar de baja) con turnos en el periodo: el panel recibe primero la lista
 * (409 con `conflicts`), y al confirmar con on_conflict=notify se avisa a
 * cada cliente por WhatsApp o email que su profesional no podra atenderlo,
 * con quien mas podria atenderlo a esa hora, para que elija otra persona u
 * otro dia respondiendo por el chat (el bot lo resuelve con
 * reschedule_appointment). El dueno recibe una tarea por turno y un correo
 * resumen.
 */
@Injectable()
export class AbsencesService {
  private readonly logger = new Logger('Absences');

  constructor(
    private readonly appDb: AppPrisma,
    private readonly appointments: AppointmentsService,
    private readonly notifier: NotifierService,
  ) {}

  /** Ausencias vigentes o futuras de un empleado. */
  list(ctx: TenantContext, employeeId: string) {
    const hoy = new Date(new Date().toISOString().slice(0, 10));
    return this.appDb.tx(ctx, (tx) =>
      tx.employeeAbsence.findMany({
        where: { employeeId, OR: [{ endsOn: null }, { endsOn: { gte: hoy } }] },
        orderBy: { startsOn: 'asc' },
      }),
    );
  }

  /** Registra la ausencia; con turnos en el periodo aplica on_conflict. */
  async create(ctx: TenantContext, employeeId: string, dto: AbsenceCreate) {
    const { absence, afectados, employee } = await this.appDb.tx(ctx, async (tx) => {
      const employee = await tx.employee.findFirst({ where: { id: employeeId, deletedAt: null } });
      if (!employee) throw new NotFoundException();
      const timezone = await this.timezone(tx, ctx.tenantId);
      const from = localToUtc(dto.starts_on, 0, 0, timezone);
      const to = dto.ends_on ? localToUtc(dto.ends_on, 23, 59, timezone) : null;
      const afectados = await this.turnosAfectados(tx, employeeId, from, to, timezone);
      this.exigirDecision(employee, afectados, dto.on_conflict);
      const absence = await tx.employeeAbsence.create({
        data: {
          tenantId: ctx.tenantId,
          employeeId,
          startsOn: new Date(dto.starts_on),
          endsOn: dto.ends_on ? new Date(dto.ends_on) : null,
          reason: dto.reason?.trim() || null,
          createdBy: ctx.userId ?? null,
        },
      });
      return { absence, afectados, employee };
    });
    const notified = dto.on_conflict === 'notify' && afectados.length > 0 ? await this.avisar(ctx, employee, afectados) : 0;
    return { ...absence, affected: afectados.length, notified };
  }

  async remove(ctx: TenantContext, employeeId: string, absenceId: string): Promise<void> {
    const { count } = await this.appDb.tx(ctx, (tx) => tx.employeeAbsence.deleteMany({ where: { id: absenceId, employeeId } }));
    if (count === 0) throw new NotFoundException();
  }

  /**
   * Baja o desactivacion de un empleado (se retira): mismo flujo que una
   * ausencia desde ahora sin fecha de fin, sin fila de ausencia (deja de ser
   * agendable). Devuelve cuantos turnos futuros tenia y cuantos se avisaron.
   */
  async alDarDeBaja(ctx: TenantContext, employeeId: string, onConflict: OnConflict): Promise<{ affected: number; notified: number }> {
    const { afectados, employee } = await this.appDb.tx(ctx, async (tx) => {
      const employee = await tx.employee.findFirst({ where: { id: employeeId, deletedAt: null } });
      if (!employee) throw new NotFoundException();
      const timezone = await this.timezone(tx, ctx.tenantId);
      const afectados = await this.turnosAfectados(tx, employeeId, new Date(), null, timezone);
      this.exigirDecision(employee, afectados, onConflict);
      return { afectados, employee };
    });
    const notified = onConflict === 'notify' && afectados.length > 0 ? await this.avisar(ctx, employee, afectados) : 0;
    return { affected: afectados.length, notified };
  }

  private exigirDecision(employee: { firstName: string; lastName: string }, afectados: TurnoAfectado[], onConflict: OnConflict): void {
    if (afectados.length === 0 || onConflict !== 'abort') return;
    const n = afectados.length;
    throw new ConflictException({
      title: `${nombreDe(employee)} tiene ${n} turno${n === 1 ? '' : 's'} en ese período`,
      conflicts: afectados.map(({ id, fecha, hora, cliente, servicio, telefono }) => ({ id, fecha, hora, cliente, servicio, telefono })),
    });
  }

  private async timezone(tx: TenantTx, tenantId: string): Promise<string> {
    const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { timezone: true } });
    return tenant?.timezone ?? 'America/Asuncion';
  }

  /** Turnos vigentes del empleado dentro del periodo (solo futuros). */
  private async turnosAfectados(tx: TenantTx, employeeId: string, from: Date, to: Date | null, timezone: string): Promise<TurnoCompleto[]> {
    const desde = from.getTime() > Date.now() ? from : new Date();
    const rows = await tx.appointment.findMany({
      where: {
        employeeId,
        deletedAt: null,
        status: { in: ['pending', 'confirmed'] },
        startsAt: { gte: desde, ...(to ? { lte: to } : {}) },
      },
      include: {
        customer: { select: { id: true, firstName: true, lastName: true, phoneE164: true, email: true, notifyWhatsapp: true, notifyEmail: true } },
        service: { select: { name: true } },
        services: { include: { service: { select: { name: true } } }, orderBy: { sort: 'asc' } },
      },
      orderBy: { startsAt: 'asc' },
    });
    return rows.map((a) => {
      const nombres = a.services.map((s) => s.service.name);
      return {
        id: a.id,
        fecha: a.startsAt.toLocaleDateString('en-CA', { timeZone: timezone }),
        hora: a.startsAt.toLocaleTimeString('es-PY', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false }),
        cliente: `${a.customer.firstName} ${a.customer.lastName ?? ''}`.trim(),
        servicio: nombres.join(' + ') || a.service?.name || 'turno',
        telefono: a.customer.phoneE164,
        startsAt: a.startsAt,
        endsAt: a.endsAt,
        branchId: a.branchId,
        serviceIds: a.services.map((s) => s.serviceId),
        durationMin: Math.max(5, Math.round((a.endsAt.getTime() - a.startsAt.getTime()) / 60_000)),
        customer: a.customer,
      };
    });
  }

  /**
   * Avisa a cada cliente (WhatsApp si lo acepta; si no, email) y al dueno
   * (tarea por turno + correo resumen). Devuelve cuantos clientes se avisaron.
   */
  private async avisar(ctx: TenantContext, employee: { firstName: string; lastName: string }, afectados: TurnoCompleto[]): Promise<number> {
    const tenant = await this.appDb.tx(ctx, (tx) =>
      tx.tenant.findUnique({ where: { id: ctx.tenantId }, select: { tradeName: true, legalName: true, timezone: true } }),
    );
    const negocio = tenant?.tradeName ?? tenant?.legalName ?? 'el negocio';
    const timezone = tenant?.timezone ?? 'America/Asuncion';
    const empleado = nombreDe(employee);
    let avisados = 0;
    const resumen: string[] = [];
    for (const a of afectados) {
      const otros = await this.otrosLibres(ctx, a).catch(() => [] as string[]);
      const fechaLarga = a.startsAt.toLocaleDateString('es-PY', { timeZone: timezone, weekday: 'long', day: 'numeric', month: 'long' });
      const opciones =
        otros.length > 0
          ? `A esa misma hora podría atenderte ${otros.join(' o ')}.`
          : 'A esa hora no hay otra persona libre, pero podemos buscarte otro día u horario.';
      const body =
        `Hola ${a.customer.firstName}! Te escribimos de ${negocio}. ${empleado} no va a poder atenderte el ${fechaLarga} a las ${a.hora} (${a.servicio}). ` +
        `${opciones} ¿Preferís que te atienda otra persona o pasar el turno a otro día? Respondé por acá y lo coordinamos.`;
      let canal: 'whatsapp' | 'email' | null = null;
      try {
        if (a.customer.phoneE164 && a.customer.notifyWhatsapp) {
          await this.notifier.whatsapp(ctx.tenantId, a.customer.phoneE164, body);
          canal = 'whatsapp';
        } else if (a.customer.email && a.customer.notifyEmail) {
          await this.notifier.email(a.customer.email, `${negocio}: cambio en tu turno del ${a.fecha}`, body);
          canal = 'email';
        }
      } catch (error) {
        this.logger.warn(`aviso de ausencia fallo tenant=${ctx.tenantId} turno=${a.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (canal) avisados++;
      const estado = canal
        ? `Cliente avisado por ${canal === 'whatsapp' ? 'WhatsApp' : 'email'}; esperando que elija otra persona u otro día.`
        : 'El cliente no tiene canal de aviso (sin celular o sin avisos activos): contactarlo.';
      await this.appDb.tx({ tenantId: ctx.tenantId, actorType: 'system' }, async (tx) => {
        if (canal) await tx.appointment.update({ where: { id: a.id }, data: { absenceNotifiedAt: new Date() } });
        await tx.customerActivity.create({
          data: {
            tenantId: ctx.tenantId,
            customerId: a.customer.id,
            activityType: 'tarea',
            body: `${empleado} ausente: turno de ${a.cliente} el ${a.fecha} a las ${a.hora} (${a.servicio}). ${estado}${otros.length ? ` A esa hora podría atender: ${otros.join(', ')}.` : ''}`,
            dueAt: new Date(),
          },
        });
      });
      resumen.push(`- ${a.fecha} ${a.hora} · ${a.cliente} · ${a.servicio} · ${canal ? `avisado por ${canal}` : 'SIN canal de aviso'}${otros.length ? ` · podría atender: ${otros.join(', ')}` : ''}`);
    }
    await this.notifier.ownerEmail(
      ctx.tenantId,
      `${negocio}: ${empleado} tenía ${afectados.length} turno${afectados.length === 1 ? '' : 's'} en el período de ausencia`,
      `${empleado} no va a poder atender estos turnos:\n${resumen.join('\n')}\n\nA cada cliente avisado se le pidió que elija otra persona u otro día por el chat; queda una tarea por turno en Tareas.`,
    );
    return avisados;
  }

  /** Nombres de otros profesionales libres a la misma hora del turno (ya sin el ausente). */
  private async otrosLibres(ctx: TenantContext, a: TurnoCompleto): Promise<string[]> {
    const date = a.startsAt.toLocaleDateString('en-CA', { timeZone: await this.appDb.tx(ctx, (tx) => this.timezone(tx, ctx.tenantId)) });
    const slots = await this.appointments.slotsDetallados(ctx, {
      branch_id: a.branchId,
      ...(a.serviceIds.length > 0 ? { service_ids: a.serviceIds } : {}),
      duration_min: a.durationMin,
      date,
    });
    const ids = slots.find((s) => s.startsAt === a.startsAt.toISOString())?.employeeIds ?? [];
    if (ids.length === 0) return [];
    const rows = await this.appDb.tx(ctx, (tx) =>
      tx.employee.findMany({ where: { id: { in: ids } }, select: { firstName: true, lastName: true }, orderBy: { firstName: 'asc' } }),
    );
    return rows.map(nombreDe);
  }
}
