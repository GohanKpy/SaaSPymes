import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { SIFEN_CANCEL_HOURS_FACTURA, SIFEN_CANCEL_HOURS_OTROS } from '@pymes/shared';
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
  CreditNoteCreate,
} from '@pymes/shared';

import { AppPrisma } from '../prisma/app-prisma.service';
import { TenantEventsService } from '../conversations/events.service';
import { InventoryService, type AlertaStock } from '../inventory/inventory.service';
import { NotifierService } from '../notifications/notifier.service';

export const INVOICING_PROVIDER = 'INVOICING_PROVIDER';

/** Numero legible del comprobante. */
const numeroDe = (i: { establishment: string | null; expeditionPoint: string | null; docNumber: string | null }) =>
  i.docNumber ? `${i.establishment}-${i.expeditionPoint}-${i.docNumber}` : 'sin número';
const gs = (v: bigint | number) => `Gs ${new Intl.NumberFormat('es-PY').format(Number(v))}`;

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
    private readonly inventory: InventoryService,
    private readonly notifier: NotifierService,
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
        include: {
          items: true,
          payments: true,
          customer: true,
          branch: true,
          // Notas de credito emitidas sobre esta factura y, en una NC, la factura original (2026-09-14).
          creditNotes: { select: { id: true, establishment: true, expeditionPoint: true, docNumber: true, total: true, status: true, approvedAt: true, creditReason: true, restockedAt: true } },
          relatedInvoice: { select: { id: true, establishment: true, expeditionPoint: true, docNumber: true, total: true, status: true, cdc: true } },
        },
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
    const { updated: issued, alertas } = await this.appDb.tx(ctx, async (tx) => {
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

      // Inventario (2026-09-14): sin existencias no se emite (salvo que el
      // negocio permita stock negativo). Se valida ANTES de pedirle nada a SIFEN.
      const lineas = invoice.items.map((i) => ({ serviceId: i.serviceId, quantity: Number(i.quantity) }));
      if (invoice.docType === 'factura') {
        const faltantes = await this.inventory.faltantes(tx, invoice.branchId, lineas);
        if (faltantes.length > 0) {
          throw new ConflictException({
            type: 'https://docs.pymes.local/errors/insufficient-stock',
            title: `Sin stock suficiente: ${faltantes.map((f) => `${f.name} (hay ${f.available}, se necesitan ${f.requested})`).join('; ')}`,
            faltantes,
          });
        }
      }

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

      const updated = await tx.invoice.update({
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
      // La venta aprobada descuenta stock en la sucursal de la factura (la NC no).
      let alertas: AlertaStock[] = [];
      if (result.status === 'approved' && invoice.docType === 'factura') {
        alertas = await this.inventory.consumirVenta(tx, ctx.tenantId, { invoiceId: invoice.id, branchId: invoice.branchId, lineas, userId: ctx.userId ?? null });
      }
      return { updated, alertas };
    });
    this.events.emit(ctx.tenantId, 'invoice.status', { id: issued.id, status: issued.status });
    void this.inventory.avisarBajoMinimo(ctx.tenantId, alertas);
    return issued;
  }

  /**
   * Anulacion (RG 23/2019 art. 22; Manual Tecnico SIFEN v150, evento de
   * cancelacion): dentro de las 48 h de la APROBACION del DTE para facturas
   * (168 h para notas de credito), con motivo obligatorio de 5 a 500
   * caracteres; despues, nota de credito. Si la factura tiene notas de
   * credito aprobadas, primero se anulan esas. Efectos: el DTE queda sin
   * validez y se conserva intacto (nunca se borra), el numero no se reutiliza,
   * el stock descontado vuelve, se avisa al cliente y, si habia pagos, queda
   * una tarea para devolverlos o aplicarlos.
   */
  async cancel(ctx: TenantContext, id: string, dto: InvoiceCancel) {
    const cancelled = await this.appDb.tx(ctx, async (tx) => {
      const invoice = await tx.invoice.findFirst({
        where: { id },
        include: { payments: true, creditNotes: { select: { id: true, status: true, establishment: true, expeditionPoint: true, docNumber: true } } },
      });
      if (!invoice) throw new NotFoundException();
      if (invoice.status !== 'approved' || !invoice.approvedAt) {
        throw new ConflictException({ title: 'Solo se anulan comprobantes aprobados' });
      }
      const horas = invoice.docType === 'factura' ? SIFEN_CANCEL_HOURS_FACTURA : SIFEN_CANCEL_HOURS_OTROS;
      if (Date.now() - invoice.approvedAt.getTime() > horas * 3600 * 1000) {
        throw new ConflictException({
          type: 'https://docs.pymes.local/errors/use-credit-note',
          title: `Fuera del plazo de ${horas} h de SIFEN: corresponde una nota de crédito`,
        });
      }
      const ncVigente = invoice.creditNotes.find((n) => n.status === 'approved');
      if (ncVigente) {
        throw new ConflictException({ title: `Primero anulá la nota de crédito ${numeroDe(ncVigente)} asociada a esta factura (regla de SIFEN)` });
      }
      let cancelSifenCode: string | null = null;
      if (invoice.cdc) {
        const result = await this.provider.cancel({
          invoiceId: invoice.id,
          cdc: invoice.cdc,
          reason: dto.reason,
        });
        if (result.status !== 'cancelled') {
          throw new ConflictException({ title: `SIFEN rechazo la anulacion: ${result.responseCode}` });
        }
        cancelSifenCode = result.responseCode;
      }
      // Nota de credito anulada: la factura original vuelve a estar vigente.
      if (invoice.docType === 'nota_credito' && invoice.relatedInvoiceId) {
        await tx.invoice.updateMany({ where: { id: invoice.relatedInvoiceId, status: 'credited' }, data: { status: 'approved' } });
        await this.inventory.revertirNota(tx, ctx.tenantId, invoice.id, ctx.userId);
      } else {
        await this.inventory.revertirVenta(tx, ctx.tenantId, invoice.id, ctx.userId);
      }
      return tx.invoice.update({
        where: { id },
        data: {
          status: 'cancelled',
          cancelReason: dto.reason,
          cancelledBy: ctx.userId,
          cancelledAt: new Date(),
          cancelSifenCode,
        },
        include: { payments: true, customer: { select: { id: true, firstName: true, phoneE164: true, email: true, notifyWhatsapp: true, notifyEmail: true, invoiceChannel: true } } },
      });
    });
    this.events.emit(ctx.tenantId, 'invoice.status', { id: cancelled.id, status: cancelled.status });

    // Avisos fuera de la transaccion: pagos a resolver y cliente.
    const numero = numeroDe(cancelled);
    const tipo = cancelled.docType === 'nota_credito' ? 'La nota de crédito' : 'La factura';
    const pagado = cancelled.payments.reduce((sum, p) => sum + p.amount, 0n);
    if (pagado > 0n) {
      await this.notifier.owner(
        ctx.tenantId,
        cancelled.customerId,
        `${tipo} ${numero} se anuló con pagos registrados por ${gs(pagado)}: devolver el dinero al cliente o aplicarlo a la factura nueva, y dejar constancia.`,
        `Comprobante ${numero} anulado con pagos por ${gs(pagado)}`,
      );
    }
    if (dto.notify_customer) {
      const tenant = await this.appDb.client.tenant.findUnique({ where: { id: ctx.tenantId }, select: { tradeName: true, legalName: true } });
      const negocio = tenant?.tradeName ?? tenant?.legalName ?? 'el negocio';
      const c = cancelled.customer;
      const body =
        `Hola ${c.firstName}! Te escribimos de ${negocio}. ${tipo} N° ${numero} por ${gs(cancelled.total)} quedó ANULADA ante la DNIT y ya no tiene validez. Motivo: ${dto.reason}. ` +
        (pagado > 0n ? 'Como ya la habías pagado, te contactamos para devolverte el dinero o aplicarlo al comprobante correcto. ' : '') +
        'Si corresponde, te enviamos el comprobante correcto por este mismo medio.';
      let avisado = false;
      try {
        if (c.email && (c.invoiceChannel === 'email' || !c.phoneE164) && c.notifyEmail) {
          await this.notifier.email(c.email, `${negocio}: comprobante ${numero} anulado`, body);
          avisado = true;
        } else if (c.phoneE164 && c.notifyWhatsapp) {
          await this.notifier.whatsapp(ctx.tenantId, c.phoneE164, body);
          avisado = true;
        } else if (c.email && c.notifyEmail) {
          await this.notifier.email(c.email, `${negocio}: comprobante ${numero} anulado`, body);
          avisado = true;
        }
      } catch {
        avisado = false;
      }
      if (avisado) await this.appDb.tx(ctx, (tx) => tx.invoice.update({ where: { id }, data: { cancelNotifiedAt: new Date() } }));
    }
    return cancelled;
  }

  /**
   * Nota de credito electronica (2026-09-14): total o parcial sobre una
   * factura aprobada, cuando ya paso el plazo de cancelacion o se devuelve
   * parte de lo vendido. Es un DTE propio (numeracion propia, mismo
   * timbrado) que referencia la factura original; la factura pasa a
   * 'credited' cuando lo acreditado cubre su total. Con restock, los items
   * fisicos vuelven al stock de la sucursal.
   */
  async createCreditNote(ctx: TenantContext, invoiceId: string, dto: CreditNoteCreate) {
    const { nc, lineas } = await this.appDb.tx(ctx, async (tx) => {
      const original = await tx.invoice.findFirst({
        where: { id: invoiceId },
        include: { items: true, creditNotes: { where: { status: { in: ['approved', 'issuing'] } }, include: { items: true } } },
      });
      if (!original) throw new NotFoundException();
      if (original.docType !== 'factura') throw new ConflictException({ title: 'Solo se emite una nota de crédito sobre una factura' });
      if (!['approved', 'credited'].includes(original.status)) {
        throw new ConflictException({ title: 'Solo se acreditan facturas aprobadas' });
      }
      // Cantidades ya acreditadas por item (mismo servicio + descripcion).
      const clave = (i: { serviceId: string | null; description: string }) => `${i.serviceId ?? ''}|${i.description}`;
      const acreditado = new Map<string, number>();
      for (const n of original.creditNotes) for (const it of n.items) acreditado.set(clave(it), (acreditado.get(clave(it)) ?? 0) + Number(it.quantity));
      const seleccion = dto.items
        ? dto.items.map((sel) => {
            const it = original.items.find((i) => i.id === sel.item_id);
            if (!it) throw new NotFoundException({ title: 'Ese ítem no es de la factura' });
            const disponible = Number(it.quantity) - (acreditado.get(clave(it)) ?? 0);
            if (sel.quantity > disponible + 1e-9) {
              throw new ConflictException({ title: `De "${it.description}" quedan ${disponible} por acreditar` });
            }
            return { it, quantity: sel.quantity };
          })
        : original.items.map((it) => ({ it, quantity: Number(it.quantity) - (acreditado.get(clave(it)) ?? 0) })).filter((l) => l.quantity > 0);
      if (seleccion.length === 0) throw new ConflictException({ title: 'La factura ya está acreditada por completo' });
      const items = seleccion.map(({ it, quantity }) => {
        const lineTotal = BigInt(Math.round(Number(it.unitPrice) * quantity));
        return { serviceId: it.serviceId, description: it.description, quantity, unitPrice: it.unitPrice, taxRate: it.taxRate, lineTotal };
      });
      const total = items.reduce((acc, i) => acc + i.lineTotal, 0n);
      const taxTotal = items.reduce((acc, i) => acc + taxPortion(i.lineTotal, i.taxRate), 0n);
      const nc = await tx.invoice.create({
        data: {
          tenantId: ctx.tenantId,
          branchId: original.branchId,
          customerId: original.customerId,
          docType: 'nota_credito',
          relatedInvoiceId: original.id,
          createdBy: ctx.userId,
          subtotal: total - taxTotal,
          taxTotal,
          total,
          creditReason: dto.reason,
          fiscalIdId: original.fiscalIdId,
          billingName: original.billingName,
          billingDocType: original.billingDocType,
          billingDocNumber: original.billingDocNumber,
          billingRucDv: original.billingRucDv,
        },
      });
      await tx.invoiceItem.createMany({ data: items.map((i) => ({ tenantId: ctx.tenantId, invoiceId: nc.id, ...i })) });
      return { nc, lineas: items.map((i) => ({ serviceId: i.serviceId, quantity: i.quantity })) };
    });

    // Se emite por SIFEN con el mismo camino que una factura (numeracion propia por tipo).
    const issued = await this.issue(ctx, nc.id);
    if (issued.status === 'approved') {
      await this.appDb.tx(ctx, async (tx) => {
        const notas = await tx.invoice.findMany({ where: { relatedInvoiceId: invoiceId, status: 'approved' }, select: { total: true } });
        const acreditado = notas.reduce((sum, n) => sum + n.total, 0n);
        const original = await tx.invoice.findFirst({ where: { id: invoiceId }, select: { total: true, branchId: true } });
        if (original && acreditado >= original.total) {
          await tx.invoice.update({ where: { id: invoiceId }, data: { status: 'credited' } });
        }
        if (dto.restock && original) {
          await this.inventory.reingresarPorNota(tx, ctx.tenantId, { creditNoteId: nc.id, branchId: original.branchId, lineas, userId: ctx.userId ?? null });
          await tx.invoice.update({ where: { id: nc.id }, data: { restockedAt: new Date() } });
        }
      });
      if (dto.notify_customer) await this.avisarNotaDeCredito(ctx, nc.id, invoiceId, dto.reason);
    }
    return this.get(ctx, nc.id);
  }

  private async avisarNotaDeCredito(ctx: TenantContext, creditNoteId: string, invoiceId: string, motivo: string): Promise<void> {
    try {
      const [nc, original, tenant] = await Promise.all([
        this.appDb.tx(ctx, (tx) => tx.invoice.findFirst({ where: { id: creditNoteId }, include: { customer: true } })),
        this.appDb.tx(ctx, (tx) => tx.invoice.findFirst({ where: { id: invoiceId } })),
        this.appDb.client.tenant.findUnique({ where: { id: ctx.tenantId }, select: { tradeName: true, legalName: true } }),
      ]);
      if (!nc || !original) return;
      const negocio = tenant?.tradeName ?? tenant?.legalName ?? 'el negocio';
      const c = nc.customer;
      const link = this.notifier.kudeLink(ctx.tenantId, nc.id);
      const body =
        `Hola ${c.firstName}! Te escribimos de ${negocio}. Emitimos la nota de crédito N° ${numeroDe(nc)} por ${gs(nc.total)} sobre tu factura N° ${numeroDe(original)}. Motivo: ${motivo}. ` +
        `Podés ver el comprobante acá: ${link}`;
      if (c.email && (c.invoiceChannel === 'email' || !c.phoneE164) && c.notifyEmail) await this.notifier.email(c.email, `${negocio}: nota de crédito ${numeroDe(nc)}`, body);
      else if (c.phoneE164 && c.notifyWhatsapp) await this.notifier.whatsapp(ctx.tenantId, c.phoneE164, body);
      else if (c.email && c.notifyEmail) await this.notifier.email(c.email, `${negocio}: nota de crédito ${numeroDe(nc)}`, body);
    } catch {
      /* el aviso nunca frena la emision */
    }
  }

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
