import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { returnComplete, returnCreate, returnDecide, returnListQuery, uuid, type ReturnComplete, type ReturnCreate, type ReturnDecide, type ReturnListQuery } from '@pymes/shared';
import type { FastifyRequest } from 'fastify';

import { Roles, type AuthRequest } from '../auth/decorators';
import { tenantCtx } from '../common/tenant-ctx';
import { ZodPipe } from '../common/zod.pipe';

import { ReturnsService } from './returns.service';

/** Devoluciones (2026-09-14): pedidos del cliente validados por una persona. */
@Controller('returns')
export class ReturnsController {
  constructor(private readonly returns: ReturnsService) {}

  @Get()
  list(@Query(new ZodPipe(returnListQuery)) query: ReturnListQuery, @Req() req: FastifyRequest & AuthRequest) {
    return this.returns.list(tenantCtx(req), query);
  }

  @Get(':id')
  get(@Param('id', new ZodPipe(uuid)) id: string, @Req() req: FastifyRequest & AuthRequest) {
    return this.returns.get(tenantCtx(req), id);
  }

  @Post()
  create(@Body(new ZodPipe(returnCreate)) dto: ReturnCreate, @Req() req: FastifyRequest & AuthRequest) {
    return this.returns.create(tenantCtx(req), dto, 'panel');
  }

  @Post(':id/decide')
  @Roles('root', 'admin')
  decide(@Param('id', new ZodPipe(uuid)) id: string, @Body(new ZodPipe(returnDecide)) dto: ReturnDecide, @Req() req: FastifyRequest & AuthRequest) {
    return this.returns.decide(tenantCtx(req), id, dto);
  }

  @Post(':id/complete')
  @Roles('root', 'admin')
  complete(@Param('id', new ZodPipe(uuid)) id: string, @Body(new ZodPipe(returnComplete)) dto: ReturnComplete, @Req() req: FastifyRequest & AuthRequest) {
    return this.returns.complete(tenantCtx(req), id, dto);
  }
}
