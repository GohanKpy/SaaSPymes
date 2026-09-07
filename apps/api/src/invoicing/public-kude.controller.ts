import { Controller, Get, NotFoundException, Query, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';

import { Public } from '../auth/decorators';
import { NotifierService } from '../notifications/notifier.service';
import { KudeService } from './kude.service';

/**
 * Comprobante publico por link firmado (2026-09-07): lo que recibe el
 * cliente por WhatsApp cuando se le envia la factura. El token es un JSON
 * cifrado (tenant, factura, vencimiento): no expone ids ni acepta otros.
 * Invalido o vencido = 404 opaco.
 */
@Controller('public')
export class PublicKudeController {
  constructor(
    private readonly kude: KudeService,
    private readonly notifier: NotifierService,
  ) {}

  /** El token va por query (?t=): como parametro de ruta superaba el largo maximo de Fastify. */
  @Get('kude')
  @Public()
  async download(@Query('t') token: string | undefined, @Res() reply: FastifyReply) {
    const abierto = token ? this.notifier.openKudeToken(token) : null;
    if (!abierto) throw new NotFoundException();
    const { pdf, filename } = await this.kude.render(
      { tenantId: abierto.tenantId, actorType: 'system' },
      abierto.invoiceId,
      { requirePayment: false },
    );
    void reply
      .header('content-type', 'application/pdf')
      .header('content-disposition', `inline; filename="${filename}"`)
      .header('cache-control', 'private, no-store')
      .send(pdf);
  }
}
