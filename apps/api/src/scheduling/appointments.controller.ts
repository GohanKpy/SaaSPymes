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
import { GoogleCalendarService } from '../integrations/google-calendar.service';
import { AppointmentsService } from './appointments.service';

@Controller('appointments')
@RequireFeature('scheduling')
export class AppointmentsController {
  constructor(
    private readonly appointments: AppointmentsService,
    private readonly google: GoogleCalendarService,
  ) {}

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
  async create(
    @Body(new ZodPipe(appointmentCreate)) dto: AppointmentCreate,
    @Req() req: FastifyRequest & AuthRequest,
  ) {
    const ctx = tenantCtx(req);
    const appointment = await this.appointments.create(ctx, dto, 'panel');
    // Espejo a Google en segundo plano (ADR 0007): jamas frena la reserva.
    void this.google.pushAppointment(ctx.tenantId, appointment.id);
    return appointment;
  }

  @Post(':id/confirm')
  confirm(@Param('id', new ZodPipe(uuid)) id: string, @Req() req: FastifyRequest & AuthRequest) {
    return this.appointments.transition(tenantCtx(req), id, 'confirm');
  }

  @Post(':id/cancel')
  async cancel(
    @Param('id', new ZodPipe(uuid)) id: string,
    @Body(new ZodPipe(appointmentCancel)) dto: AppointmentCancel,
    @Req() req: FastifyRequest & AuthRequest,
  ) {
    const ctx = tenantCtx(req);
    const appointment = await this.appointments.transition(ctx, id, 'cancel', dto.reason);
    void this.google.removeAppointment(ctx.tenantId, appointment);
    return appointment;
  }

  @Post(':id/complete')
  complete(@Param('id', new ZodPipe(uuid)) id: string, @Req() req: FastifyRequest & AuthRequest) {
    return this.appointments.transition(tenantCtx(req), id, 'complete');
  }
}
