import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { Prisma } from '@pymes/db';
import {
  activityCreate,
  activityUpdate,
  contactPointCreate,
  contactPointUpdate,
  customFieldDefCreate,
  customFieldDefUpdate,
  uuid,
  type ActivityCreate,
  type ActivityUpdate,
  type ContactPointCreate,
  type ContactPointUpdate,
  type CustomFieldDefCreate,
  type CustomFieldDefUpdate,
} from '@pymes/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';

import { RequireFeature, Roles, type AuthRequest } from '../auth/decorators';
import { tenantCtx } from '../common/tenant-ctx';
import { ZodPipe } from '../common/zod.pipe';
import { AppPrisma } from '../prisma/app-prisma.service';

const entityQuery = z.object({
  entity: z.enum(['customer', 'service', 'appointment', 'invoice']).default('customer'),
});

const tasksQuery = z.object({
  status: z.enum(['pending', 'done', 'all']).default('pending'),
  assigned_user_id: uuid.optional(),
});

/**
 * CRM extendido (2026-08-26): multiples puntos de contacto por cliente,
 * timeline de notas/tareas y definiciones de campos personalizados del
 * tenant. Los valores de los campos viven en customers.custom_data.
 */
@Controller()
@RequireFeature('crm')
export class CrmExtrasController {
  constructor(private readonly appDb: AppPrisma) {}

  // --------------------- puntos de contacto ---------------------

  @Get('customers/:id/contact-points')
  listContactPoints(
    @Param('id', new ZodPipe(uuid)) customerId: string,
    @Req() req: FastifyRequest & AuthRequest,
  ) {
    return this.appDb.tx(tenantCtx(req), (tx) =>
      tx.customerContactPoint.findMany({
        where: { customerId },
        orderBy: [{ kind: 'asc' }, { sort: 'asc' }],
      }),
    );
  }

  @Post('customers/:id/contact-points')
  addContactPoint(
    @Param('id', new ZodPipe(uuid)) customerId: string,
    @Body(new ZodPipe(contactPointCreate)) dto: ContactPointCreate,
    @Req() req: FastifyRequest & AuthRequest,
  ) {
    const ctx = tenantCtx(req);
    return this.appDb.tx(ctx, async (tx) => {
      const customer = await tx.customer.findFirst({ where: { id: customerId, deletedAt: null } });
      if (!customer) throw new NotFoundException();
      if (dto.is_primary) {
        // un solo principal por tipo: el nuevo desplaza al anterior
        await tx.customerContactPoint.updateMany({
          where: { customerId, kind: dto.kind, isPrimary: true },
          data: { isPrimary: false },
        });
      }
      return tx.customerContactPoint.create({
        data: {
          tenantId: ctx.tenantId,
          customerId,
          kind: dto.kind,
          label: dto.label,
          value: dto.value,
          isPrimary: dto.is_primary,
          sort: dto.sort,
        },
      });
    });
  }

  @Patch('customers/:id/contact-points/:cpId')
  updateContactPoint(
    @Param('id', new ZodPipe(uuid)) customerId: string,
    @Param('cpId', new ZodPipe(uuid)) cpId: string,
    @Body(new ZodPipe(contactPointUpdate)) dto: ContactPointUpdate,
    @Req() req: FastifyRequest & AuthRequest,
  ) {
    return this.appDb.tx(tenantCtx(req), async (tx) => {
      const existing = await tx.customerContactPoint.findFirst({
        where: { id: cpId, customerId },
      });
      if (!existing) throw new NotFoundException();
      if (dto.is_primary) {
        await tx.customerContactPoint.updateMany({
          where: { customerId, kind: dto.kind ?? existing.kind, isPrimary: true },
          data: { isPrimary: false },
        });
      }
      return tx.customerContactPoint.update({
        where: { id: cpId },
        data: {
          kind: dto.kind,
          label: dto.label,
          value: dto.value,
          isPrimary: dto.is_primary,
          sort: dto.sort,
        },
      });
    });
  }

  @Delete('customers/:id/contact-points/:cpId')
  @HttpCode(204)
  async removeContactPoint(
    @Param('id', new ZodPipe(uuid)) customerId: string,
    @Param('cpId', new ZodPipe(uuid)) cpId: string,
    @Req() req: FastifyRequest & AuthRequest,
  ) {
    await this.appDb.tx(tenantCtx(req), (tx) =>
      tx.customerContactPoint.deleteMany({ where: { id: cpId, customerId } }),
    );
  }

  // --------------------- bandeja de tareas (todo el negocio) ---------------------

  /** Tareas y seguimientos de TODOS los clientes: la bandeja del panel. */
  @Get('activities')
  listTasks(
    @Query(new ZodPipe(tasksQuery)) q: { status: 'pending' | 'done' | 'all'; assigned_user_id?: string },
    @Req() req: FastifyRequest & AuthRequest,
  ) {
    return this.appDb.tx(tenantCtx(req), (tx) =>
      tx.customerActivity.findMany({
        where: {
          activityType: { in: ['tarea', 'seguimiento'] },
          ...(q.status === 'pending' ? { doneAt: null } : q.status === 'done' ? { doneAt: { not: null } } : {}),
          ...(q.assigned_user_id ? { assignedUserId: q.assigned_user_id } : {}),
          customer: { deletedAt: null },
        },
        include: {
          customer: { select: { id: true, firstName: true, lastName: true, phoneE164: true } },
        },
        orderBy: [{ dueAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }],
        take: 200,
      }),
    );
  }

