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
  Put,
  Query,
  Req,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  EMPLOYEE_REQUIRABLE_FIELDS,
  absenceCreate,
  employeeCreate,
  employeeFormSettingsPut,
  employeeRemoveQuery,
  employeeUpdate,
  uuid,
  type AbsenceCreate,
  type EmployeeCreate,
  type EmployeeFormSettingsPut,
  type EmployeeRemoveQuery,
  type EmployeeRequirableField,
  type EmployeeUpdate,
} from '@pymes/shared';
import type { FastifyRequest } from 'fastify';

import { Prisma, type Employee, type TenantTx } from '@pymes/db';

import { Roles, type AuthRequest } from '../auth/decorators';
import { tenantCtx } from '../common/tenant-ctx';
import { ZodPipe } from '../common/zod.pipe';
import { AppPrisma } from '../prisma/app-prisma.service';

import { AbsencesService } from './absences.service';

const vacio = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

/**
 * Empleados del tenant (ADR 0009): ficha de RRHH. Lectura para todo el
 * equipo del panel; escritura solo root/admin. El salario es el unico campo
 * sensible: el rol staff no lo recibe. Los campos obligatorios de la planilla
 * los define el admin de cada tenant (employee_form_settings) y se validan
 * server-side ademas del asterisco en el formulario.
 */
@Controller('employees')
export class EmployeesController {
  constructor(
    private readonly appDb: AppPrisma,
    private readonly absences: AbsencesService,
  ) {}

  @Get()
  async list(@Req() req: FastifyRequest & AuthRequest) {
    const ctx = tenantCtx(req);
    const hoy = new Date(new Date().toISOString().slice(0, 10));
    const { rows, google, absences } = await this.appDb.tx(ctx, async (tx) => ({
      rows: await tx.employee.findMany({
        where: { deletedAt: null },
        orderBy: [{ isActive: 'desc' }, { firstName: 'asc' }],
      }),
      // Estado de la conexion Google propia de cada empleado (fase 3).
      google: await tx.integrationCredential.findMany({
        where: { type: 'google_calendar', employeeId: { not: null } },
        select: { employeeId: true, publicConfig: true },
      }),
      // Ausencias vigentes o futuras (2026-09-08), para el badge y el modal.
      absences: await tx.employeeAbsence.findMany({
        where: { OR: [{ endsOn: null }, { endsOn: { gte: hoy } }] },
        orderBy: { startsOn: 'asc' },
      }),
    }));
    const googleStatus = new Map(
      google.map((g) => [
        g.employeeId,
        ((g.publicConfig as { status?: string }).status ?? 'connected') as string,
      ]),
    );
    const verSalario = ['root', 'admin'].includes(req.authUser?.role ?? '');
    return rows.map((e) => ({
      ...e,
      salary: verSalario ? e.salary : null,
      googleCalendar: googleStatus.get(e.id) ?? null,
      absences: absences.filter((a) => a.employeeId === e.id),
    }));
  }

  /** Ausencias vigentes o futuras del empleado (2026-09-08). */
  @Get(':id/absences')
  listAbsences(@Param('id', new ZodPipe(uuid)) id: string, @Req() req: FastifyRequest & AuthRequest) {
    return this.absences.list(tenantCtx(req), id);
  }

  /**
   * Registra una ausencia. Con turnos en el periodo responde 409 con
   * `conflicts` salvo que venga on_conflict=notify (avisar a los clientes)
   * o keep (registrar sin avisar).
   */
  @Post(':id/absences')
  @Roles('root', 'admin')
  createAbsence(
    @Param('id', new ZodPipe(uuid)) id: string,
    @Body(new ZodPipe(absenceCreate)) dto: AbsenceCreate,
    @Req() req: FastifyRequest & AuthRequest,
  ) {
    return this.absences.create(tenantCtx(req), id, dto);
  }

  @Delete(':id/absences/:absenceId')
  @Roles('root', 'admin')
  @HttpCode(204)
  async removeAbsence(
    @Param('id', new ZodPipe(uuid)) id: string,
    @Param('absenceId', new ZodPipe(uuid)) absenceId: string,
    @Req() req: FastifyRequest & AuthRequest,
  ) {
    await this.absences.remove(tenantCtx(req), id, absenceId);
  }

  /** Campos obligatorios de la planilla en ESTE tenant (para pintar los *). */
  @Get('form-settings')
  async getFormSettings(@Req() req: FastifyRequest & AuthRequest) {
    const row = await this.appDb.tx(tenantCtx(req), (tx) => tx.employeeFormSettings.findFirst());
    return { required_fields: row?.requiredFields ?? [] };
  }

  /** El admin del tenant define que campos son obligatorios en su empresa. */
  @Put('form-settings')
  @Roles('root', 'admin')
  async putFormSettings(
    @Body(new ZodPipe(employeeFormSettingsPut)) dto: EmployeeFormSettingsPut,
    @Req() req: FastifyRequest & AuthRequest,
  ) {
    const ctx = tenantCtx(req);
    const requiredFields = [...new Set(dto.required_fields)];
    const row = await this.appDb.tx(ctx, (tx) =>
      tx.employeeFormSettings.upsert({
        where: { tenantId: ctx.tenantId },
        create: { tenantId: ctx.tenantId, requiredFields, updatedBy: ctx.userId ?? null },
        update: { requiredFields, updatedBy: ctx.userId ?? null, updatedAt: new Date() },
      }),
    );
    return { required_fields: row.requiredFields };
  }

