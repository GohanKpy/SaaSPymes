import { Controller, Get, Param } from '@nestjs/common';
import { rucParam } from '@pymes/shared';

import { ZodPipe } from '../common/zod.pipe';
import { RucPadronService } from '../platform/ruc-padron.service';

/**
 * Consulta del padron RUC de la DNIT (ADR 0012) para cualquier usuario
 * autenticado del tenant: al tipear un RUC en clientes o facturas, el panel
 * completa razon social y DV. Dato publico: no lleva feature ni tenant.
 */
@Controller('ruc')
export class RucController {
  constructor(private readonly padron: RucPadronService) {}

  @Get(':ruc')
  lookup(@Param('ruc', new ZodPipe(rucParam)) ruc: string) {
    return this.padron.lookup(ruc);
  }
}
