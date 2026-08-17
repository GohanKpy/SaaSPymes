import {
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import {
  categoryCreate,
  categoryUpdate,
  serviceCreate,
  serviceUpdate,
  uuid,
  type CategoryCreate,
  type CategoryUpdate,
  type ServiceCreate,
  type ServiceUpdate,
} from '@pymes/shared';
import type { FastifyRequest } from 'fastify';

import { RequireFeature, type AuthRequest } from '../auth/decorators';
import { tenantCtx } from '../common/tenant-ctx';
import { ZodPipe } from '../common/zod.pipe';
import { AppPrisma } from '../prisma/app-prisma.service';

@Controller('catalog')
@RequireFeature('catalog')
export class CatalogController {
  constructor(private readonly appDb: AppPrisma) {}

  // ------------------------------ categorias -------------------------------

  @Get('categories')
  listCategories(@Req() req: FastifyRequest & AuthRequest) {
    return this.appDb.tx(tenantCtx(req), (tx) =>
      tx.serviceCategory.findMany({ where: { deletedAt: null }, orderBy: { sortOrder: 'asc' } }),
    );
  }

  @Post('categories')
  createCategory(
    @Body(new ZodPipe(categoryCreate)) dto: CategoryCreate,
    @Req() req: FastifyRequest & AuthRequest,
  ) {
    const ctx = tenantCtx(req);
    return this.appDb.tx(ctx, (tx) =>
      tx.serviceCategory.create({
        data: {
          tenantId: ctx.tenantId,
          name: dto.name,
          sortOrder: dto.sort_order,
          defaultKind: dto.default_kind,
        },
      }),
    );
  }

  @Patch('categories/:id')
  patchCategory(
    @Param('id', new ZodPipe(uuid)) id: string,
    @Body(new ZodPipe(categoryUpdate)) dto: CategoryUpdate,
    @Req() req: FastifyRequest & AuthRequest,
  ) {
    return this.appDb.tx(tenantCtx(req), async (tx) => {
      const existing = await tx.serviceCategory.findFirst({ where: { id, deletedAt: null } });
      if (!existing) throw new NotFoundException();
      return tx.serviceCategory.update({
        where: { id },
        data: { name: dto.name, sortOrder: dto.sort_order, defaultKind: dto.default_kind },
      });
    });
  }

  @Delete('categories/:id')
  @HttpCode(204)
  async removeCategory(
    @Param('id', new ZodPipe(uuid)) id: string,
    @Req() req: FastifyRequest & AuthRequest,
  ) {
    await this.appDb.tx(tenantCtx(req), async (tx) => {
      const existing = await tx.serviceCategory.findFirst({ where: { id, deletedAt: null } });
      if (!existing) throw new NotFoundException();
      const active = await tx.service.count({ where: { categoryId: id, deletedAt: null } });
      if (active > 0) throw new ConflictException({ title: 'La categoria tiene servicios activos' });
      await tx.serviceCategory.update({ where: { id }, data: { deletedAt: new Date() } });
    });
  }

  // ------------------------------- servicios -------------------------------

  @Get('services')
  listServices(@Req() req: FastifyRequest & AuthRequest) {
    return this.appDb.tx(tenantCtx(req), (tx) =>
      tx.service.findMany({
        where: { deletedAt: null },
        include: { category: { select: { name: true } } },
        orderBy: [{ category: { sortOrder: 'asc' } }, { name: 'asc' }],
      }),
    );
  }

  @Post('services')
  createService(
    @Body(new ZodPipe(serviceCreate)) dto: ServiceCreate,
    @Req() req: FastifyRequest & AuthRequest,
  ) {
    const ctx = tenantCtx(req);
    return this.appDb.tx(ctx, async (tx) => {
      const category = await tx.serviceCategory.findFirst({
        where: { id: dto.category_id, deletedAt: null },
      });
      if (!category) throw new NotFoundException({ title: 'Categoria inexistente' });
      // El tipo vive en el producto; la categoria solo presta su default.
      const kind = dto.kind ?? category.defaultKind;
      return tx.service.create({
        data: {
          tenantId: ctx.tenantId,
          categoryId: dto.category_id,
          name: dto.name,
          description: dto.description,
          price: dto.price,
          currency: dto.currency,
          taxRate: dto.tax_rate,
          isActive: dto.is_active,
          kind,
          durationMin: kind === 'servicio' ? dto.duration_min : null,
          requiresMeeting: kind === 'item' ? (dto.requires_meeting ?? true) : false,
          meetingMin: kind === 'item' ? dto.meeting_min : null,
        },
      });
    });
  }

  @Patch('services/:id')
  patchService(
    @Param('id', new ZodPipe(uuid)) id: string,
    @Body(new ZodPipe(serviceUpdate)) dto: ServiceUpdate,
    @Req() req: FastifyRequest & AuthRequest,
  ) {
    return this.appDb.tx(tenantCtx(req), async (tx) => {
      const existing = await tx.service.findFirst({ where: { id, deletedAt: null } });
      if (!existing) throw new NotFoundException();
      // Normalizacion por tipo sobre el estado FINAL: un servicio no arrastra
      // datos de reunion y un item no tiene duracion de tarea.
      const kind = dto.kind ?? existing.kind;
      const durationMin = dto.duration_min !== undefined ? dto.duration_min : existing.durationMin;
      const requiresMeeting =
        dto.requires_meeting !== undefined ? dto.requires_meeting : existing.requiresMeeting;
      const meetingMin = dto.meeting_min !== undefined ? dto.meeting_min : existing.meetingMin;
      return tx.service.update({
        where: { id },
        data: {
          categoryId: dto.category_id,
          name: dto.name,
          description: dto.description,
          price: dto.price,
          currency: dto.currency,
          taxRate: dto.tax_rate,
          isActive: dto.is_active,
          kind,
          durationMin: kind === 'servicio' ? durationMin : null,
          requiresMeeting: kind === 'item' ? requiresMeeting : false,
          meetingMin: kind === 'item' ? meetingMin : null,
        },
      });
    });
  }

  /** Soft delete: no rompe turnos ni facturas historicas (doc 08 §5). */
  @Delete('services/:id')
  @HttpCode(204)
  async removeService(
    @Param('id', new ZodPipe(uuid)) id: string,
    @Req() req: FastifyRequest & AuthRequest,
  ) {
    await this.appDb.tx(tenantCtx(req), async (tx) => {
      const existing = await tx.service.findFirst({ where: { id, deletedAt: null } });
      if (!existing) throw new NotFoundException();
      await tx.service.update({
        where: { id },
        data: { deletedAt: new Date(), isActive: false },
      });
    });
  }
}
