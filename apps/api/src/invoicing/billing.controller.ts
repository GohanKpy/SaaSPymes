import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import {
  accountInvoice,
  accountNotify,
  chargeCreate,
  uuid,
  type AccountInvoice,
  type AccountNotify,
  type ChargeCreate,
} from '@pymes/shared';
import type { FastifyRequest } from 'fastify';

import { RequireFeature, Roles, type AuthRequest } from '../auth/decorators';
import { tenantCtx } from '../common/tenant-ctx';
import { ZodPipe } from '../common/zod.pipe';
import { BillingService } from './billing.service';

/** Cuenta mensual (2026-09-07): consumos pendientes, facturar el mes, enviar. */
@Controller()
@RequireFeature('invoicing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get('billing/accounts')
  accounts(@Req() req: FastifyRequest & AuthRequest) {
    return this.billing.accounts(tenantCtx(req));
  }

  @Get('billing/statements')
  statements(@Req() req: FastifyRequest & AuthRequest) {
    return this.billing.statements(tenantCtx(req));
  }

  @Get('billing/accounts/:customerId')
  account(@Param('customerId', new ZodPipe(uuid)) customerId: string, @Req() req: FastifyRequest & AuthRequest) {
    return this.billing.account(tenantCtx(req), customerId);
  }

  @Post('billing/accounts/:customerId/invoice')
  invoiceAccount(
    @Param('customerId', new ZodPipe(uuid)) customerId: string,
    @Body(new ZodPipe(accountInvoice)) dto: AccountInvoice,
    @Req() req: FastifyRequest & AuthRequest,
  ) {
    return this.billing.invoiceAccount(tenantCtx(req), customerId, dto);
  }

  @Post('billing/accounts/:customerId/notify')
  notifyAccount(
    @Param('customerId', new ZodPipe(uuid)) customerId: string,
    @Body(new ZodPipe(accountNotify)) dto: AccountNotify,
    @Req() req: FastifyRequest & AuthRequest,
  ) {
    return this.billing.notifyAccount(tenantCtx(req), customerId, dto.until);
  }

  /** Correr el cierre del mes ahora (lo mismo que hace el barrido en la fecha de cierre). */
  @Post('billing/close-month')
  @Roles('root', 'admin')
  closeMonth(@Req() req: FastifyRequest & AuthRequest) {
    return this.billing.closeMonthNow(tenantCtx(req));
  }

  /** Reenviar una factura emitida al cliente por su canal. */
  @Post('invoices/:id/send')
  sendInvoice(@Param('id', new ZodPipe(uuid)) id: string, @Req() req: FastifyRequest & AuthRequest) {
    return this.billing.sendInvoice(tenantCtx(req), id);
  }

  @Post('customers/:id/charges')
  addCharge(
    @Param('id', new ZodPipe(uuid)) customerId: string,
    @Body(new ZodPipe(chargeCreate)) dto: ChargeCreate,
    @Req() req: FastifyRequest & AuthRequest,
  ) {
    return this.billing.addCharge(tenantCtx(req), customerId, dto);
  }

  @Delete('billing/charges/:id')
  @HttpCode(204)
  async voidCharge(@Param('id', new ZodPipe(uuid)) id: string, @Req() req: FastifyRequest & AuthRequest) {
    await this.billing.voidCharge(tenantCtx(req), id);
  }
}
