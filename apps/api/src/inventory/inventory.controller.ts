import { Body, Controller, Get, Post, Query, Req } from '@nestjs/common';
import {
  movementsQuery,
  stockAdjustment,
  stockEntry,
  stockQuery,
  stockTransfer,
  type MovementsQuery,
  type StockAdjustment,
  type StockEntry,
  type StockQuery,
  type StockTransfer,
} from '@pymes/shared';
import type { FastifyRequest } from 'fastify';

import { Roles, type AuthRequest } from '../auth/decorators';
import { tenantCtx } from '../common/tenant-ctx';
import { ZodPipe } from '../common/zod.pipe';

import { InventoryService } from './inventory.service';

/** Inventario (2026-09-14, ADR 0013): existencias, kardex, ingresos, ajustes y traslados. */
@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get('stock')
  stock(@Query(new ZodPipe(stockQuery)) query: StockQuery, @Req() req: FastifyRequest & AuthRequest) {
    return this.inventory.stock(tenantCtx(req), query);
  }

  @Get('movements')
  movements(@Query(new ZodPipe(movementsQuery)) query: MovementsQuery, @Req() req: FastifyRequest & AuthRequest) {
    return this.inventory.movimientos(tenantCtx(req), query);
  }

  @Post('entries')
  @Roles('root', 'admin')
  entry(@Body(new ZodPipe(stockEntry)) dto: StockEntry, @Req() req: FastifyRequest & AuthRequest) {
    return this.inventory.ingresar(tenantCtx(req), dto);
  }

  @Post('adjustments')
  @Roles('root', 'admin')
  adjustment(@Body(new ZodPipe(stockAdjustment)) dto: StockAdjustment, @Req() req: FastifyRequest & AuthRequest) {
    return this.inventory.ajustar(tenantCtx(req), dto);
  }

  @Post('transfers')
  @Roles('root', 'admin')
  transfer(@Body(new ZodPipe(stockTransfer)) dto: StockTransfer, @Req() req: FastifyRequest & AuthRequest) {
    return this.inventory.transferir(tenantCtx(req), dto);
  }
}
