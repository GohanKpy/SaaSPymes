import { createHmac, timingSafeEqual } from 'node:crypto';

import {
  Controller,
  type RawBodyRequest,
  Get,
  Inject,
  Logger,
  NotFoundException,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { waWebhookPayload, type Env } from '@pymes/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';

import { Public } from '../auth/decorators';
import { RateLimit, RateLimitGuard } from '../common/rate-limit.guard';
import { tenantTx } from '@pymes/db';
import { ZodPipe } from '../common/zod.pipe';
import { ENV } from '../env.module';
import { AppPrisma } from '../prisma/app-prisma.service';
import { PlatformPrisma } from '../prisma/platform-prisma.service';
import { ConversationsService, serializeMessage } from './conversations.service';

const verifyQuery = z.object({
  'hub.mode': z.string().optional(),
  'hub.verify_token': z.string().optional(),
  'hub.challenge': z.string().optional(),
});

const pollQuery = z.object({
  phone_number_id: z.string().min(1),
  from_phone: z.string().min(1),
});

/**
 * Webhooks de chat (doc 04 §3.10): sin JWT, con verificacion propia.
 * El chat web de prueba emite payloads identicos a Meta firmados con el
 * mismo app secret: el pipeline testeado hoy es el que usara WhatsApp
 * cuando se cargue el phone_number_id real.
 */
@Controller('webhooks')
@Public()
export class WebhooksController {
  private readonly logger = new Logger('Webhooks');

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly conversations: ConversationsService,
    private readonly platformDb: PlatformPrisma,
    private readonly appDb: AppPrisma,
  ) {}

  /** Handshake de suscripcion de Meta. */
  @Get('whatsapp')
  verify(@Query(new ZodPipe(verifyQuery)) q: Record<string, string | undefined>): string {
    if (q['hub.mode'] === 'subscribe' && q['hub.verify_token'] === this.env.META_VERIFY_TOKEN) {
      return q['hub.challenge'] ?? '';
    }
    throw new UnauthorizedException();
  }

  @Post('whatsapp')
  @UseGuards(RateLimitGuard)
  @RateLimit(600, 60) // generoso para rafagas de Meta; frena abuso sin firma valida
  async inbound(@Req() req: RawBodyRequest<FastifyRequest>): Promise<{ received: true }> {
    this.assertSignature(req);
    const payload = waWebhookPayload.parse(req.body);

    for (const entry of payload.entry) {
      for (const change of entry.changes) {
        const value = change.value;
        const tenantId = await this.resolveTenant(value.metadata.phone_number_id);
        if (!tenantId) {
          // phone_number_id desconocido: se ignora sin filtrar informacion.
          this.logger.warn(`webhook sin tenant: phone_number_id=${value.metadata.phone_number_id}`);
          continue;
        }
        for (const message of value.messages ?? []) {
          if (message.type !== 'text' || !message.text) continue;
          const profileName = value.contacts?.find((c) => c.wa_id === message.from)?.profile.name;
          await this.conversations.inbound(tenantId, {
            phoneE164: `+${message.from.replace(/^\+/, '')}`,
            profileName,
            body: message.text.body,
            waMessageId: message.id,
          });
        }
      }
    }
    // 200 inmediato: Meta reintenta ante cualquier otra cosa (doc 01 §3.1).
    return { received: true };
  }

  /**
   * SOLO laboratorio: lectura de la conversacion para el chat web de prueba
   * (el "cliente" ve las respuestas del panel). Nunca en produccion.
   */
  @Get('webchat/messages')
  async poll(@Query(new ZodPipe(pollQuery)) q: { phone_number_id: string; from_phone: string }) {
    if (this.env.NODE_ENV === 'production') throw new NotFoundException();
    const tenantId = await this.resolveTenant(q.phone_number_id);
    if (!tenantId) throw new NotFoundException();

    return tenantTx(this.appDb.client, { tenantId, actorType: 'system' }, async (tx) => {
      const conversation = await tx.conversation.findFirst({
        where: { phoneE164: q.from_phone },
      });
      if (!conversation) return { status: null, messages: [] };
      const messages = await tx.message.findMany({
        where: { conversationId: conversation.id },
        orderBy: { id: 'asc' },
        take: 100,
      });
      return { status: conversation.status, messages: messages.map(serializeMessage) };
    });
  }

  private assertSignature(req: RawBodyRequest<FastifyRequest>): void {
    const signature = req.headers['x-hub-signature-256'];
    const raw = req.rawBody;
    if (typeof signature !== 'string' || !signature.startsWith('sha256=') || !raw) {
      throw new UnauthorizedException();
    }
    const expected = createHmac('sha256', this.env.META_APP_SECRET)
      .update(raw)
      .digest('hex');
    const provided = signature.slice('sha256='.length);
    if (
      provided.length !== expected.length ||
      !timingSafeEqual(Buffer.from(provided, 'utf8'), Buffer.from(expected, 'utf8'))
    ) {
      throw new UnauthorizedException();
    }
  }

  /** La identidad del tenant sale del phone_number_id, nunca del contenido. */
  private async resolveTenant(phoneNumberId: string): Promise<string | null> {
    const credential = await this.platformDb.client.integrationCredential.findFirst({
      where: {
        type: 'whatsapp',
        isActive: true,
        publicConfig: { path: ['phone_number_id'], equals: phoneNumberId },
      },
    });
    return credential?.tenantId ?? null;
  }
}
