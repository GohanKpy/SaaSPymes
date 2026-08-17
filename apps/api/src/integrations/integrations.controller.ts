import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  sifenIntegrationPut,
  smtpIntegrationPut,
  whatsappIntegrationPut,
  type IntegrationStatus,
  type SifenIntegrationPut,
  type SmtpIntegrationPut,
  type WhatsappIntegrationPut,
} from '@pymes/shared';
import type { Env } from '@pymes/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { Prisma } from '@pymes/db';

import { Public, Roles, type AuthRequest } from '../auth/decorators';
import { CryptoService } from '../common/crypto.service';
import { tenantCtx } from '../common/tenant-ctx';
import { ZodPipe } from '../common/zod.pipe';
import { ENV } from '../env.module';
import { AppPrisma } from '../prisma/app-prisma.service';
import { GoogleCalendarService } from './google-calendar.service';

const typeParam = z.enum(['whatsapp', 'smtp', 'sifen', 'google_calendar', 'payment']);

// Google agrega parametros propios al callback: sin strict.
const googleCallbackQuery = z.object({
  code: z.string().max(1000).optional(),
  state: z.string().max(2000),
  error: z.string().max(200).optional(),
});

const googleConnectBody = z.object({ employee_id: z.uuid().optional() }).strict();

/**
 * Integraciones del tenant: SOLO root (doc 04 §3.3, regla de negocio central).
 * La API jamas devuelve secretos, ni siquiera enmascarados; lo secreto vive
 * cifrado en integration_credentials.encrypted_payload (doc 05 §4.2).
 * El trigger de auditoria de la tabla registra cada cambio sin el payload.
 */
