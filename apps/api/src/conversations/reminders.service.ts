import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';

import { AppPrisma } from '../prisma/app-prisma.service';
import { TenantEventsService } from './events.service';
import { WaSenderService } from './wa-sender.service';

const SWEEP_INTERVAL_MS = 5 * 60_000;
/** Un turno reservado hace un rato no necesita recordatorio inmediato. */
const MIN_AGE_MS = 30 * 60_000;
/** No recordar turnos que empiezan en menos de 5 min (ya es tarde). */
const MIN_LEAD_MS = 5 * 60_000;

/**
 * Recordatorios de turno por WhatsApp (P1 replanteo 2026-08-26). El mensaje
 * entra a la conversacion del cliente como cualquier salida (visible en la
 * bandeja); con envio real y plantilla del tenant configurada va como
 * plantilla oficial de Meta (unica via fuera de la ventana de 24 h). Corre
 * in-process cada 5 min; pasa al worker/SQS con el hardening (#19).
 */
@Injectable()
export class RemindersService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Reminders');
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly appDb: AppPrisma,
    private readonly waSender: WaSenderService,
    private readonly events: TenantEventsService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.sweep(), SWEEP_INTERVAL_MS);
    setTimeout(() => void this.sweep(), 45_000);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async sweep(): Promise<void> {
    if (this.running) return; // un barrido a la vez
    this.running = true;
    try {
      const tenants = await this.appDb.client.tenant.findMany({
        where: { status: { in: ['trial', 'active'] } },
        select: { id: true, tradeName: true, legalName: true, timezone: true },
      });
      for (const tenant of tenants) {
        await this.sweepTenant(
          tenant.id,
          tenant.tradeName ?? tenant.legalName,
          tenant.timezone ?? 'America/Asuncion',
        ).catch((error) => {
          this.logger.error(
            `recordatorios fallo tenant=${tenant.id}`,
            error instanceof Error ? error.stack : String(error),
          );
        });
      }
    } finally {
      this.running = false;
    }
  }

  private async sweepTenant(tenantId: string, businessName: string, timezone: string): Promise<void> {
    const ctx = { tenantId, actorType: 'system' as const };
    const settings = await this.appDb.tx(ctx, (tx) =>
      tx.botSettings.findUnique({ where: { tenantId } }),
    );
    if (!settings?.reminderEnabled) return;

    const now = Date.now();
    const due = await this.appDb.tx(ctx, (tx) =>
      tx.appointment.findMany({
        where: {
          deletedAt: null,
          status: { in: ['pending', 'confirmed'] },
          reminderSentAt: null,
          startsAt: {
            gte: new Date(now + MIN_LEAD_MS),
            lte: new Date(now + settings.reminderHours * 3600_000),
          },
          createdAt: { lt: new Date(now - MIN_AGE_MS) },
        },
        include: {
          customer: {
            select: { firstName: true, phoneE164: true, notifyWhatsapp: true },
          },
          service: { select: { name: true } },
          employee: { select: { firstName: true, lastName: true } },
        },
        orderBy: { startsAt: 'asc' },
        take: 50,
      }),
    );
    if (due.length === 0) return;

    for (const appointment of due) {
      // Marcar SIEMPRE (aun sin telefono u opt-out): un turno se recuerda a
      // lo sumo una vez y el barrido no lo re-escanea cada 5 min.
      await this.appDb.tx(ctx, (tx) =>
        tx.appointment.update({
          where: { id: appointment.id },
          data: { reminderSentAt: new Date() },
        }),
      );
      const phone = appointment.customer.phoneE164;
      if (!phone || !appointment.customer.notifyWhatsapp) continue;

      const fecha = appointment.startsAt.toLocaleDateString('es-PY', {
        timeZone: timezone,
        weekday: 'long',
        day: 'numeric',
        month: 'long',
      });
      const hora = appointment.startsAt.toLocaleTimeString('es-PY', {
        timeZone: timezone,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
      const servicio = appointment.service?.name ?? 'tu turno';
      const atiende = appointment.employee
        ? ` con ${appointment.employee.firstName} ${appointment.employee.lastName ?? ''}`.trimEnd()
        : '';
      const body =
        `Hola ${appointment.customer.firstName}! Te recordamos tu turno de ${servicio}` +
        `${atiende} el ${fecha} a las ${hora} en ${businessName}. ` +
        'Si no podes venir, responde este mensaje y lo reprogramamos.';

      const message = await this.appDb.tx(ctx, async (tx) => {
        // La conversacion viva del telefono; si nunca escribio, se abre una.
        let conversation = await tx.conversation.findFirst({
          where: { phoneE164: phone },
          orderBy: { createdAt: 'desc' },
        });
        conversation ??= await tx.conversation.create({
          data: { tenantId, phoneE164: phone, status: 'inactive' },
        });
        const created = await tx.message.create({
          data: {
            tenantId,
            conversationId: conversation.id,
            direction: 'out',
            senderType: 'system',
            body,
            status: 'queued',
          },
        });
        await tx.conversation.update({
          where: { id: conversation.id },
          data: { lastMessageAt: new Date() },
        });
        return created;
      });

      this.events.emit(tenantId, 'conversation.updated', { id: message.conversationId });
      this.waSender.dispatch(
        tenantId,
        message.conversationId,
        message.id,
        settings.reminderTemplate
          ? {
              name: settings.reminderTemplate,
              language: settings.reminderTemplateLang,
              params: [appointment.customer.firstName, servicio, `${fecha} ${hora}`, businessName],
            }
          : undefined,
      );
      this.logger.log(`recordatorio tenant=${tenantId} turno=${appointment.id} → ${phone}`);
    }
  }
}
