import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { TenantContext, TenantTx } from '@pymes/db';
import type { InvoicingProvider } from '@pymes/invoicing';
import type { InvoiceCancel, InvoiceCreate, InvoiceListQuery, PaymentCreate } from '@pymes/shared';

import { AppPrisma } from '../prisma/app-prisma.service';
import { TenantEventsService } from '../conversations/events.service';

export const INVOICING_PROVIDER = 'INVOICING_PROVIDER';

const CANCEL_WINDOW_MS = 48 * 3600 * 1000; // 48 h (doc 04 §3.9)

interface ResolvedItem {
  serviceId?: string;
  description: string;
  quantity: number;
  unitPrice: bigint;
  taxRate: number;
  lineTotal: bigint;
}

/** IVA incluido en el precio (convencion PY): 10% → total/11, 5% → total/21. */
function taxPortion(lineTotal: bigint, rate: number): bigint {
  if (rate === 10) return (lineTotal + 5n) / 11n;
  if (rate === 5) return (lineTotal + 10n) / 21n;
  return 0n;
}

@Injectable()
export class InvoicesService {
  constructor(
    private readonly appDb: AppPrisma,
    private readonly events: TenantEventsService,
    @Inject(INVOICING_PROVIDER) private readonly provider: InvoicingProvider,
  ) {}

  list(ctx: TenantContext, query: InvoiceListQuery) {
    return this.appDb.tx(ctx, (tx) =>
      tx.invoice.findMany({
        where: {
          ...(query.status ? { status: query.status } : {}),
          ...(query.customer_id ? { customerId: query.customer_id } : {}),
        },
        include: { customer: { select: { firstName: true, lastName: true } } },
        orderBy: { createdAt: 'desc' },
        take: query.limit,
      }),
    );
  }

  async get(ctx: TenantContext, id: string) {
    const invoice = await this.appDb.tx(ctx, (tx) =>
      tx.invoice.findFirst({
        where: { id },
        include: { items: true, payments: true, customer: true, branch: true },
      }),
    );
    if (!invoice) throw new NotFoundException();
    return invoice;
  }

  /** Borrador con totales SIEMPRE recalculados en el server (doc 04 §5). */
  async createDraft(ctx: TenantContext, dto: InvoiceCreate) {
    return this.appDb.tx(ctx, async (tx) => {
      const items = await this.resolveItems(tx, dto);
      const total = items.reduce((acc, i) => acc + i.lineTotal, 0n);
      const taxTotal = items.reduce((acc, i) => acc + taxPortion(i.lineTotal, i.taxRate), 0n);
      const invoice = await tx.invoice.create({
        data: {
          tenantId: ctx.tenantId,
          branchId: dto.branch_id,
          customerId: dto.customer_id,
          createdBy: ctx.userId,
          subtotal: total - taxTotal,
          taxTotal,
          total,
        },
      });
      // Items por createMany: el create anidado de Prisma no admite fijar
      // tenant_id explicito con FKs compuestas, y RLS lo exige en cada fila.
      await tx.invoiceItem.createMany({
        data: items.map((i) => ({
          tenantId: ctx.tenantId,
          invoiceId: invoice.id,
          serviceId: i.serviceId,
          description: i.description,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
          taxRate: i.taxRate,
          lineTotal: i.lineTotal,
        })),
      });
      return tx.invoice.findFirst({ where: { id: invoice.id }, include: { items: true } });
    });
  }

  /**
   * Emision (doc 04 §3.9): numeracion correlativa con lock por punto de
   * expedicion y transmision via InvoicingProvider. Con el provider fake la
   * aprobacion es inmediata; con el real este paso pasa a la cola.
   */
  async issue(ctx: TenantContext, id: string) {
    const issued = await this.appDb.tx(ctx, async (tx) => {
      const invoice = await tx.invoice.findFirst({
        where: { id },
        include: { items: true, customer: true },
      });
      if (!invoice) throw new NotFoundException();
      if (invoice.status !== 'draft') {
        throw new ConflictException({ title: 'Solo se emiten borradores' });
      }

      const sifen = await tx.integrationCredential.findFirst({
        where: { type: 'sifen', isActive: true },
      });
      const fiscal = sifen?.publicConfig as
        | { timbrado?: string; establishment?: string; expedition_point?: string }
        | undefined;
      if (!fiscal?.timbrado || !fiscal.establishment || !fiscal.expedition_point) {
        throw new UnprocessableEntityException({
          type: 'https://docs.pymes.local/errors/sifen-not-configured',
          title: 'Configura los datos de SIFEN (timbrado, establecimiento, punto) antes de emitir',
        });
      }

      // Lock por punto de expedicion: sin huecos ni duplicados bajo
      // concurrencia (doc 08 §5). Se libera al cerrar la transaccion.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${ctx.tenantId}:${fiscal.establishment}:${fiscal.expedition_point}:${invoice.docType}`}, 0))`;
      const last = await tx.invoice.findFirst({
        where: {
          establishment: fiscal.establishment,
          expeditionPoint: fiscal.expedition_point,
          docType: invoice.docType,
          docNumber: { not: null },
        },
        orderBy: { docNumber: 'desc' },
        select: { docNumber: true },
      });
      const nextNumber = String(Number(last?.docNumber ?? '0') + 1).padStart(7, '0');

      await tx.invoice.update({
        where: { id },
        data: { status: 'issuing', issuedAt: new Date() },
      });

      const result = await this.provider.issue({
        invoiceId: invoice.id,
        tenantId: ctx.tenantId,
        docType: invoice.docType as 'factura' | 'nota_credito',
        docNumber: nextNumber,
        fiscal: {
          timbrado: fiscal.timbrado,
          establishment: fiscal.establishment,
          expeditionPoint: fiscal.expedition_point,
        },
        customer: {
          name: `${invoice.customer.firstName} ${invoice.customer.lastName ?? ''}`.trim(),
          ruc: invoice.customer.docType === 'ruc' ? invoice.customer.docNumber : null,
          docNumber: invoice.customer.docNumber,
        },
        items: invoice.items.map((i) => ({
          description: i.description,
          quantity: Number(i.quantity),
          unitPrice: i.unitPrice,
          taxRate: i.taxRate,
        })),
        totals: {
          subtotal: invoice.subtotal,
          taxTotal: invoice.taxTotal,
          total: invoice.total,
          currency: invoice.currency,
        },
      });

      return tx.invoice.update({
        where: { id },
        data:
          result.status === 'approved'
            ? {
                status: 'approved',
                docNumber: nextNumber,
                establishment: fiscal.establishment,
                expeditionPoint: fiscal.expedition_point,
                timbrado: fiscal.timbrado,
                cdc: result.cdc,
                sifenResponseCode: result.responseCode,
                approvedAt: new Date(),
              }
            : {
                status: 'rejected',
                sifenResponseCode: result.responseCode,
              },
        include: { items: true },
      });
    });
    this.events.emit(ctx.tenantId, 'invoice.status', { id: issued.id, status: issued.status });
    return issued;
  }

