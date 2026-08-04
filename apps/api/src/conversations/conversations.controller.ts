import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  Sse,
  type MessageEvent,
} from '@nestjs/common';
import {
  agentMessageCreate,
  conversationListQuery,
  linkCustomerRequest,
  uuid,
  type AgentMessageCreate,
  type ConversationListQuery,
  type LinkCustomerRequest,
} from '@pymes/shared';
import type { FastifyRequest } from 'fastify';
import type { Observable } from 'rxjs';
import { z } from 'zod';

import { RequireFeature, type AuthRequest } from '../auth/decorators';
import { tenantCtx } from '../common/tenant-ctx';
import { ZodPipe } from '../common/zod.pipe';
import { ConversationsService } from './conversations.service';
import { TenantEventsService } from './events.service';

const cursorQuery = z.object({ cursor: z.string().optional() });

@Controller('conversations')
@RequireFeature('chat_inbox')
export class ConversationsController {
  constructor(
    private readonly conversations: ConversationsService,
    private readonly events: TenantEventsService,
  ) {}

  @Get()
  list(
    @Query(new ZodPipe(conversationListQuery)) query: ConversationListQuery,
    @Req() req: FastifyRequest & AuthRequest,
  ) {
    return this.conversations.list(tenantCtx(req), query);
  }

  /**
   * SSE de la bandeja (doc 04 §3.7). EventSource no manda headers:
   * autentica via ?access_token= (aceptado por JwtAuthGuard).
   */
  @Sse('stream')
  stream(@Req() req: FastifyRequest & AuthRequest): Observable<MessageEvent> {
    return this.events.stream(tenantCtx(req).tenantId);
  }

  @Get(':id/messages')
  messages(
    @Param('id', new ZodPipe(uuid)) id: string,
    @Query(new ZodPipe(cursorQuery)) query: { cursor?: string },
    @Req() req: FastifyRequest & AuthRequest,
  ) {
    return this.conversations.messages(tenantCtx(req), id, query.cursor);
  }

  @Post(':id/messages')
  send(
    @Param('id', new ZodPipe(uuid)) id: string,
    @Body(new ZodPipe(agentMessageCreate)) dto: AgentMessageCreate,
    @Req() req: FastifyRequest & AuthRequest,
  ) {
    return this.conversations.sendAsAgent(tenantCtx(req), id, dto.body);
  }

  @Post(':id/pause')
  pause(@Param('id', new ZodPipe(uuid)) id: string, @Req() req: FastifyRequest & AuthRequest) {
    return this.conversations.setStatus(tenantCtx(req), id, 'paused');
  }

  @Post(':id/resume')
  resume(@Param('id', new ZodPipe(uuid)) id: string, @Req() req: FastifyRequest & AuthRequest) {
    return this.conversations.setStatus(tenantCtx(req), id, 'bot_active');
  }

  @Post(':id/link-customer')
  link(
    @Param('id', new ZodPipe(uuid)) id: string,
    @Body(new ZodPipe(linkCustomerRequest)) dto: LinkCustomerRequest,
    @Req() req: FastifyRequest & AuthRequest,
  ) {
    return this.conversations.linkCustomer(tenantCtx(req), id, dto.customer_id);
  }
}
