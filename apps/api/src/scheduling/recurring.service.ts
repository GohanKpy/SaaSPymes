import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { TenantContext } from '@pymes/db';
import type { RecurringCreate, RecurringListQuery, RecurringUpdate } from '@pymes/shared';

import { GoogleCalendarService } from '../integrations/google-calendar.service';
import { NotifierService } from '../notifications/notifier.service';
import { AppPrisma } from '../prisma/app-prisma.service';
import { AppointmentsService, duracionTurnoMin, localToUtc } from './appointments.service';

const SWEEP_INTERVAL_MS = 60 * 60_000;
const FRECUENCIA: Record<string, string> = { weekly: 'cada semana', biweekly: 'cada dos semanas', monthly: 'cada mes' };

const RESPUESTA_SI = /^\s*(s[ií]|s[ií]\b.*|confirmo|confirmado|dale|ok|okey|okay|listo|perfecto|de acuerdo|claro)\b/i;
const RESPUESTA_NO = /^\s*(no|nop|cancel(a|ar|alo|o)?|no puedo|no voy)\b/i;

interface Regla {
  frequency: string;
  weekday: number | null;
  dayOfMonth: number | null;
  startsOn: Date;
  endsOn: Date | null;
}

const isoDia = (d: Date) => d.toISOString().slice(0, 10);
const utcNoon = (iso: string) => new Date(`${iso}T12:00:00Z`);

/** Fechas (YYYY-MM-DD) que caen en la regla entre from y to, inclusive. */
export function ocurrencias(regla: Regla, from: string, to: string): string[] {
  const out: string[] = [];
  const inicio = utcNoon(isoDia(regla.startsOn) > from ? isoDia(regla.startsOn) : from);
  const fin = utcNoon(regla.endsOn && isoDia(regla.endsOn) < to ? isoDia(regla.endsOn) : to);
  // Ancla de "cada dos semanas": la primera fecha desde starts_on con ese dia.
  let ancla: Date | null = null;
  if (regla.frequency === 'biweekly' && regla.weekday !== null) {
    ancla = utcNoon(isoDia(regla.startsOn));
    while (ancla.getUTCDay() !== regla.weekday) ancla.setUTCDate(ancla.getUTCDate() + 1);
  }
  for (const d = new Date(inicio); d <= fin; d.setUTCDate(d.getUTCDate() + 1)) {
    if (regla.frequency === 'monthly') {
      if (d.getUTCDate() === regla.dayOfMonth) out.push(isoDia(d));
    } else if (d.getUTCDay() === regla.weekday) {
      if (regla.frequency === 'weekly') out.push(isoDia(d));
      else if (ancla && Math.round((d.getTime() - ancla.getTime()) / 604_800_000) % 2 === 0) out.push(isoDia(d));
    }
  }
  return out;
}

/**
 * Servicios recurrentes (2026-09-07): reglas por cliente, generacion del
 * proximo turno con anticipacion y pedido de confirmacion por WhatsApp; la
 * respuesta SI/NO se resuelve aca, sin pasar por el bot.
 */
