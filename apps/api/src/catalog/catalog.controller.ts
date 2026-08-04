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
        data: { tenantId: ctx.tenantId, name: dto.name, sortOrder: dto.sort_order },
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
        data: { name: dto.name, sortOrder: dto.sort_order },
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
    return this.appDb.tx(ctx, (tx) =>
      tx.service.create({
        data: {
          tenantId: ctx.tenantId,
          categoryId: dto.category_id,
          name: dto.name,
          description: dto.description,
          price: dto.price,
          currency: dto.currency,
          taxRate: dto.tax_rate,
          durationMin: dto.duration_min,
          bookableByBot: dto.bookable_by_bot,
          isActive: dto.is_active,
        },
      }),
    );
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
      return tx.service.update({
        where: { id },
        data: {
          categoryId: dto.category_id,
          name: dto.name,
          description: dto.description,
          price: dto.price,
          currency: dto.currency,
          taxRate: dto.tax_rate,
          durationMin: dto.duration_min,
          bookableByBot: dto.bookable_by_bot,
          isActive: dto.is_active,
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
