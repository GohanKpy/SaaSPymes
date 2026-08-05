import { Inject, Injectable, Logger } from '@nestjs/common';
import { WaCloudClient } from '@pymes/wa';
import type { Env } from '@pymes/shared';

import { CryptoService } from '../common/crypto.service';
import { ENV } from '../env.module';
import { AppPrisma } from '../prisma/app-prisma.service';
import { serializeMessage } from './conversations.service';
import { TenantEventsService } from './events.service';

interface WaPublicConfig {
  phone_number_id?: string;
  live?: boolean;
}

/**
 * Salida real por WhatsApp Cloud API. Solo actua si la integracion del
 * tenant esta configurada con `live: true`: en el laboratorio (webchat)
 * las respuestas se leen de la base y no hay nada que enviar. El envio es
 * fire-and-forget: jamas bloquea la respuesta al panel ni al bot; el
 * resultado queda en el estado del mensaje (sent + wa_message_id | failed).
 */
@Injectable()
export class WaSenderService {
  private readonly logger = new Logger('WaSender');

  constructor(
    private readonly appDb: AppPrisma,
    private readonly crypto: CryptoService,
    private readonly events: TenantEventsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  dispatch(tenantId: string, conversationId: string, messageId: bigint): void {
    void this.send(tenantId, conversationId, messageId).catch((error) => {
      this.logger.error(
        `despacho WA fallo tenant=${tenantId} msg=${messageId}`,
        error instanceof Error ? error.stack : String(error),
      );
    });
  }

  private async send(tenantId: string, conversationId: string, messageId: bigint): Promise<void> {
    const ctx = { tenantId, actorType: 'system' as const };
    const data = await this.appDb.tx(ctx, async (tx) => {
      const credential = await tx.integrationCredential.findFirst({
        where: { type: 'whatsapp', isActive: true },
      });
      const conversation = await tx.conversation.findFirst({ where: { id: conversationId } });
      const message = await tx.message.findFirst({ where: { id: messageId } });
      return { credential, conversation, message };
    });

    const publicConfig = (data.credential?.publicConfig ?? {}) as WaPublicConfig;
    if (
      !data.credential ||
      !data.conversation ||
      !data.message ||
      publicConfig.live !== true ||
      !publicConfig.phone_number_id
    ) {
      return; // sin envio real configurado: modo laboratorio
    }

    const secret = this.crypto.decryptJson<{ access_token?: string }>(
      data.credential.encryptedPayload,
    );
    if (!secret.access_token) return;

    const client = new WaCloudClient({
      accessToken: secret.access_token,
      phoneNumberId: publicConfig.phone_number_id,
      baseUrl: this.env.WA_GRAPH_BASE_URL,
    });

    try {
      const { waMessageId } = await client.sendText(data.conversation.phoneE164, data.message.body);
      const updated = await this.appDb.tx(ctx, (tx) =>
        tx.message.update({ where: { id: messageId }, data: { waMessageId, status: 'sent' } }),
      );
      this.events.emit(tenantId, 'message.status', serializeMessage(updated));
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.warn(`envio WA fallo tenant=${tenantId} msg=${messageId}: ${detail}`);
      const updated = await this.appDb.tx(ctx, (tx) =>
        tx.message.update({
          where: { id: messageId },
          data: { status: 'failed', errorDetail: detail.slice(0, 500) },
        }),
      );
      this.events.emit(tenantId, 'message.status', serializeMessage(updated));
    }
  }
}
