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
import { branchCreate, branchUpdate, uuid, type BranchCreate, type BranchUpdate } from '@pymes/shared';
import type { FastifyRequest } from 'fastify';

import { Roles, type AuthRequest } from '../auth/decorators';
import { tenantCtx } from '../common/tenant-ctx';
import { ZodPipe } from '../common/zod.pipe';
import { AppPrisma } from '../prisma/app-prisma.service';

@Controller('branches')
export class BranchesController {
  constructor(private readonly appDb: AppPrisma) {}

  @Get()
  list(@Req() req: FastifyRequest & AuthRequest) {
    return this.appDb.tx(tenantCtx(req), (tx) =>
      tx.branch.findMany({ where: { deletedAt: null }, orderBy: { createdAt: 'asc' } }),
    );
  }

  @Post()
  @Roles('root', 'admin')
  create(@Body(new ZodPipe(branchCreate)) dto: BranchCreate, @Req() req: FastifyRequest & AuthRequest) {
    const ctx = tenantCtx(req);
    return this.appDb.tx(ctx, (tx) =>
      tx.branch.create({
        data: { tenantId: ctx.tenantId, name: dto.name, address: dto.address, phone: dto.phone },
      }),
    );
  }

  @Patch(':id')
  @Roles('root', 'admin')
  async patch(
    @Param('id', new ZodPipe(uuid)) id: string,
    @Body(new ZodPipe(branchUpdate)) dto: BranchUpdate,
    @Req() req: FastifyRequest & AuthRequest,
  ) {
    const ctx = tenantCtx(req);
    return this.appDb.tx(ctx, async (tx) => {
      const existing = await tx.branch.findFirst({ where: { id, deletedAt: null } });
      if (!existing) throw new NotFoundException();
      return tx.branch.update({ where: { id }, data: dto });
    });
  }

  /** Soft delete; exige no tener turnos futuros (doc 04 §3.2). */
  @Delete(':id')
  @Roles('root', 'admin')
  @HttpCode(204)
  async remove(@Param('id', new ZodPipe(uuid)) id: string, @Req() req: FastifyRequest & AuthRequest) {
    const ctx = tenantCtx(req);
    await this.appDb.tx(ctx, async (tx) => {
      const existing = await tx.branch.findFirst({ where: { id, deletedAt: null } });
      if (!existing) throw new NotFoundException();
      if (existing.isMain) {
        throw new ConflictException({ title: 'La sucursal principal no se elimina' });
      }
      const future = await tx.appointment.count({
        where: { branchId: id, deletedAt: null, startsAt: { gt: new Date() }, status: { in: ['pending', 'confirmed'] } },
      });
      if (future > 0) {
        throw new ConflictException({ title: 'La sucursal tiene turnos futuros' });
      }
      await tx.branch.update({ where: { id }, data: { deletedAt: new Date() } });
    });
  }
}
