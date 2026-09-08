import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { TenantContext, TenantTx } from '@pymes/db';
import type { InvoicingProvider } from '@pymes/invoicing';
import type {
  InvoiceBillingInput,
  InvoiceBillingUpdate,
  InvoiceCancel,
  InvoiceCreate,
  InvoiceItemInput,
  InvoiceListQuery,
  PaymentCreate,
} from '@pymes/shared';

import { AppPrisma } from '../prisma/app-prisma.service';
import { TenantEventsService } from '../conversations/events.service';

export const INVOICING_PROVIDER = 'INVOICING_PROVIDER';

const CANCEL_WINDOW_MS = 48 * 3600 * 1000; // 48 h (doc 04 §3.9)

export interface ResolvedItem {
  serviceId?: string;
  description: string;
  quantity: number;
  unitPrice: bigint;
  taxRate: number;
  lineTotal: bigint;
}

/** IVA incluido en el precio (convencion PY): 10% → total/11, 5% → total/21. */
export function taxPortion(lineTotal: bigint, rate: number): bigint {
  if (rate === 10) return (lineTotal + 5n) / 11n;
  if (rate === 5) return (lineTotal + 10n) / 21n;
  return 0n;
}

/** Precio y descripcion salen del catalogo salvo item libre; el cliente
 *  jamas fija totales (doc 04 §5). Compartido entre facturas y presupuestos. */
