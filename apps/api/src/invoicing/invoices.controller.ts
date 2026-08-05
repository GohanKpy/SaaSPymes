import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, Res } from '@nestjs/common';
import {
  invoiceCancel,
  invoiceCreate,
  invoiceListQuery,
  paymentCreate,
  uuid,
  type InvoiceCancel,
  type InvoiceCreate,
  type InvoiceListQuery,
  type PaymentCreate,
} from '@pymes/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { RequireFeature, Roles, type AuthRequest } from '../auth/decorators';
import { tenantCtx } from '../common/tenant-ctx';
import { ZodPipe } from '../common/zod.pipe';
import { InvoicesService } from './invoices.service';
import { KudeService } from './kude.service';

@Controller('invoices')
@RequireFeature('invoicing')
export class InvoicesController {
  constructor(
    private readonly invoices: InvoicesService,
    private readonly kude: KudeService,
  ) {}

  /** KuDE en PDF de una factura emitida (doc 04 §3.9). */
  @Get(':id/kude')
  async kudePdf(
    @Param('id', new ZodPipe(uuid)) id: string,
    @Req() req: FastifyRequest & AuthRequest,
    @Res() reply: FastifyReply,
  ) {
    const { pdf, filename } = await this.kude.render(tenantCtx(req), id);
    void reply
      .header('content-type', 'application/pdf')
      .header('content-disposition', `inline; filename="${filename}"`)
      .send(pdf);
  }

  @Get()
  list(
    @Query(new ZodPipe(invoiceListQuery)) query: InvoiceListQuery,
    @Req() req: FastifyRequest & AuthRequest,
  ) {
    return this.invoices.list(tenantCtx(req), query);
  }

  @Post()
  create(
    @Body(new ZodPipe(invoiceCreate)) dto: InvoiceCreate,
    @Req() req: FastifyRequest & AuthRequest,
  ) {
    return this.invoices.createDraft(tenantCtx(req), dto);
  }

  @Get(':id')
  get(@Param('id', new ZodPipe(uuid)) id: string, @Req() req: FastifyRequest & AuthRequest) {
    return this.invoices.get(tenantCtx(req), id);
  }

  /** 202: la emision es asincronica por contrato (doc 04 §3.9); el provider
   *  fake resuelve al instante y el estado final llega igual por SSE. */
  @Post(':id/issue')
  @HttpCode(202)
  issue(@Param('id', new ZodPipe(uuid)) id: string, @Req() req: FastifyRequest & AuthRequest) {
    return this.invoices.issue(tenantCtx(req), id);
  }

  /** Anular: solo root y admin, con motivo obligatorio (doc 04 §2). */
  @Post(':id/cancel')
  @Roles('root', 'admin')
  @HttpCode(202)
  cancel(
    @Param('id', new ZodPipe(uuid)) id: string,
    @Body(new ZodPipe(invoiceCancel)) dto: InvoiceCancel,
    @Req() req: FastifyRequest & AuthRequest,
  ) {
    return this.invoices.cancel(tenantCtx(req), id, dto);
  }

  @Post(':id/payments')
  @RequireFeature('payments')
  create_payment(
    @Param('id', new ZodPipe(uuid)) id: string,
    @Body(new ZodPipe(paymentCreate)) dto: PaymentCreate,
    @Req() req: FastifyRequest & AuthRequest,
  ) {
    return this.invoices.addPayment(tenantCtx(req), id, dto);
  }
}