  @Post()
  @Roles('root', 'admin')
  create(
    @Body(new ZodPipe(employeeCreate)) dto: EmployeeCreate,
    @Req() req: FastifyRequest & AuthRequest,
  ) {
    const ctx = tenantCtx(req);
    return this.appDb.tx(ctx, async (tx) => {
      await this.checkRequired(tx, dto, null);
      return tx.employee.create({
        data: {
          ...this.toData(dto),
          tenantId: ctx.tenantId,
          firstName: dto.first_name,
          lastName: dto.last_name,
        },
      });
    });
  }

  @Patch(':id')
  @Roles('root', 'admin')
  async update(
    @Param('id', new ZodPipe(uuid)) id: string,
    @Body(new ZodPipe(employeeUpdate)) dto: EmployeeUpdate,
    @Req() req: FastifyRequest & AuthRequest,
  ) {
    const ctx = tenantCtx(req);
    const { on_conflict, ...cambios } = dto;
    // Deja de trabajar (2026-09-08): sus turnos futuros pasan por el mismo
    // flujo que una ausencia (409 con la lista, avisar o mantener).
    if (cambios.is_active === false) {
      const actual = await this.appDb.tx(ctx, (tx) => tx.employee.findFirst({ where: { id, deletedAt: null }, select: { isActive: true } }));
      if (!actual) throw new NotFoundException();
      if (actual.isActive) await this.absences.alDarDeBaja(ctx, id, on_conflict ?? 'abort');
    }
    return this.appDb.tx(ctx, async (tx) => {
      const existing = await tx.employee.findFirst({ where: { id, deletedAt: null } });
      if (!existing) throw new NotFoundException();
      await this.checkRequired(tx, cambios, existing);
      return tx.employee.update({
        where: { id },
        data: { ...this.toData(cambios), updatedAt: new Date() },
      });
    });
  }

  @Delete(':id')
  @Roles('root', 'admin')
  @HttpCode(204)
  async remove(
    @Param('id', new ZodPipe(uuid)) id: string,
    @Query(new ZodPipe(employeeRemoveQuery)) query: EmployeeRemoveQuery,
    @Req() req: FastifyRequest & AuthRequest,
  ) {
    const ctx = tenantCtx(req);
    // Se retira (2026-09-08): con turnos futuros, 409 con la lista salvo
    // on_conflict=notify (avisar a los clientes) o keep.
    await this.absences.alDarDeBaja(ctx, id, query.on_conflict);
    // Borrado logico: el historial de turnos asignados se conserva.
    await this.appDb.tx(ctx, (tx) =>
      tx.employee.updateMany({
        where: { id, deletedAt: null },
        data: { deletedAt: new Date(), isActive: false, bookable: false },
      }),
    );
  }

  /**
   * Valida los campos obligatorios definidos por el tenant.
   * Alta (existing = null): todos los obligatorios deben venir con valor.
   * Edicion: no se puede vaciar un obligatorio, pero un campo ausente en el
   * PATCH no bloquea (fichas viejas incompletas siguen editables en lo demas,
   * p. ej. guardar solo el horario).
   */
  private async checkRequired(
    tx: TenantTx,
    dto: EmployeeCreate | EmployeeUpdate,
    existing: Employee | null,
  ): Promise<void> {
    const settings = await tx.employeeFormSettings.findFirst();
    const required = (settings?.requiredFields ?? []) as EmployeeRequirableField[];
    if (required.length === 0) return;

    const body = dto as Record<string, unknown>;
    const faltan = required.filter((field) => {
      if (!EMPLOYEE_REQUIRABLE_FIELDS.includes(field)) return false; // config vieja con clave desconocida
      const enviado = body[field];
      if (existing === null) return vacio(enviado);
      if (enviado === undefined) return false; // no vino en el PATCH: queda como estaba
      return vacio(enviado);
    });
    if (faltan.length > 0) {
      throw new UnprocessableEntityException({
        title: 'Faltan campos obligatorios de la planilla de tu empresa',
        errors: Object.fromEntries(faltan.map((f) => [f, ['obligatorio']])),
      });
    }
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
      emergencyContactName: dto.emergency_contact_name,
      emergencyContactPhone: dto.emergency_contact_phone,
      emergencyContactRelation: dto.emergency_contact_relation,
      maritalStatus: dto.marital_status,
      childrenCount: dto.children_count,
      salary: dto.salary,
      notes: dto.notes,
      bookable: dto.bookable,
      isActive: dto.is_active,
      // Horario propio (fase 3): null explicito = volver al de la sucursal.
      schedule:
        dto.schedule === undefined
          ? undefined
          : ((dto.schedule as Prisma.InputJsonValue | null) ?? Prisma.DbNull),
    };
  }
}