export async function resolveItems(tx: TenantTx, inputs: InvoiceItemInput[]): Promise<ResolvedItem[]> {
  const items: ResolvedItem[] = [];
  for (const input of inputs) {
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

// ------------- a nombre de quien sale la factura (2026-09-07) -------------

export interface BillingSnapshot {
  fiscalIdId: string | null;
  billingName: string | null;
  billingDocType: string | null;
  billingDocNumber: string | null;
  billingRucDv: string | null;
}

const SIN_BILLING: BillingSnapshot = {
  fiscalIdId: null,
  billingName: null,
  billingDocType: null,
  billingDocNumber: null,
  billingRucDv: null,
};

function snapshotDe(f: { id: string; legalName: string; docType: string; docNumber: string; rucDv: string | null }): BillingSnapshot {
  return { fiscalIdId: f.id, billingName: f.legalName, billingDocType: f.docType, billingDocNumber: f.docNumber, billingRucDv: f.rucDv };
}

/**
 * Sin eleccion explicita: la identidad predeterminada de la ficha (o la mas
 * vieja) y, si no hay ninguna, el documento propio del cliente. Puede quedar
 * vacio: un borrador se crea igual y se completa antes de emitir.
 */
export async function defaultBillingFor(tx: TenantTx, customerId: string): Promise<BillingSnapshot> {
  const f = await tx.customerFiscalId.findFirst({
    where: { customerId, deletedAt: null },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
  });
  if (f) return snapshotDe(f);
  const c = await tx.customer.findFirst({ where: { id: customerId } });
  if (c?.docNumber) {
    return {
      fiscalIdId: null,
      billingName: `${c.firstName} ${c.lastName ?? ''}`.trim(),
      billingDocType: c.docType ?? 'ci',
      billingDocNumber: c.docNumber,
      billingRucDv: c.docType === 'ruc' ? c.rucDv : null,
    };
  }
  return SIN_BILLING;
}

/** Resuelve fiscal_id | billing | (nada) al snapshot que se congela en la factura. */
export async function resolveBilling(
  tx: TenantTx,
  tenantId: string,
  customerId: string,
  input: { fiscal_id?: string; billing?: InvoiceBillingInput },
): Promise<BillingSnapshot> {
  if (input.fiscal_id) {
    const f = await tx.customerFiscalId.findFirst({ where: { id: input.fiscal_id, customerId, deletedAt: null } });
    if (!f) throw new NotFoundException({ title: 'Esa identidad fiscal no esta en la ficha del cliente' });
    return snapshotDe(f);
  }
  if (input.billing) {
    const b = input.billing;
    const dv = b.doc_type === 'ruc' ? (b.ruc_dv ?? null) : null;
    if (!b.save_to_customer) {
      return { fiscalIdId: null, billingName: b.legal_name, billingDocType: b.doc_type, billingDocNumber: b.doc_number, billingRucDv: dv };
    }
    // Se guarda en la ficha para la proxima vez (mismo documento = se actualiza el nombre).
    const existente = await tx.customerFiscalId.findFirst({
      where: { customerId, docType: b.doc_type, docNumber: b.doc_number, deletedAt: null },
    });
    const cuantas = await tx.customerFiscalId.count({ where: { customerId, deletedAt: null } });
    const f = existente
      ? await tx.customerFiscalId.update({ where: { id: existente.id }, data: { legalName: b.legal_name, rucDv: dv } })
      : await tx.customerFiscalId.create({
          data: { tenantId, customerId, docType: b.doc_type, docNumber: b.doc_number, rucDv: dv, legalName: b.legal_name, isDefault: cuantas === 0 },
        });
    return snapshotDe(f);
  }
  return defaultBillingFor(tx, customerId);
}

/** Receptor efectivo: el snapshot de la factura o, en facturas viejas, el documento del cliente. */
/** Timbrado de las simulaciones en modo desarrollo (sin datos de SIFEN cargados). */
const DEV_TIMBRADO = 'DEV00000';

export function billingEfectivo(invoice: {
  billingName: string | null;
  billingDocType: string | null;
  billingDocNumber: string | null;
  billingRucDv: string | null;
  customer: { firstName: string; lastName: string | null; docType: string | null; docNumber: string | null; rucDv: string | null };
}) {
  const c = invoice.customer;
  if (invoice.billingDocNumber) {
    return {
      name: invoice.billingName ?? `${c.firstName} ${c.lastName ?? ''}`.trim(),
      docType: invoice.billingDocType,
      docNumber: invoice.billingDocNumber,
      rucDv: invoice.billingRucDv,
    };
  }
  return { name: `${c.firstName} ${c.lastName ?? ''}`.trim(), docType: c.docType, docNumber: c.docNumber, rucDv: c.rucDv };
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
        include: {
          customer: { select: { firstName: true, lastName: true } },
          // El panel decide con esto si la factura ya esta paga (popup de
          // pago con vuelto y KuDE recien tras registrar el pago).
          payments: { select: { amount: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: query.limit,
      }),
    );
  }

  /** Solo borradores: una factura emitida tiene numero fiscal y se anula, no se borra. */
  async removeDraft(ctx: TenantContext, id: string) {
    await this.appDb.tx(ctx, async (tx) => {
      const invoice = await tx.invoice.findFirst({ where: { id } });
      if (!invoice) throw new NotFoundException();
      if (invoice.status !== 'draft') {
        throw new ConflictException({ title: 'Solo se borran borradores; una factura emitida se anula' });
      }
      await tx.invoiceItem.deleteMany({ where: { invoiceId: id } });
      await tx.invoice.delete({ where: { id } });
    });
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
      const customer = await tx.customer.findFirst({ where: { id: dto.customer_id, deletedAt: null } });
      if (!customer) throw new NotFoundException({ title: 'El cliente no existe' });
      const items = await resolveItems(tx, dto.items);
      const total = items.reduce((acc, i) => acc + i.lineTotal, 0n);
      const taxTotal = items.reduce((acc, i) => acc + taxPortion(i.lineTotal, i.taxRate), 0n);
      // A nombre de quien sale (2026-09-07): se congela ahora, es dato fiscal.
      const billing = await resolveBilling(tx, ctx.tenantId, dto.customer_id, dto);
      const invoice = await tx.invoice.create({
        data: {
          tenantId: ctx.tenantId,
          branchId: dto.branch_id,
          customerId: dto.customer_id,
          createdBy: ctx.userId,
          subtotal: total - taxTotal,
          taxTotal,
          total,
          ...billing,
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

  /** Cambiar a nombre de quien sale un BORRADOR (2026-09-07). */
  async updateBilling(ctx: TenantContext, id: string, dto: InvoiceBillingUpdate) {
    return this.appDb.tx(ctx, async (tx) => {
      const invoice = await tx.invoice.findFirst({ where: { id } });
      if (!invoice) throw new NotFoundException();
      if (invoice.status !== 'draft') {
        throw new ConflictException({ title: 'Solo se cambia el receptor de un borrador; una factura emitida se anula' });
      }
      const billing = await resolveBilling(tx, ctx.tenantId, invoice.customerId, dto);
      return tx.invoice.update({ where: { id }, data: billing, include: { items: true, payments: true, customer: true } });
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
      // Modo desarrollo (2026-09-08, check DEV en la ficha del cliente en
      // padmin): las simulaciones se emiten sin receptor ni datos de SIFEN.
      // En produccion rigen los bloqueos.
      const tenant = await tx.tenant.findUnique({ where: { id: ctx.tenantId }, select: { devMode: true } });
      const dev = tenant?.devMode ?? false;
      // Sin receptor no hay factura valida (2026-09-07): RUC o cedula y nombre.
      const receptor = billingEfectivo(invoice);
      if (!dev && (!receptor.docNumber || !receptor.name)) {
        throw new UnprocessableEntityException({
          type: 'https://docs.pymes.local/errors/billing-missing',
          title: 'Falta a nombre de quien sale la factura: carga RUC o cedula y nombre desde el detalle del borrador',
        });
      }

      const sifen = await tx.integrationCredential.findFirst({
        where: { type: 'sifen', isActive: true },
      });
      let fiscal = sifen?.publicConfig as
        | { timbrado?: string; establishment?: string; expedition_point?: string }
        | undefined;
      if (!fiscal?.timbrado || !fiscal.establishment || !fiscal.expedition_point) {
        if (!dev) {
          throw new UnprocessableEntityException({
            type: 'https://docs.pymes.local/errors/sifen-not-configured',
            title: 'Configura los datos de SIFEN (timbrado, establecimiento, punto) antes de emitir',
          });
        }
        fiscal = { timbrado: DEV_TIMBRADO, establishment: fiscal?.establishment || '001', expedition_point: fiscal?.expedition_point || '001' };
      }
      const fiscalOk = fiscal as { timbrado: string; establishment: string; expedition_point: string };

      // Lock por punto de expedicion: sin huecos ni duplicados bajo
      // concurrencia (doc 08 §5). Se libera al cerrar la transaccion.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${ctx.tenantId}:${fiscalOk.establishment}:${fiscalOk.expedition_point}:${invoice.docType}`}, 0))`;
      const last = await tx.invoice.findFirst({
        where: {
          establishment: fiscalOk.establishment,
          expeditionPoint: fiscalOk.expedition_point,
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
          timbrado: fiscalOk.timbrado,
          establishment: fiscalOk.establishment,
          expeditionPoint: fiscalOk.expedition_point,
        },
        customer: {
          name: receptor.name || 'Consumidor final',
          ruc: receptor.docType === 'ruc' ? receptor.docNumber : null,
          docNumber: receptor.docNumber ?? '',
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
                establishment: fiscalOk.establishment,
                expeditionPoint: fiscalOk.expedition_point,
                timbrado: fiscalOk.timbrado,
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

}
