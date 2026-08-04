import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import {
  appointmentCancel,
  appointmentCreate,
  appointmentListQuery,
  availabilityQuery,
  uuid,
  type AppointmentCancel,
  type AppointmentCreate,
  type AppointmentListQuery,
  type AvailabilityQuery,
} from '@pymes/shared';
import type { FastifyRequest } from 'fastify';

import { RequireFeature, type AuthRequest } from '../auth/decorators';
import { tenantCtx } from '../common/tenant-ctx';
import { ZodPipe } from '../common/zod.pipe';
import { AppointmentsService } from './appointments.service';

@Controller('appointments')
@RequireFeature('scheduling')
export class AppointmentsController {
  constructor(private readonly appointments: AppointmentsService) {}

  @Get()
  list(
    @Query(new ZodPipe(appointmentListQuery)) query: AppointmentListQuery,
    @Req() req: FastifyRequest & AuthRequest,
  ) {
    return this.appointments.list(tenantCtx(req), query);
  }

  @Get('availability')
  availability(
    @Query(new ZodPipe(availabilityQuery)) query: AvailabilityQuery,
    @Req() req: FastifyRequest & AuthRequest,
  ) {
    return this.appointments.availability(tenantCtx(req), query);
  }

  @Post()
  create(
    @Body(new ZodPipe(appointmentCreate)) dto: AppointmentCreate,
    @Req() req: FastifyRequest & AuthRequest,
  ) {
    return this.appointments.create(tenantCtx(req), dto, 'panel');
  }

  @Post(':id/confirm')
  confirm(@Param('id', new ZodPipe(uuid)) id: string, @Req() req: FastifyRequest & AuthRequest) {
    return this.appointments.transition(tenantCtx(req), id, 'confirm');
  }

  @Post(':id/cancel')
  cancel(
    @Param('id', new ZodPipe(uuid)) id: string,
    @Body(new ZodPipe(appointmentCancel)) dto: AppointmentCancel,
    @Req() req: FastifyRequest & AuthRequest,
  ) {
    return this.appointments.transition(tenantCtx(req), id, 'cancel', dto.reason);
  }

  @Post(':id/complete')
  complete(@Param('id', new ZodPipe(uuid)) id: string, @Req() req: FastifyRequest & AuthRequest) {
    return this.appointments.transition(tenantCtx(req), id, 'complete');
  }
}
