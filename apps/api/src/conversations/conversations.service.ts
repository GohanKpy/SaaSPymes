import { Inject, Injectable, NotFoundException, forwardRef } from '@nestjs/common';
import type { TenantContext } from '@pymes/db';
import type { ConversationListQuery, Page } from '@pymes/shared';

import { decodeCursor, encodeCursor } from '../common/pagination';
import { AppPrisma } from '../prisma/app-prisma.service';
import { BotService } from './bot.service';
import { TenantEventsService } from './events.service';
import { WaSenderService } from './wa-sender.service';

export interface InboundMessage {
  phoneE164: string;
  profileName?: string;
  body: string;
  waMessageId?: string;
}

@Injectable()
export class ConversationsService {
  constructor(
    private readonly appDb: AppPrisma,
    private readonly events: TenantEventsService,
    @Inject(forwardRef(() => BotService)) private readonly bot: BotService,
    private readonly waSender: WaSenderService,
  ) {}

  async list(ctx: TenantContext, query: ConversationListQuery): Promise<Page<unknown>> {
    const cursorId = decodeCursor(query.cursor);
    const rows = await this.appDb.tx(ctx, (tx) =>
      tx.conversation.findMany({
        where: {
          ...(query.status ? { status: query.status } : {}),
          ...(query.q ? { phoneE164: { contains: query.q } } : {}),
        },
        // email/doc/telefono del cliente alimentan el buscador de la bandeja.
        include: {
          customer: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              docNumber: true,
              phoneE164: true,
            },
          },
        },
        orderBy: [{ lastMessageAt: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }],
        take: query.limit + 1,
        ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
      }),
    );
    const hasMore = rows.length > query.limit;
    const data = hasMore ? rows.slice(0, query.limit) : rows;
    const last = data[data.length - 1];
    return { data, next_cursor: hasMore && last ? encodeCursor(last.id) : null };
  }

  async messages(ctx: TenantContext, conversationId: string, cursor?: string) {
    const cursorId = decodeCursor(cursor);
    const conversation = await this.appDb.tx(ctx, (tx) =>
      tx.conversation.findFirst({ where: { id: conversationId } }),
    );
    if (!conversation) throw new NotFoundException();
    const rows = await this.appDb.tx(ctx, (tx) =>
      tx.message.findMany({
        where: { conversationId },
        orderBy: { id: 'desc' },
        take: 51,
        ...(cursorId ? { cursor: { id: BigInt(cursorId) }, skip: 1 } : {}),
      }),
    );
    const hasMore = rows.length > 50;
    const data = (hasMore ? rows.slice(0, 50) : rows).reverse();
    const oldest = hasMore ? rows[49] : undefined;
    return { data, next_cursor: oldest ? encodeCursor(String(oldest.id)) : null };
  }

  /** Mensaje del agente humano (doc 04 §3.7). Si la integracion WhatsApp
   *  del tenant esta en modo live, ademas sale de verdad por Cloud API. */
  async sendAsAgent(ctx: TenantContext, conversationId: string, body: string) {
    const message = await this.appDb.tx(ctx, async (tx) => {
      const conversation = await tx.conversation.findFirst({ where: { id: conversationId } });
      if (!conversation) throw new NotFoundException();
      const created = await tx.message.create({
        data: {
          tenantId: ctx.tenantId,
          conversationId,
          direction: 'out',
          senderType: 'agent',
          senderUserId: ctx.userId,
          body,
          status: 'sent',
        },
      });
      await tx.conversation.update({
        where: { id: conversationId },
        data: { lastMessageAt: created.createdAt },
      });
      return created;
    });
    this.events.emit(ctx.tenantId, 'message.new', serializeMessage(message));
    this.waSender.dispatch(ctx.tenantId, conversationId, message.id);
    return message;
  }

  async setStatus(ctx: TenantContext, conversationId: string, status: 'paused' | 'bot_active') {
    const conversation = await this.appDb.tx(ctx, async (tx) => {
      const existing = await tx.conversation.findFirst({ where: { id: conversationId } });
      if (!existing) throw new NotFoundException();
      return tx.conversation.update({
        where: { id: conversationId },
        data: { status, assignedUserId: status === 'paused' ? ctx.userId : null },
      });
    });
    this.events.emit(ctx.tenantId, 'conversation.updated', {
      id: conversation.id,
      status: conversation.status,
    });
    return conversation;
  }

  async linkCustomer(ctx: TenantContext, conversationId: string, customerId: string) {
    return this.appDb.tx(ctx, async (tx) => {
      const conversation = await tx.conversation.findFirst({ where: { id: conversationId } });
      const customer = await tx.customer.findFirst({ where: { id: customerId, deletedAt: null } });
      if (!conversation || !customer) throw new NotFoundException();
      return tx.conversation.update({ where: { id: conversationId }, data: { customerId } });
    });
  }

  /**
   * Mensaje entrante ya atribuido a un tenant (webhook, doc 01 §3.1):
   * dedupe por wa_message_id, conversacion por telefono con matching
   * automatico de cliente, persistencia y aviso SSE. Con la conversacion en
   * paused/agent el bot no interviene (cuando exista, fase 2): solo se persiste.
   */
  async inbound(tenantId: string, msg: InboundMessage): Promise<void> {
    const ctx: TenantContext = { tenantId, actorType: 'system' };
    const stored = await this.appDb.tx(ctx, async (tx) => {
      if (msg.waMessageId) {
        const dupe = await tx.message.findFirst({ where: { waMessageId: msg.waMessageId } });
        if (dupe) return null; // Meta reintenta: idempotencia (doc 01 §7)
      }
      let conversation = await tx.conversation.findFirst({
        where: { phoneE164: msg.phoneE164 },
      });
      if (conversation?.status === 'inactive') {
        // El cliente volvio a escribir: la conversacion revive con el bot.
        conversation = await tx.conversation.update({
          where: { id: conversation.id },
          data: { status: 'bot_active' },
        });
      }
      if (!conversation) {
        const customer = await tx.customer.findFirst({
          where: { phoneE164: msg.phoneE164, deletedAt: null },
        });
        conversation = await tx.conversation.create({
          data: {
            tenantId,
            phoneE164: msg.phoneE164,
            customerId: customer?.id,
          },
        });
      }
      const message = await tx.message.create({
        data: {
          tenantId,
          conversationId: conversation.id,
          direction: 'in',
          senderType: 'customer',
          body: msg.body,
          waMessageId: msg.waMessageId,
          status: 'delivered',
        },
      });
      await tx.conversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt: message.createdAt },
      });
      return message;
    });
    if (stored) {
      this.events.emit(tenantId, 'message.new', serializeMessage(stored));
      // El bot responde fuera del request del webhook (200 inmediato, doc 01);
      // con status paused/agent el propio bot decide no intervenir.
      this.bot.scheduleRespond(tenantId, stored.conversationId);
    }
  }
}

export function serializeMessage(m: {
  id: bigint;
  conversationId: string;
  direction: string;
  senderType: string;
  body: string;
  status: string;
  createdAt: Date;
}) {
  return {
    id: String(m.id),
    conversation_id: m.conversationId,
    direction: m.direction,
    sender_type: m.senderType,
    body: m.body,
    status: m.status,
    created_at: m.createdAt.toISOString(),
  };
}
