import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Req } from '@nestjs/common';
import {
  recurringCreate,
  recurringListQuery,
  recurringUpdate,
  uuid,
  type RecurringCreate,
  type RecurringListQuery,
  type RecurringUpdate,
} from '@pymes/shared';
import type { FastifyRequest } from 'fastify';

import { RequireFeature, type AuthRequest } from '../auth/decorators';
import { tenantCtx } from '../common/tenant-ctx';
import { ZodPipe } from '../common/zod.pipe';
import { RecurringService } from './recurring.service';

/** Servicios recurrentes (2026-09-07). */
@Controller('recurring-bookings')
@RequireFeature('scheduling')
export class RecurringController {
  constructor(private readonly recurring: RecurringService) {}

  @Get()
  list(@Query(new ZodPipe(recurringListQuery)) query: RecurringListQuery, @Req() req: FastifyRequest & AuthRequest) {
    return this.recurring.list(tenantCtx(req), query);
  }

  @Post()
  create(@Body(new ZodPipe(recurringCreate)) dto: RecurringCreate, @Req() req: FastifyRequest & AuthRequest) {
    return this.recurring.create(tenantCtx(req), dto);
  }

  @Patch(':id')
  update(
    @Param('id', new ZodPipe(uuid)) id: string,
    @Body(new ZodPipe(recurringUpdate)) dto: RecurringUpdate,
    @Req() req: FastifyRequest & AuthRequest,
  ) {
    return this.recurring.update(tenantCtx(req), id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', new ZodPipe(uuid)) id: string, @Req() req: FastifyRequest & AuthRequest) {
    await this.recurring.remove(tenantCtx(req), id);
  }

  /** Generar ahora los turnos que correspondan (util para probar sin esperar el barrido). */
  @Post('generate')
  async generate(@Req() req: FastifyRequest & AuthRequest) {
    const ctx = tenantCtx(req);
    const tenant = await this.recurring['appDb'].client.tenant.findUnique({
      where: { id: ctx.tenantId },
      select: { tradeName: true, legalName: true, timezone: true },
    });
    const creados = await this.recurring.generate(ctx.tenantId, tenant?.tradeName ?? tenant?.legalName ?? 'el negocio', tenant?.timezone ?? 'America/Asuncion');
    return { creados };
  }
}