  /** Anulacion: solo dentro de las 48 h de aprobada; despues, NC (doc 04 §3.9). */
  async cancel(ctx: TenantContext, id: string, dto: InvoiceCancel) {
    const cancelled = await this.appDb.tx(ctx, async (tx) => {
      const invoice = await tx.invoice.findFirst({ where: { id } });
      if (!invoice) throw new NotFoundException();
      if (invoice.status !== 'approved' || !invoice.approvedAt) {
        throw new ConflictException({ title: 'Solo se anulan facturas aprobadas' });
      }
      if (Date.now() - invoice.approvedAt.getTime() > CANCEL_WINDOW_MS) {
        throw new ConflictException({
          type: 'https://docs.pymes.local/errors/use-credit-note',
          title: 'Fuera del plazo de 48 h: corresponde nota de credito',
        });
      }
      if (invoice.cdc) {
        const result = await this.provider.cancel({
          invoiceId: invoice.id,
          cdc: invoice.cdc,
          reason: dto.reason,
        });
        if (result.status !== 'cancelled') {
          throw new ConflictException({ title: `SIFEN rechazo la anulacion: ${result.responseCode}` });
        }
      }
      return tx.invoice.update({
        where: { id },
        data: {
          status: 'cancelled',
          cancelReason: dto.reason,
          cancelledBy: ctx.userId,
          cancelledAt: new Date(),
        },
      });
    });
    this.events.emit(ctx.tenantId, 'invoice.status', { id: cancelled.id, status: cancelled.status });
    return cancelled;
  }

  /** Registra pago; 409 si excede el saldo (doc 04 §3.9). */
  async addPayment(ctx: TenantContext, id: string, dto: PaymentCreate) {
    return this.appDb.tx(ctx, async (tx) => {
      const invoice = await tx.invoice.findFirst({ where: { id }, include: { payments: true } });
      if (!invoice) throw new NotFoundException();
      if (invoice.status !== 'approved') {
        throw new ConflictException({ title: 'Solo se registran pagos sobre facturas aprobadas' });
      }
      const paid = invoice.payments.reduce((acc, p) => acc + p.amount, 0n);
      if (paid + dto.amount > invoice.total) {
        throw new ConflictException({ title: 'El pago excede el saldo pendiente' });
      }
      const payment = await tx.payment.create({
        data: {
          tenantId: ctx.tenantId,
          invoiceId: id,
          method: dto.method,
          amount: dto.amount,
          registeredBy: ctx.userId,
          notes: dto.notes,
        },
      });
      // Pago completo: el disparo del KuDE por WhatsApp/email llega con el
      // worker de fase 2; el estado ya queda consultable.
      return { payment, paid_total: paid + dto.amount, invoice_total: invoice.total };
    });
  }

  private async resolveItems(tx: TenantTx, dto: InvoiceCreate): Promise<ResolvedItem[]> {
    const items: ResolvedItem[] = [];
    for (const input of dto.items) {
      if (input.service_id) {
        const service = await tx.service.findFirst({
          where: { id: input.service_id, deletedAt: null },
        });
        if (!service) throw new NotFoundException();
        const quantity = input.quantity;
        const lineTotal = BigInt(Math.round(Number(service.price) * quantity));
        items.push({
          serviceId: service.id,
          description: input.description ?? service.name,
          quantity,
          unitPrice: service.price,
          taxRate: service.taxRate,
          lineTotal,
        });
      } else {
        const quantity = input.quantity;
        const unitPrice = input.unit_price ?? 0n;
        items.push({
          description: input.description ?? '',
          quantity,
          unitPrice,
          taxRate: input.tax_rate ?? 10,
          lineTotal: BigInt(Math.round(Number(unitPrice) * quantity)),
        });
      }
    }
    return items;
  }
}