  // --------------------- timeline: notas y tareas ---------------------

  @Get('customers/:id/activities')
  listActivities(
    @Param('id', new ZodPipe(uuid)) customerId: string,
    @Req() req: FastifyRequest & AuthRequest,
  ) {
    return this.appDb.tx(tenantCtx(req), (tx) =>
      tx.customerActivity.findMany({
        where: { customerId },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
    );
  }

  @Post('customers/:id/activities')
  addActivity(
    @Param('id', new ZodPipe(uuid)) customerId: string,
    @Body(new ZodPipe(activityCreate)) dto: ActivityCreate,
    @Req() req: FastifyRequest & AuthRequest,
  ) {
    const ctx = tenantCtx(req);
    return this.appDb.tx(ctx, async (tx) => {
      const customer = await tx.customer.findFirst({ where: { id: customerId, deletedAt: null } });
      if (!customer) throw new NotFoundException();
      return tx.customerActivity.create({
        data: {
          tenantId: ctx.tenantId,
          customerId,
          activityType: dto.activity_type,
          body: dto.body,
          dueAt: dto.due_at ? new Date(dto.due_at) : undefined,
          assignedUserId: dto.assigned_user_id,
          createdBy: ctx.userId,
        },
      });
    });
  }

  @Patch('customers/:id/activities/:aId')
  updateActivity(
    @Param('id', new ZodPipe(uuid)) customerId: string,
    @Param('aId', new ZodPipe(uuid)) aId: string,
    @Body(new ZodPipe(activityUpdate)) dto: ActivityUpdate,
    @Req() req: FastifyRequest & AuthRequest,
  ) {
    return this.appDb.tx(tenantCtx(req), async (tx) => {
      const existing = await tx.customerActivity.findFirst({ where: { id: aId, customerId } });
      if (!existing) throw new NotFoundException();
      return tx.customerActivity.update({
        where: { id: aId },
        data: {
          body: dto.body,
          dueAt: dto.due_at === undefined ? undefined : dto.due_at ? new Date(dto.due_at) : null,
          assignedUserId: dto.assigned_user_id,
          ...(dto.done === undefined ? {} : { doneAt: dto.done ? new Date() : null }),
        },
      });
    });
  }

  @Delete('customers/:id/activities/:aId')
  @HttpCode(204)
  async removeActivity(
    @Param('id', new ZodPipe(uuid)) customerId: string,
    @Param('aId', new ZodPipe(uuid)) aId: string,
    @Req() req: FastifyRequest & AuthRequest,
  ) {
    await this.appDb.tx(tenantCtx(req), (tx) =>
      tx.customerActivity.deleteMany({ where: { id: aId, customerId } }),
    );
  }

  // ---------------- campos personalizados (definiciones) ----------------

  @Get('custom-fields')
  listDefs(
    @Query(new ZodPipe(entityQuery)) q: { entity: string },
    @Req() req: FastifyRequest & AuthRequest,
  ) {
    return this.appDb.tx(tenantCtx(req), (tx) =>
      tx.customFieldDef.findMany({
        where: { entity: q.entity },
        orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }],
      }),
    );
  }

  @Post('custom-fields')
  @Roles('root', 'admin')
  createDef(
    @Body(new ZodPipe(customFieldDefCreate)) dto: CustomFieldDefCreate,
    @Req() req: FastifyRequest & AuthRequest,
  ) {
    const ctx = tenantCtx(req);
    return this.appDb.tx(ctx, (tx) =>
      tx.customFieldDef.create({
        data: {
          tenantId: ctx.tenantId,
          entity: dto.entity,
          code: dto.code,
          label: dto.label,
          fieldType: dto.field_type,
          options: dto.options as Prisma.InputJsonValue,
          required: dto.required,
          showInForm: dto.show_in_form,
          sort: dto.sort,
        },
      }),
    );
  }

  @Patch('custom-fields/:id')
  @Roles('root', 'admin')
  updateDef(
    @Param('id', new ZodPipe(uuid)) id: string,
    @Body(new ZodPipe(customFieldDefUpdate)) dto: CustomFieldDefUpdate,
    @Req() req: FastifyRequest & AuthRequest,
  ) {
    return this.appDb.tx(tenantCtx(req), async (tx) => {
      const existing = await tx.customFieldDef.findFirst({ where: { id } });
      if (!existing) throw new NotFoundException();
      return tx.customFieldDef.update({
        where: { id },
        data: {
          label: dto.label,
          options: dto.options === undefined ? undefined : (dto.options as Prisma.InputJsonValue),
          required: dto.required,
          showInForm: dto.show_in_form,
          sort: dto.sort,
          isActive: dto.is_active,
          updatedAt: new Date(),
        },
      });
    });
  }

  /** Desactivar, no borrar: los clientes ya cargados conservan su dato. */
  @Delete('custom-fields/:id')
  @Roles('root', 'admin')
  @HttpCode(204)
  async removeDef(@Param('id', new ZodPipe(uuid)) id: string, @Req() req: FastifyRequest & AuthRequest) {
    await this.appDb.tx(tenantCtx(req), (tx) =>
      tx.customFieldDef.updateMany({ where: { id }, data: { isActive: false } }),
    );
  }
}