@Injectable()
export class RecurringService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Recurring');
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly appDb: AppPrisma,
    private readonly appointments: AppointmentsService,
    private readonly notifier: NotifierService,
    private readonly google: GoogleCalendarService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.sweep(), SWEEP_INTERVAL_MS);
    setTimeout(() => void this.sweep(), 120_000);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  // ------------------------------ CRUD ------------------------------

  async list(ctx: TenantContext, query: RecurringListQuery) {
    return this.appDb.tx(ctx, async (tx) => {
      const rows = await tx.recurringBooking.findMany({
        where: {
          ...(query.customer_id ? { customerId: query.customer_id } : {}),
          ...(query.active ? { isActive: query.active === 'true' } : {}),
        },
        include: {
          customer: { select: { id: true, firstName: true, lastName: true, phoneE164: true } },
          employee: { select: { id: true, firstName: true, lastName: true } },
        },
        orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
      });
      const ids = [...new Set(rows.flatMap((r) => r.serviceIds))];
      const services = ids.length ? await tx.service.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
      const nombre = new Map(services.map((s) => [s.id, s.name]));
      return rows.map((r) => ({ ...r, services: r.serviceIds.map((id) => ({ id, name: nombre.get(id) ?? '—' })) }));
    });
  }

  async create(ctx: TenantContext, dto: RecurringCreate) {
    return this.appDb.tx(ctx, async (tx) => {
      const [customer, branch, services] = await Promise.all([
        tx.customer.findFirst({ where: { id: dto.customer_id, deletedAt: null } }),
        tx.branch.findFirst({ where: { id: dto.branch_id, deletedAt: null } }),
        tx.service.findMany({ where: { id: { in: dto.service_ids }, deletedAt: null } }),
      ]);
      if (!customer || !branch) throw new NotFoundException();
      if (services.length !== new Set(dto.service_ids).size) throw new NotFoundException({ title: 'Algun servicio no existe' });
      if (dto.employee_id) {
        const emp = await tx.employee.findFirst({ where: { id: dto.employee_id, deletedAt: null, isActive: true, bookable: true } });
        if (!emp) throw new ConflictException({ title: 'El empleado elegido no existe o no es agendable' });
      }
      const ordenados = dto.service_ids.map((id) => services.find((s) => s.id === id)!);
      return tx.recurringBooking.create({
        data: {
          tenantId: ctx.tenantId,
          customerId: dto.customer_id,
          branchId: dto.branch_id,
          employeeId: dto.employee_id ?? null,
          serviceIds: dto.service_ids,
          frequency: dto.frequency,
          weekday: dto.frequency === 'monthly' ? null : (dto.weekday ?? null),
          dayOfMonth: dto.frequency === 'monthly' ? (dto.day_of_month ?? null) : null,
          timeLocal: dto.time_local,
          durationMin: dto.duration_min ?? duracionTurnoMin(ordenados),
          startsOn: new Date(dto.starts_on),
          endsOn: dto.ends_on ? new Date(dto.ends_on) : null,
          notes: dto.notes,
          createdBy: ctx.userId,
        },
      });
    });
  }

  async update(ctx: TenantContext, id: string, dto: RecurringUpdate) {
    return this.appDb.tx(ctx, async (tx) => {
      const existing = await tx.recurringBooking.findFirst({ where: { id } });
      if (!existing) throw new NotFoundException();
      return tx.recurringBooking.update({
        where: { id },
        data: {
          employeeId: dto.employee_id,
          weekday: dto.weekday,
          dayOfMonth: dto.day_of_month,
          timeLocal: dto.time_local,
          durationMin: dto.duration_min,
          endsOn: dto.ends_on === undefined ? undefined : dto.ends_on ? new Date(dto.ends_on) : null,
          isActive: dto.is_active,
          notes: dto.notes,
          ...(dto.is_active === true ? { lastError: null } : {}),
        },
      });
    });
  }

  /** Quitar = desactivar (los turnos ya generados quedan y la siguen referenciando). */
  async remove(ctx: TenantContext, id: string) {
    return this.appDb.tx(ctx, async (tx) => {
      const existing = await tx.recurringBooking.findFirst({ where: { id } });
      if (!existing) throw new NotFoundException();
      return tx.recurringBooking.update({ where: { id }, data: { isActive: false } });
    });
  }

  // ------------------------------ generacion ------------------------------

  async sweep(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const tenants = await this.appDb.client.tenant.findMany({
        where: { status: { in: ['trial', 'active'] } },
        select: { id: true, tradeName: true, legalName: true, timezone: true },
      });
      for (const t of tenants) {
        await this.generate(t.id, t.tradeName ?? t.legalName, t.timezone ?? 'America/Asuncion').catch((error) => {
          this.logger.error(`recurrentes fallo tenant=${t.id}`, error instanceof Error ? error.stack : String(error));
        });
      }
    } finally {
      this.running = false;
    }
  }

  /** Crea los turnos que caen dentro de la anticipacion configurada y pide confirmacion. */
  async generate(tenantId: string, negocio: string, timezone: string): Promise<number> {
    const ctx = { tenantId, actorType: 'system' as const };
    const settings = await this.appDb.tx(ctx, (tx) => tx.tenantSettings.findUnique({ where: { tenantId } }));
    const leadDays = settings?.recurringLeadDays ?? 7;
    const hoy = new Date().toLocaleDateString('en-CA', { timeZone: timezone });
    const hasta = isoDia(new Date(utcNoon(hoy).getTime() + leadDays * 86_400_000));
    const reglas = await this.appDb.tx(ctx, (tx) =>
      tx.recurringBooking.findMany({
        where: { isActive: true, startsOn: { lte: new Date(hasta) }, OR: [{ endsOn: null }, { endsOn: { gte: new Date(hoy) } }] },
        include: { customer: { select: { id: true, firstName: true, phoneE164: true, notifyWhatsapp: true } } },
      }),
    );
    let creados = 0;
    for (const regla of reglas) {
      const desde = regla.lastGeneratedOn ? isoDia(new Date(regla.lastGeneratedOn.getTime() + 86_400_000)) : hoy;
      const fechas = ocurrencias(regla, desde > hoy ? desde : hoy, hasta);
      for (const fecha of fechas) {
        const [hh, mm] = regla.timeLocal.split(':').map(Number);
        const startsAt = localToUtc(fecha, hh ?? 0, mm ?? 0, timezone);
        if (startsAt.getTime() < Date.now()) {
          await this.marcarGenerado(ctx, regla.id, fecha, null);
          continue;
        }
        try {
          const appointment = await this.appDb.tx(ctx, async (tx) => {
            const created = await this.appointments.createInTx(
              tx,
              ctx,
              {
                branch_id: regla.branchId,
                customer_id: regla.customerId,
                service_ids: regla.serviceIds,
                duration_min: regla.durationMin,
                employee_id: regla.employeeId ?? undefined,
                starts_at: startsAt.toISOString(),
                notes: ['Turno recurrente', regla.notes?.trim() || null].filter(Boolean).join(' — '),
              },
              'panel',
              false,
            );
            const pedirConfirmacion = Boolean(regla.customer.phoneE164 && regla.customer.notifyWhatsapp);
            await tx.appointment.update({
              where: { id: created.id },
              data: { recurringBookingId: regla.id, confirmationRequestedAt: pedirConfirmacion ? new Date() : null },
            });
            return { ...created, pedirConfirmacion };
          });
          creados++;
          await this.marcarGenerado(ctx, regla.id, fecha, null);
          void this.google.pushAppointment(tenantId, appointment.id);
          if (appointment.pedirConfirmacion && regla.customer.phoneE164) {
            const servicios = appointment.services.map((s) => s.name).join(' + ') || 'tu turno';
            const atiende = appointment.employee ? ` con ${appointment.employee.firstName} ${appointment.employee.lastName}` : '';
            const fechaLarga = startsAt.toLocaleDateString('es-PY', { timeZone: timezone, weekday: 'long', day: 'numeric', month: 'long' });
            const hora = startsAt.toLocaleTimeString('es-PY', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false });
            await this.notifier.whatsapp(
              tenantId,
              regla.customer.phoneE164,
              `Hola ${regla.customer.firstName}! Como ${FRECUENCIA[regla.frequency] ?? 'siempre'}, te agendamos ${servicios}${atiende} el ${fechaLarga} a las ${hora} en ${negocio}. ¿Lo confirmás? Respondé SÍ para confirmar o NO para cancelarlo.`,
            );
          }
          this.logger.log(`turno recurrente creado tenant=${tenantId} regla=${regla.id} fecha=${fecha}`);
        } catch (error) {
          const motivo = error instanceof Error ? ((error as { response?: { title?: string } }).response?.title ?? error.message) : String(error);
          await this.marcarGenerado(ctx, regla.id, fecha, motivo);
          await this.notifier.owner(
            tenantId,
            regla.customerId,
            `No se pudo generar el turno recurrente de ${regla.customer.firstName} para el ${fecha} a las ${regla.timeLocal}: ${motivo}. Agendalo a mano o ajustá la regla en su ficha.`,
            `${negocio}: turno recurrente sin agendar`,
          );
          this.logger.warn(`turno recurrente NO creado tenant=${tenantId} regla=${regla.id} fecha=${fecha}: ${motivo}`);
        }
      }
    }
    return creados;
  }

  private marcarGenerado(ctx: { tenantId: string; actorType: 'system' }, reglaId: string, fecha: string, error: string | null) {
    return this.appDb.tx(ctx, (tx) =>
      tx.recurringBooking.update({ where: { id: reglaId }, data: { lastGeneratedOn: new Date(fecha), lastError: error } }),
    );
  }

  // ------------------------------ respuesta del cliente ------------------------------

  /**
   * Si el cliente tiene un turno esperando confirmacion y responde SI o NO,
   * se resuelve aca (determinista) y el bot no interviene. Cualquier otra
   * respuesta devuelve false y sigue su curso normal.
   */
  async handleConfirmationReply(tenantId: string, phoneE164: string, body: string): Promise<boolean> {
    const texto = body.trim();
    const dijoSi = RESPUESTA_SI.test(texto);
    const dijoNo = RESPUESTA_NO.test(texto);
    if ((!dijoSi && !dijoNo) || texto.length > 40) return false;
    const ctx = { tenantId, actorType: 'system' as const };
    const resultado = await this.appDb.tx(ctx, async (tx) => {
      const appt = await tx.appointment.findFirst({
        where: {
          deletedAt: null,
          status: 'pending',
          confirmationRequestedAt: { not: null },
          startsAt: { gt: new Date() },
          customer: { phoneE164 },
        },
        orderBy: { startsAt: 'asc' },
        include: {
          customer: { select: { firstName: true } },
          services: { orderBy: { sort: 'asc' }, select: { service: { select: { name: true } } } },
          service: { select: { name: true } },
        },
      });
      if (!appt) return null;
      const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { timezone: true } });
      const tz = tenant?.timezone ?? 'America/Asuncion';
      const fecha = appt.startsAt.toLocaleDateString('es-PY', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long' });
      const hora = appt.startsAt.toLocaleTimeString('es-PY', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false });
      const servicios = appt.services.map((s) => s.service.name).join(' + ') || appt.service?.name || 'tu turno';
      if (dijoSi) {
        const updated = await tx.appointment.update({
          where: { id: appt.id },
          data: { status: 'confirmed', confirmedAt: new Date(), confirmationRequestedAt: null },
        });
        return { updated, reply: `¡Listo, ${appt.customer.firstName}! Tu turno de ${servicios} del ${fecha} a las ${hora} queda confirmado. Te esperamos.`, cancelado: false };
      }
      const updated = await tx.appointment.update({
        where: { id: appt.id },
        data: {
          status: 'cancelled',
          confirmationRequestedAt: null,
          notes: `${appt.notes ?? ''}\n[cancelado por el cliente al pedirle confirmacion]`.trim(),
        },
      });
      return { updated, reply: `Entendido, ${appt.customer.firstName}: cancelamos tu turno del ${fecha} a las ${hora}. Si querés otro horario, escribinos y lo coordinamos.`, cancelado: true };
    });
    if (!resultado) return false;
    await this.notifier.whatsapp(tenantId, phoneE164, resultado.reply);
    if (resultado.cancelado) void this.google.removeAppointment(tenantId, resultado.updated);
    this.logger.log(`confirmacion recurrente tenant=${tenantId} turno=${resultado.updated.id} → ${resultado.cancelado ? 'cancelado' : 'confirmado'}`);
    return true;
  }
}
