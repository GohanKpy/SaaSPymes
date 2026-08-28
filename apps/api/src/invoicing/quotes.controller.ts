import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  quoteCreate,
  quoteListQuery,
  quoteUpdate,
  uuid,
  type QuoteCreate,
  type QuoteListQuery,
  type QuoteUpdate,
} from '@pymes/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { RequireFeature, type AuthRequest } from '../auth/decorators';
import { tenantCtx } from '../common/tenant-ctx';
import { ZodPipe } from '../common/zod.pipe';
import { QuotesService } from './quotes.service';

/** Presupuestos formales (P1): quote → factura. */
@Controller('quotes')
@RequireFeature('invoicing')
export class QuotesController {
  constructor(private readonly quotes: QuotesService) {}

  @Get()
  list(@Query(new ZodPipe(quoteListQuery)) query: QuoteListQuery, @Req() req: FastifyRequest & AuthRequest) {
    return this.quotes.list(tenantCtx(req), query);
  }

  @Post()
  create(@Body(new ZodPipe(quoteCreate)) dto: QuoteCreate, @Req() req: FastifyRequest & AuthRequest) {
    return this.quotes.create(tenantCtx(req), dto);
  }

  @Get(':id')
  get(@Param('id', new ZodPipe(uuid)) id: string, @Req() req: FastifyRequest & AuthRequest) {
    return this.quotes.get(tenantCtx(req), id);
  }

  @Patch(':id')
  update(
    @Param('id', new ZodPipe(uuid)) id: string,
    @Body(new ZodPipe(quoteUpdate)) dto: QuoteUpdate,
    @Req() req: FastifyRequest & AuthRequest,
  ) {
    return this.quotes.update(tenantCtx(req), id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', new ZodPipe(uuid)) id: string, @Req() req: FastifyRequest & AuthRequest) {
    await this.quotes.remove(tenantCtx(req), id);
  }

  /** Convierte el presupuesto en borrador de factura (circuito fiscal normal). */
  @Post(':id/invoice')
  @HttpCode(201)
  convert(@Param('id', new ZodPipe(uuid)) id: string, @Req() req: FastifyRequest & AuthRequest) {
    return this.quotes.convertToInvoice(tenantCtx(req), id);
  }

  @Get(':id/pdf')
  async pdf(
    @Param('id', new ZodPipe(uuid)) id: string,
    @Req() req: FastifyRequest & AuthRequest,
    @Res() reply: FastifyReply,
  ) {
    const { pdf, filename } = await this.quotes.pdf(tenantCtx(req), id);
    void reply
      .header('content-type', 'application/pdf')
      .header('content-disposition', `inline; filename="${filename}"`)
      .send(pdf);
  }
}
