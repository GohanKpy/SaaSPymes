import { randomBytes } from 'node:crypto';

import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { hash } from '@node-rs/argon2';
import { userCreate, userUpdate, uuid, type UserCreate, type UserUpdate } from '@pymes/shared';
import type { FastifyRequest } from 'fastify';

import { Roles, type AuthRequest } from '../auth/decorators';
import { tenantCtx } from '../common/tenant-ctx';
import { ZodPipe } from '../common/zod.pipe';
import { ARGON2_OPTIONS } from '../platform/tenants.service';
import { AppPrisma } from '../prisma/app-prisma.service';

const SAFE_USER = {
  id: true,
  email: true,
  fullName: true,
  role: true,
  isActive: true,
  lastLoginAt: true,
  createdAt: true,
  branchAccess: { select: { branchId: true } },
} as const;

@Controller('users')
@Roles('root', 'admin')
export class UsersController {
  constructor(private readonly appDb: AppPrisma) {}

  @Get()
  list(@Req() req: FastifyRequest & AuthRequest) {
    return this.appDb.tx(tenantCtx(req), (tx) =>
      tx.user.findMany({ where: { deletedAt: null }, select: SAFE_USER, orderBy: { createdAt: 'asc' } }),
    );
  }

  /**
   * Alta directa con password temporal devuelta una sola vez.
   * (La invitacion por email llega cuando el SMTP del tenant este operativo.)
   */
  @Post()
  async create(@Body(new ZodPipe(userCreate)) dto: UserCreate, @Req() req: FastifyRequest & AuthRequest) {
    const ctx = tenantCtx(req);
    const tempPassword = randomBytes(9).toString('base64url');
    const passwordHash = await hash(tempPassword, ARGON2_OPTIONS);
    const user = await this.appDb.tx(ctx, async (tx) => {
      const created = await tx.user.create({
        data: {
          tenantId: ctx.tenantId,
          email: dto.email,
          passwordHash,
          fullName: dto.full_name,
          role: dto.role,
        },
        select: SAFE_USER,
      });
      if (dto.branch_ids.length > 0) {
        await tx.userBranchAccess.createMany({
          data: dto.branch_ids.map((branchId) => ({
            tenantId: ctx.tenantId,
            userId: created.id,
            branchId,
          })),
        });
      }
      return created;
    });
    return { ...user, temp_password: tempPassword };
  }

  @Patch(':id')
  async patch(
    @Param('id', new ZodPipe(uuid)) id: string,
    @Body(new ZodPipe(userUpdate)) dto: UserUpdate,
    @Req() req: FastifyRequest & AuthRequest,
  ) {
    const ctx = tenantCtx(req);
    return this.appDb.tx(ctx, async (tx) => {
      const existing = await tx.user.findFirst({ where: { id, deletedAt: null } });
      if (!existing) throw new NotFoundException();
      // admin no puede tocar usuarios root (doc 04 §2)
      if (existing.role === 'root' && req.authUser?.role !== 'root') throw new ForbiddenException();
      const updated = await tx.user.update({
        where: { id },
        data: { fullName: dto.full_name, role: dto.role, isActive: dto.is_active },
        select: SAFE_USER,
      });
      if (dto.branch_ids) {
        await tx.userBranchAccess.deleteMany({ where: { userId: id } });
        if (dto.branch_ids.length > 0) {
          await tx.userBranchAccess.createMany({
            data: dto.branch_ids.map((branchId) => ({ tenantId: ctx.tenantId, userId: id, branchId })),
          });
        }
      }
      return updated;
    });
  }

  /**
   * Reinicio de contrasena por el dueño/admin del negocio: temporal devuelta
   * una sola vez y sesiones del usuario revocadas. Un admin no puede tocar
   * al root (misma regla que patch, doc 04 §2).
   */
  @Post(':id/reset-password')
  async resetPassword(
    @Param('id', new ZodPipe(uuid)) id: string,
    @Req() req: FastifyRequest & AuthRequest,
  ) {
    const ctx = tenantCtx(req);
    const tempPassword = randomBytes(9).toString('base64url');
    const passwordHash = await hash(tempPassword, ARGON2_OPTIONS);
    const email = await this.appDb.tx(ctx, async (tx) => {
      const existing = await tx.user.findFirst({ where: { id, deletedAt: null } });
      if (!existing) throw new NotFoundException();
      if (existing.role === 'root' && req.authUser?.role !== 'root') throw new ForbiddenException();
      await tx.user.update({ where: { id }, data: { passwordHash } });
      await tx.refreshToken.updateMany({
        where: { userId: id, userScope: 'tenant', revokedAt: null },
        data: { revokedAt: new Date() },
      });
      return existing.email;
    });
    return { email, temp_password: tempPassword };
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', new ZodPipe(uuid)) id: string, @Req() req: FastifyRequest & AuthRequest) {
    const ctx = tenantCtx(req);
    await this.appDb.tx(ctx, async (tx) => {
      const existing = await tx.user.findFirst({ where: { id, deletedAt: null } });
      if (!existing) throw new NotFoundException();
      if (existing.role === 'root') {
        throw new ForbiddenException({ title: 'El usuario root no se elimina' });
      }
      await tx.user.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
    });
  }
}
