import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Env } from '@pymes/shared';

import { CryptoService } from '../common/crypto.service';
import { MailerService, type MailAttachment } from '../common/mailer.service';
import { serializeMessage } from '../conversations/conversations.service';
import { TenantEventsService } from '../conversations/events.service';
import { WaSenderService, type WaTemplate } from '../conversations/wa-sender.service';
import { ENV } from '../env.module';
import { AppPrisma } from '../prisma/app-prisma.service';

/** Vigencia del link publico al comprobante (piso tecnico). */
const DEFAULT_KUDE_LINK_DAYS = 30;

interface KudeToken {
  t: string; // tenant
  i: string; // invoice
  e: number; // vencimiento (ms)
}

/**
 * Avisos a clientes y al dueño del negocio (2026-09-07): resumen de cuenta,
 * factura emitida, confirmacion de turno recurrente. WhatsApp entra a la
 * conversacion del cliente (visible en la bandeja; sale por la Cloud API con
 * envio real); email va por el SMTP del sistema; al dueño le queda una tarea
 * en Tareas y un correo a los emails de aviso del negocio.
 */
@Injectable()
export class NotifierService {
  private readonly logger = new Logger('Notifier');

  constructor(
    private readonly appDb: AppPrisma,
    private readonly waSender: WaSenderService,
    private readonly events: TenantEventsService,
    private readonly mailer: MailerService,
    private readonly crypto: CryptoService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Mensaje del sistema al cliente por WhatsApp. Devuelve el id de conversacion. */
  async whatsapp(tenantId: string, phone: string, body: string, template?: WaTemplate): Promise<string> {
    const ctx = { tenantId, actorType: 'system' as const };
    const message = await this.appDb.tx(ctx, async (tx) => {
      let conversation = await tx.conversation.findFirst({ where: { phoneE164: phone }, orderBy: { createdAt: 'desc' } });
      // La conversacion queda ligada a la ficha del cliente con ese celular
      // (2026-09-08): cuando responda, el bot tiene que saber quien es para
      // resolver el aviso (ausencia, cuenta del mes) sin volver a preguntar.
      const customer = await tx.customer.findFirst({ where: { phoneE164: phone, deletedAt: null }, select: { id: true } });
      if (!conversation) {
        conversation = await tx.conversation.create({ data: { tenantId, phoneE164: phone, status: 'inactive', customerId: customer?.id } });
      } else if (!conversation.customerId && customer) {
        conversation = await tx.conversation.update({ where: { id: conversation.id }, data: { customerId: customer.id } });
      }
      const created = await tx.message.create({
        data: { tenantId, conversationId: conversation.id, direction: 'out', senderType: 'system', body, status: 'queued' },
      });
      await tx.conversation.update({ where: { id: conversation.id }, data: { lastMessageAt: new Date() } });
      return created;
    });
    this.events.emit(tenantId, 'message.new', serializeMessage(message));
    this.events.emit(tenantId, 'conversation.updated', { id: message.conversationId });
    this.waSender.dispatch(tenantId, message.conversationId, message.id, template);
    return message.conversationId;
  }

  async email(to: string, subject: string, text: string, attachments?: MailAttachment[]): Promise<void> {
    await this.mailer.send({ to, subject, text, attachments });
  }

  /**
   * Aviso al dueño: tarea en la bandeja (vence hoy) y correo a los emails de
   * aviso del negocio (si hay). Nunca lanza: un aviso que falla se loguea.
   */
  async owner(tenantId: string, customerId: string, body: string, subject?: string): Promise<void> {
    const ctx = { tenantId, actorType: 'system' as const };
    try {
      const emails = await this.appDb.tx(ctx, async (tx) => {
        await tx.customerActivity.create({
          data: { tenantId, customerId, activityType: 'tarea', body: body.slice(0, 4000), dueAt: new Date() },
        });
        return tx.notificationEmail.findMany({ select: { email: true } });
      });
      for (const { email } of emails) {
        await this.mailer.send({ to: email, subject: subject ?? body.slice(0, 80), text: body }).catch((error) => {
          this.logger.warn(`correo al dueño fallo tenant=${tenantId} to=${email}: ${error instanceof Error ? error.message : String(error)}`);
        });
      }
    } catch (error) {
      this.logger.error(`aviso al dueño fallo tenant=${tenantId}`, error instanceof Error ? error.stack : String(error));
    }
  }

  /** Solo el correo a los emails de aviso del negocio (sin tarea): resumenes con varios clientes (2026-09-08). */
  async ownerEmail(tenantId: string, subject: string, text: string): Promise<void> {
    const ctx = { tenantId, actorType: 'system' as const };
    try {
      const emails = await this.appDb.tx(ctx, (tx) => tx.notificationEmail.findMany({ select: { email: true } }));
      for (const { email } of emails) {
        await this.mailer.send({ to: email, subject, text }).catch((error) => {
          this.logger.warn(`correo al dueño fallo tenant=${tenantId} to=${email}: ${error instanceof Error ? error.message : String(error)}`);
        });
      }
    } catch (error) {
      this.logger.error(`correo al dueño fallo tenant=${tenantId}`, error instanceof Error ? error.stack : String(error));
    }
  }

  /** Link publico y firmado al comprobante: JSON cifrado (AES-GCM) con tenant, factura y vencimiento. */
  kudeLink(tenantId: string, invoiceId: string, days = DEFAULT_KUDE_LINK_DAYS): string {
    const payload: KudeToken = { t: tenantId, i: invoiceId, e: Date.now() + days * 86_400_000 };
    const token = Buffer.from(this.crypto.encryptJson(payload)).toString('base64url');
    const base = this.env.PUBLIC_API_URL?.replace(/\/$/, '') || 'http://localhost:4301';
    return `${base}/api/v1/public/kude?t=${token}`;
  }

  /** Abre un token de comprobante; null si es invalido o vencio. */
  openKudeToken(token: string): { tenantId: string; invoiceId: string } | null {
    try {
      const payload = this.crypto.decryptJson<KudeToken>(new Uint8Array(Buffer.from(token, 'base64url')));
      if (!payload?.t || !payload.i || typeof payload.e !== 'number' || payload.e < Date.now()) return null;
      return { tenantId: payload.t, invoiceId: payload.i };
    } catch {
      return null;
    }
  }
}
