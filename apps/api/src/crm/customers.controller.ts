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
} from '@nestjs/common';
import {
  customerCreate,
  customerListQuery,
  customerUpdate,
  uuid,
  type CustomerCreate,
  type CustomerListQuery,
  type CustomerUpdate,
} from '@pymes/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';

import { RequireFeature, type AuthRequest } from '../auth/decorators';
import { tenantCtx } from '../common/tenant-ctx';
import { ZodPipe } from '../common/zod.pipe';
import { CustomersService } from './customers.service';

const mergeBody = z.object({ source_id: uuid }).strict();

@Controller('customers')
@RequireFeature('crm')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  list(
    @Query(new ZodPipe(customerListQuery)) query: CustomerListQuery,
    @Req() req: FastifyRequest & AuthRequest,
  ) {
    return this.customers.list(tenantCtx(req), query);
  }

  @Post()
  create(
    @Body(new ZodPipe(customerCreate)) dto: CustomerCreate,
    @Req() req: FastifyRequest & AuthRequest,
  ) {
    return this.customers.create(tenantCtx(req), dto);
  }

  @Get(':id')
  get(@Param('id', new ZodPipe(uuid)) id: string, @Req() req: FastifyRequest & AuthRequest) {
    return this.customers.get(tenantCtx(req), id);
  }

  @Patch(':id')
  update(
    @Param('id', new ZodPipe(uuid)) id: string,
    @Body(new ZodPipe(customerUpdate)) dto: CustomerUpdate,
    @Req() req: FastifyRequest & AuthRequest,
  ) {
    return this.customers.update(tenantCtx(req), id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', new ZodPipe(uuid)) id: string, @Req() req: FastifyRequest & AuthRequest) {
    return this.customers.remove(tenantCtx(req), id);
  }

  @Get(':id/history')
  history(@Param('id', new ZodPipe(uuid)) id: string, @Req() req: FastifyRequest & AuthRequest) {
    return this.customers.history(tenantCtx(req), id);
  }

  @Post(':id/merge')
  merge(
    @Param('id', new ZodPipe(uuid)) id: string,
    @Body(new ZodPipe(mergeBody)) body: { source_id: string },
    @Req() req: FastifyRequest & AuthRequest,
  ) {
    return this.customers.merge(tenantCtx(req), id, body.source_id);
  }
}
