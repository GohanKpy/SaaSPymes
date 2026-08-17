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
  Req,
} from '@nestjs/common';
import {
  employeeCreate,
  employeeUpdate,
  uuid,
  type EmployeeCreate,
  type EmployeeUpdate,
} from '@pymes/shared';
import type { FastifyRequest } from 'fastify';

import { Roles, type AuthRequest } from '../auth/decorators';
import { tenantCtx } from '../common/tenant-ctx';
import { ZodPipe } from '../common/zod.pipe';
import { AppPrisma } from '../prisma/app-prisma.service';

/**
 * Empleados del tenant (ADR 0009): ficha de RRHH. Lectura para todo el
 * equipo del panel; escritura solo root/admin. El salario es el unico campo
 * sensible: el rol staff no lo recibe.
 */
@Controller('employees')
export class EmployeesController {
  constructor(private readonly appDb: AppPrisma) {}

  @Get()
  async list(@Req() req: FastifyRequest & AuthRequest) {
    const ctx = tenantCtx(req);
    const rows = await this.appDb.tx(ctx, (tx) =>
      tx.employee.findMany({
        where: { deletedAt: null },
        orderBy: [{ isActive: 'desc' }, { firstName: 'asc' }],
      }),
    );
    const verSalario = ['root', 'admin'].includes(req.authUser?.role ?? '');
    return rows.map((e) => ({ ...e, salary: verSalario ? e.salary : null }));
  }

  @Post()
  @Roles('root', 'admin')
  create(
    @Body(new ZodPipe(employeeCreate)) dto: EmployeeCreate,
    @Req() req: FastifyRequest & AuthRequest,
  ) {
    const ctx = tenantCtx(req);
    return this.appDb.tx(ctx, (tx) =>
      tx.employee.create({
        data: {
          ...this.toData(dto),
          tenantId: ctx.tenantId,
          firstName: dto.first_name,
          lastName: dto.last_name,
        },
      }),
    );
  }

  @Patch(':id')
  @Roles('root', 'admin')
  async update(
    @Param('id', new ZodPipe(uuid)) id: string,
    @Body(new ZodPipe(employeeUpdate)) dto: EmployeeUpdate,
    @Req() req: FastifyRequest & AuthRequest,
  ) {
    const ctx = tenantCtx(req);
    return this.appDb.tx(ctx, async (tx) => {
      const existing = await tx.employee.findFirst({ where: { id, deletedAt: null } });
      if (!existing) throw new NotFoundException();
      return tx.employee.update({
        where: { id },
        data: { ...this.toData(dto), updatedAt: new Date() },
      });
    });
  }

  @Delete(':id')
  @Roles('root', 'admin')
  @HttpCode(204)
  async remove(@Param('id', new ZodPipe(uuid)) id: string, @Req() req: FastifyRequest & AuthRequest) {
    const ctx = tenantCtx(req);
    // Borrado logico: el historial de turnos asignados se conserva.
    await this.appDb.tx(ctx, (tx) =>
      tx.employee.updateMany({
        where: { id, deletedAt: null },
        data: { deletedAt: new Date(), isActive: false, bookable: false },
      }),
    );
  }

  /** snake_case del DTO → campos Prisma; fechas YYYY-MM-DD a Date. */
  private toData(dto: EmployeeCreate | EmployeeUpdate) {
    return {
      firstName: dto.first_name,
      lastName: dto.last_name,
      branchId: dto.branch_id,
      ciNumber: dto.ci_number,
      birthDate: dto.birth_date ? new Date(`${dto.birth_date}T00:00:00Z`) : undefined,
      phone: dto.phone,
      email: dto.email,
      address: dto.address,
      position: dto.position,
      hiredAt: dto.hired_at ? new Date(`${dto.hired_at}T00:00:00Z`) : undefined,
      ipsNumber: dto.ips_number,
      emergencyContact: dto.emergency_contact,
      salary: dto.salary,
      notes: dto.notes,
      bookable: dto.bookable,
      isActive: dto.is_active,
    };
  }
}