@Controller('integrations')
@Roles('root')
export class IntegrationsController {
  constructor(
    private readonly appDb: AppPrisma,
    private readonly crypto: CryptoService,
    private readonly google: GoogleCalendarService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Origen del panel validado contra la misma lista del CORS: el callback
   *  de OAuth redirige ahi y un origen arbitrario seria un open redirect. */
  private panelOrigin(origin: string | undefined): string {
    const allowed = this.env.WEB_ORIGIN.split(',').map((o) => o.trim());
    const dev = /^https?:\/\/[^/]+:430[08]$/;
    if (origin && (allowed.includes(origin) || (this.env.NODE_ENV !== 'production' && dev.test(origin)))) {
      return origin;
    }
    return allowed[0] ?? 'http://localhost:4300';
  }

  /** Arranque del flujo OAuth de Google Calendar (ADR 0007): solo root.
   *  Con employee_id (fase 3) la conexion queda a nombre de ese empleado:
   *  el root puede abrir el link el mismo o pasarselo al empleado. */
  @Post('google/connect')
  async googleConnect(
    @Body(new ZodPipe(googleConnectBody)) dto: { employee_id?: string },
    @Req() req: FastifyRequest & AuthRequest,
  ) {
    const ctx = tenantCtx(req);
    const origin = this.panelOrigin(req.headers.origin);
    if (dto.employee_id) {
      const employee = await this.appDb.tx(ctx, (tx) =>
        tx.employee.findFirst({ where: { id: dto.employee_id, deletedAt: null } }),
      );
      if (!employee) {
        throw new UnprocessableEntityException({ title: 'El empleado no existe' });
      }
    }
    try {
      const url = await this.google.authUrl(
        ctx.tenantId,
        ctx.userId ?? '',
        origin,
        dto.employee_id ?? null,
      );
      return { auth_url: url };
    } catch (error) {
      if (error instanceof Error && error.message === 'google_oauth_not_configured') {
        throw new UnprocessableEntityException({
          title: 'La plataforma aun no tiene configurada la app de Google (avisale al administrador del sistema)',
        });
      }
      throw error;
    }
  }

  /** Desconecta el Google Calendar propio de un empleado (fase 3). */
  @Delete('google/employee/:employeeId')
  @HttpCode(204)
  async googleDisconnectEmployee(
    @Param('employeeId', new ZodPipe(z.uuid())) employeeId: string,
    @Req() req: FastifyRequest & AuthRequest,
  ) {
    await this.appDb.tx(tenantCtx(req), (tx) =>
      tx.integrationCredential.deleteMany({ where: { type: 'google_calendar', employeeId } }),
    );
  }

  /** Retorno de Google: publico (viene del navegador del cliente, sin JWT);
   *  la identidad viaja cifrada en el state que emitio /google/connect. */
  @Get('google/callback')
  @Public()
  async googleCallback(
    @Query(new ZodPipe(googleCallbackQuery)) q: { code?: string; state: string; error?: string },
    @Res() reply: FastifyReply,
  ) {
    let origin = this.panelOrigin(undefined);
    try {
      if (q.error || !q.code) throw new Error(q.error ?? 'sin code');
      const result = await this.google.connect(q.state, q.code);
      origin = this.panelOrigin(result.origin);
      // path viene del state cifrado que emitimos nosotros (/app/settings o
      // /app/employees), jamas del navegador.
      await reply.redirect(`${origin}${result.path}?google=connected`, 302);
    } catch {
      await reply.redirect(`${origin}/app/settings?google=error`, 302);
    }
  }

  @Get()
  async list(@Req() req: FastifyRequest & AuthRequest): Promise<IntegrationStatus[]> {
    // Solo credenciales del negocio: las conexiones por empleado (fase 3)
    // se ven en la seccion Empleados, no en Ajustes.
    const rows = await this.appDb.tx(tenantCtx(req), (tx) =>
      tx.integrationCredential.findMany({
        where: { employeeId: null },
        select: { type: true, isActive: true, publicConfig: true },
      }),
    );
    const configured = new Map(rows.map((r) => [r.type, r]));
    return (['whatsapp', 'smtp', 'sifen', 'google_calendar', 'payment'] as const).map((type) => ({
      type,
      configured: configured.has(type),
      is_active: configured.get(type)?.isActive ?? false,
      public_config: (configured.get(type)?.publicConfig ?? {}) as Record<string, unknown>,
    }));
  }

  @Put('whatsapp')
  putWhatsapp(
    @Body(new ZodPipe(whatsappIntegrationPut)) dto: WhatsappIntegrationPut,
    @Req() req: FastifyRequest & AuthRequest,
  ) {
    return this.upsert(req, 'whatsapp', {
      publicConfig: { phone_number_id: dto.phone_number_id, live: dto.live },
      secret: { access_token: dto.access_token, verify_token: dto.verify_token },
    });
  }

  @Put('smtp')
  putSmtp(
    @Body(new ZodPipe(smtpIntegrationPut)) dto: SmtpIntegrationPut,
    @Req() req: FastifyRequest & AuthRequest,
  ) {
    return this.upsert(req, 'smtp', {
      publicConfig: {
        host: dto.host,
        port: dto.port,
        username: dto.username,
        from_email: dto.from_email,
      },
      secret: { password: dto.password },
    });
  }

  @Put('sifen')
  putSifen(
    @Body(new ZodPipe(sifenIntegrationPut)) dto: SifenIntegrationPut,
    @Req() req: FastifyRequest & AuthRequest,
  ) {
    return this.upsert(req, 'sifen', {
      publicConfig: {
        timbrado: dto.timbrado,
        establishment: dto.establishment,
        expedition_point: dto.expedition_point,
        vigencia_desde: dto.vigencia_desde ?? null,
      },
      secret: { cert_passphrase: dto.cert_passphrase ?? null },
    });
  }

  @Delete(':type')
  @HttpCode(204)
  async remove(
    @Param('type', new ZodPipe(typeParam)) type: string,
    @Req() req: FastifyRequest & AuthRequest,
  ) {
    // Desactiva y purga credenciales (doc 04 §3.3). Solo la del negocio:
    // las conexiones por empleado tienen su propio DELETE.
    await this.appDb.tx(tenantCtx(req), (tx) =>
      tx.integrationCredential.deleteMany({ where: { type, employeeId: null } }),
    );
  }

  private async upsert(
    req: FastifyRequest & AuthRequest,
    type: string,
    data: { publicConfig: Record<string, unknown>; secret: unknown },
  ): Promise<IntegrationStatus> {
    const ctx = tenantCtx(req);
    const encryptedPayload = this.crypto.encryptJson(data.secret);
    // La unicidad (tenant, type, employee) es NULLS NOT DISTINCT (fase 3):
    // para la credencial del negocio (employee_id null) el upsert es manual.
    const row = await this.appDb.tx(ctx, async (tx) => {
      const existing = await tx.integrationCredential.findFirst({
        where: { type, employeeId: null },
      });
      if (existing) {
        return tx.integrationCredential.update({
          where: { id: existing.id },
          data: {
            encryptedPayload,
            publicConfig: data.publicConfig as Prisma.InputJsonValue,
            isActive: true,
            updatedBy: ctx.userId ?? ctx.tenantId,
          },
        });
      }
      return tx.integrationCredential.create({
        data: {
          tenantId: ctx.tenantId,
          type,
          encryptedPayload,
          publicConfig: data.publicConfig as Prisma.InputJsonValue,
          updatedBy: ctx.userId ?? ctx.tenantId,
        },
      });
    });
    return {
      type: type as IntegrationStatus['type'],
      configured: true,
      is_active: row.isActive,
      public_config: row.publicConfig as Record<string, unknown>,
    };
  }
}
