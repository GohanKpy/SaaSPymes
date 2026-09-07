import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { TenantContext } from '@pymes/db';
import type { AccountInvoice, ChargeCreate } from '@pymes/shared';

import { NotifierService } from '../notifications/notifier.service';
import { AppPrisma } from '../prisma/app-prisma.service';
import { InvoicesService, resolveBilling, resolveItems, taxPortion } from './invoices.service';
import { KudeService } from './kude.service';

const SWEEP_INTERVAL_MS = 60 * 60_000;

const fmtGs = (v: bigint | number) => `${new Intl.NumberFormat('es-PY').format(Number(v))} Gs`;
const fmtFecha = (d: Date) => d.toLocaleDateString('es-PY', { timeZone: 'UTC', day: '2-digit', month: '2-digit' });
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const nombrePeriodo = (period: string) => {
  const [y, m] = period.split('-').map(Number);
  return `${MESES[(m ?? 1) - 1]} de ${y}`;
};

type ChargeRow = { description: string; quantity: unknown; lineTotal: bigint; chargedOn: Date };

/**
 * Cuenta mensual (2026-09-07): consumos pendientes por cliente, facturar todo
 * el mes de una vez, enviar resumen o factura por el canal elegido, y el
 * cierre automatico (barrido horario, idempotente por resumen).
 */
@Injectable()
export class BillingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Billing');
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly appDb: AppPrisma,
    private readonly invoices: InvoicesService,
    private readonly kude: KudeService,
    private readonly notifier: NotifierService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.sweep(), SWEEP_INTERVAL_MS);
    setTimeout(() => void this.sweep(), 90_000);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  // ------------------------------ consultas ------------------------------

  /** Clientes con consumos pendientes: total, cantidad y desde cuando. */
  async accounts(ctx: TenantContext) {
    return this.appDb.tx(ctx, async (tx) => {
      const grupos = await tx.customerCharge.groupBy({
        by: ['customerId'],
        where: { status: 'pending' },
        _sum: { lineTotal: true },
        _count: { _all: true },
        _min: { chargedOn: true },
      });
      if (grupos.length === 0) return [];
      const customers = await tx.customer.findMany({
        where: { id: { in: grupos.map((g) => g.customerId) } },
        select: { id: true, firstName: true, lastName: true, phoneE164: true, email: true, billingMode: true, invoiceChannel: true },
      });
      const porId = new Map(customers.map((c) => [c.id, c]));
      return grupos
        .map((g) => ({
          customer: porId.get(g.customerId) ?? null,
          total: String(g._sum.lineTotal ?? 0n),
          count: g._count._all,
          since: g._min.chargedOn,
        }))
        .filter((a) => a.customer)
        .sort((a, b) => Number(b.total) - Number(a.total));
    });
  }

  /** Detalle de la cuenta de un cliente: consumos pendientes y ultimos resumenes. */
  async account(ctx: TenantContext, customerId: string) {
    return this.appDb.tx(ctx, async (tx) => {
      const customer = await tx.customer.findFirst({
        where: { id: customerId, deletedAt: null },
        select: { id: true, firstName: true, lastName: true, phoneE164: true, email: true, billingMode: true, invoiceChannel: true },
      });
      if (!customer) throw new NotFoundException();
      const charges = await tx.customerCharge.findMany({ where: { customerId, status: 'pending' }, orderBy: { chargedOn: 'asc' } });
      const statements = await tx.billingStatement.findMany({
        where: { customerId },
        orderBy: { period: 'desc' },
        take: 6,
        include: { invoice: { select: { id: true, status: true, establishment: true, expeditionPoint: true, docNumber: true, total: true } } },
      });
      const total = charges.reduce((acc, c) => acc + c.lineTotal, 0n);
      return { customer, charges, statements, total: String(total) };
    });
  }

  /** Ultimos resumenes del negocio (para la pestaña Cuentas del mes). */
  async statements(ctx: TenantContext) {
    return this.appDb.tx(ctx, (tx) =>
      tx.billingStatement.findMany({
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: {
          customer: { select: { id: true, firstName: true, lastName: true, invoiceChannel: true } },
          invoice: { select: { id: true, status: true, establishment: true, expeditionPoint: true, docNumber: true, total: true } },
        },
      }),
    );
  }

  // ------------------------------ consumos ------------------------------

  /** Consumo cargado a mano (articulo comprado, extra). */
  async addCharge(ctx: TenantContext, customerId: string, dto: ChargeCreate) {
    return this.appDb.tx(ctx, async (tx) => {
      const customer = await tx.customer.findFirst({ where: { id: customerId, deletedAt: null } });
      if (!customer) throw new NotFoundException();
      const [item] = await resolveItems(tx, [
        { service_id: dto.service_id, description: dto.description, quantity: dto.quantity, unit_price: dto.unit_price, tax_rate: dto.tax_rate },
      ]);
      if (!item) throw new ConflictException({ title: 'Consumo invalido' });
      return tx.customerCharge.create({
        data: {
          tenantId: ctx.tenantId,
          customerId,
          serviceId: item.serviceId,
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          taxRate: item.taxRate,
          lineTotal: item.lineTotal,
          source: 'manual',
          notes: dto.notes,
          createdBy: ctx.userId,
          ...(dto.charged_on ? { chargedOn: new Date(dto.charged_on) } : {}),
        },
      });
    });
  }

  /** Anular un consumo pendiente (cargado por error). */
  async voidCharge(ctx: TenantContext, chargeId: string) {
    return this.appDb.tx(ctx, async (tx) => {
      const charge = await tx.customerCharge.findFirst({ where: { id: chargeId } });
      if (!charge) throw new NotFoundException();
      if (charge.status !== 'pending') throw new ConflictException({ title: 'Solo se anulan consumos pendientes' });
      return tx.customerCharge.update({ where: { id: chargeId }, data: { status: 'void' } });
    });
  }

  // ------------------------------ facturar y enviar ------------------------------

  /**
   * Factura la cuenta: UNA factura con todos los consumos pendientes (o hasta
   * una fecha), a nombre de la identidad elegida o la predeterminada; emite y
   * envia si se pide. Los consumos quedan marcados como facturados.
   */
  async invoiceAccount(ctx: TenantContext, customerId: string, dto: AccountInvoice) {
    const invoiceId = await this.appDb.tx(ctx, async (tx) => {
      const customer = await tx.customer.findFirst({ where: { id: customerId, deletedAt: null } });
      if (!customer) throw new NotFoundException();
      const charges = await tx.customerCharge.findMany({
        where: { customerId, status: 'pending', ...(dto.until ? { chargedOn: { lte: new Date(dto.until) } } : {}) },
        orderBy: { chargedOn: 'asc' },
      });
      if (charges.length === 0) throw new ConflictException({ title: 'Este cliente no tiene consumos pendientes de facturar' });
      const branch = (await tx.branch.findFirst({ where: { deletedAt: null, isMain: true } })) ?? (await tx.branch.findFirst({ where: { deletedAt: null } }));
      if (!branch) throw new ConflictException({ title: 'El negocio no tiene sucursal cargada' });
      const total = charges.reduce((acc, c) => acc + c.lineTotal, 0n);
      const taxTotal = charges.reduce((acc, c) => acc + taxPortion(c.lineTotal, c.taxRate), 0n);
      const billing = await resolveBilling(tx, ctx.tenantId, customerId, dto);
      const invoice = await tx.invoice.create({
        data: {
          tenantId: ctx.tenantId,
          branchId: branch.id,
          customerId,
          createdBy: ctx.userId,
          subtotal: total - taxTotal,
          taxTotal,
          total,
          ...billing,
        },
      });
      await tx.invoiceItem.createMany({
        data: charges.map((c) => ({
          tenantId: ctx.tenantId,
          invoiceId: invoice.id,
          serviceId: c.serviceId,
          description: `${c.description} (${fmtFecha(c.chargedOn)})`,
          quantity: c.quantity,
          unitPrice: c.unitPrice,
          taxRate: c.taxRate,
          lineTotal: c.lineTotal,
        })),
      });
      await tx.customerCharge.updateMany({
        where: { id: { in: charges.map((c) => c.id) } },
        data: { status: 'invoiced', invoiceId: invoice.id },
      });
      return invoice.id;
    });

    let invoice = await this.invoices.get(ctx, invoiceId);
    if (dto.issue) invoice = (await this.invoices.issue(ctx, invoiceId)) as typeof invoice;
    const sent = dto.send && invoice.status === 'approved' ? await this.sendInvoice(ctx, invoiceId) : null;
    return { invoice, sent };
  }

  /** Envia una factura emitida al cliente por su canal: email con el PDF adjunto o WhatsApp con link firmado. */
  async sendInvoice(ctx: TenantContext, invoiceId: string): Promise<{ channel: string; ok: boolean; detail?: string }> {
    const { invoice, negocio } = await this.appDb.tx(ctx, async (tx) => {
      const inv = await tx.invoice.findFirst({ where: { id: invoiceId }, include: { customer: true } });
      if (!inv) throw new NotFoundException();
      const t = await tx.tenant.findUnique({ where: { id: ctx.tenantId }, select: { tradeName: true, legalName: true } });
      return { invoice: inv, negocio: t?.tradeName ?? t?.legalName ?? 'el negocio' };
    });
    if (invoice.status !== 'approved') return { channel: invoice.customer.invoiceChannel, ok: false, detail: 'La factura no esta emitida' };
    const numero = `${invoice.establishment}-${invoice.expeditionPoint}-${invoice.docNumber}`;
    const receptor = invoice.billingName ?? `${invoice.customer.firstName} ${invoice.customer.lastName ?? ''}`.trim();
    const channel = invoice.customer.invoiceChannel;
    try {
      if (channel === 'email') {
        if (!invoice.customer.email) return { channel, ok: false, detail: 'El cliente no tiene email cargado' };
        const { pdf, filename } = await this.kude.render(ctx, invoiceId, { requirePayment: false });
        await this.notifier.email(
          invoice.customer.email,
          `Factura ${numero} de ${negocio}`,
          `Hola ${invoice.customer.firstName}!\n\nTe enviamos la factura ${numero} de ${negocio}, a nombre de ${receptor}, por ${fmtGs(invoice.total)}.\nEl comprobante va adjunto en PDF.\n\nGracias por elegirnos.`,
          [{ filename, content: pdf, contentType: 'application/pdf' }],
        );
      } else {
        if (!invoice.customer.phoneE164) return { channel, ok: false, detail: 'El cliente no tiene celular cargado' };
        const link = this.notifier.kudeLink(ctx.tenantId, invoiceId);
        await this.notifier.whatsapp(
          ctx.tenantId,
          invoice.customer.phoneE164,
          `Hola ${invoice.customer.firstName}! Te enviamos la factura ${numero} de ${negocio}, a nombre de ${receptor}, por ${fmtGs(invoice.total)}. Podes descargar el comprobante aca (vale 30 dias): ${link}`,
        );
      }
      return { channel, ok: true };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.warn(`envio de factura fallo tenant=${ctx.tenantId} invoice=${invoiceId}: ${detail}`);
      return { channel, ok: false, detail };
    }
  }

  /** Resumen de los consumos pendientes al cliente por su canal (sin facturar). */
  async notifyAccount(ctx: TenantContext, customerId: string, until?: string, periodo?: string) {
    const { customer, charges, negocio } = await this.appDb.tx(ctx, async (tx) => {
      const c = await tx.customer.findFirst({ where: { id: customerId, deletedAt: null } });
      if (!c) throw new NotFoundException();
      const rows = await tx.customerCharge.findMany({
        where: { customerId, status: 'pending', ...(until ? { chargedOn: { lte: new Date(until) } } : {}) },
        orderBy: { chargedOn: 'asc' },
      });
      const t = await tx.tenant.findUnique({ where: { id: ctx.tenantId }, select: { tradeName: true, legalName: true } });
      return { customer: c, charges: rows, negocio: t?.tradeName ?? t?.legalName ?? 'el negocio' };
    });
    if (charges.length === 0) throw new ConflictException({ title: 'Este cliente no tiene consumos pendientes' });
    const total = charges.reduce((acc, c) => acc + c.lineTotal, 0n);
    const texto = this.resumenTexto(negocio, customer.firstName, charges, total, periodo);
    const channel = customer.invoiceChannel;
    try {
      if (channel === 'email') {
        if (!customer.email) return { channel, ok: false, detail: 'El cliente no tiene email cargado', total: String(total), count: charges.length };
        await this.notifier.email(customer.email, `Resumen de tu cuenta en ${negocio}`, texto);
      } else {
        if (!customer.phoneE164) return { channel, ok: false, detail: 'El cliente no tiene celular cargado', total: String(total), count: charges.length };
        await this.notifier.whatsapp(ctx.tenantId, customer.phoneE164, texto);
      }
      return { channel, ok: true, total: String(total), count: charges.length };
    } catch (error) {
      return { channel, ok: false, detail: error instanceof Error ? error.message : String(error), total: String(total), count: charges.length };
    }
  }

  private resumenTexto(negocio: string, nombre: string, charges: ChargeRow[], total: bigint, periodo?: string): string {
    const lineas = charges
      .slice(0, 30)
      .map((c) => `- ${fmtFecha(c.chargedOn)} ${c.description}${Number(c.quantity) !== 1 ? ` x${Number(c.quantity)}` : ''}: ${fmtGs(c.lineTotal)}`)
      .join('\n');
    const extra = charges.length > 30 ? `\n… y ${charges.length - 30} mas` : '';
    return (
      `Hola ${nombre}! Este es el resumen de tu cuenta en ${negocio}${periodo ? ` de ${periodo}` : ''}:\n` +
      `${lineas}${extra}\n` +
      `Total: ${fmtGs(total)}.\n` +
      'Si algo no coincide, respondé este mensaje y lo revisamos.'
    );
  }

  // ------------------------------ cierre automatico ------------------------------

  async sweep(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const tenants = await this.appDb.client.tenant.findMany({
        where: { status: { in: ['trial', 'active'] } },
        select: { id: true, tradeName: true, legalName: true, timezone: true },
      });
      for (const t of tenants) {
        await this.closeMonth(t.id, t.timezone ?? 'America/Asuncion').catch((error) => {
          this.logger.error(`cierre mensual fallo tenant=${t.id}`, error instanceof Error ? error.stack : String(error));
        });
      }
    } finally {
      this.running = false;
    }
  }

  /** Cierre a pedido desde el panel: ignora el dia de cierre y procesa el mes anterior ya. */
  async closeMonthNow(ctx: TenantContext) {
    const tenant = await this.appDb.client.tenant.findUnique({ where: { id: ctx.tenantId }, select: { timezone: true } });
    const procesados = await this.closeMonth(ctx.tenantId, tenant?.timezone ?? 'America/Asuncion', true);
    return { procesados };
  }

  /**
   * En la fecha de cierre (dia configurado, hora del negocio) arma UN resumen
   * por cliente con consumos del mes anterior, se lo envia, avisa al dueño y,
   * si el negocio lo pidio, factura y envia. Idempotente: el resumen por
   * (cliente, periodo) es unico.
   */
  async closeMonth(tenantId: string, timezone: string, forzar = false): Promise<number> {
    const ctx = { tenantId, actorType: 'system' as const };
    const settings = await this.appDb.tx(ctx, (tx) => tx.tenantSettings.findUnique({ where: { tenantId } }));
    const closeDay = settings?.monthlyCloseDay ?? 1;
    const autoInvoice = settings?.monthlyAutoInvoice ?? false;
    const hoy = new Date().toLocaleDateString('en-CA', { timeZone: timezone }); // YYYY-MM-DD
    const [y, m, d] = hoy.split('-').map(Number);
    if (!y || !m || !d) return 0;
    if (!forzar && d < closeDay) return 0;
    // Periodo = mes anterior; corte = ultimo dia de ese mes.
    const prev = new Date(Date.UTC(y, m - 1, 0)); // dia 0 del mes actual = ultimo del anterior
    const period = `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, '0')}`;
    const until = prev.toISOString().slice(0, 10);

    const grupos = await this.appDb.tx(ctx, (tx) =>
      tx.customerCharge.groupBy({
        by: ['customerId'],
        where: { status: 'pending', chargedOn: { lte: new Date(until) } },
        _sum: { lineTotal: true },
        _count: { _all: true },
      }),
    );
    if (grupos.length === 0) return 0;
    const negocio = await this.appDb.client.tenant.findUnique({ where: { id: tenantId }, select: { tradeName: true, legalName: true } });
    const nombreNegocio = negocio?.tradeName ?? negocio?.legalName ?? 'el negocio';
    let procesados = 0;

    for (const g of grupos) {
      const yaHecho = await this.appDb.tx(ctx, (tx) =>
        tx.billingStatement.findFirst({ where: { customerId: g.customerId, period } }),
      );
      if (yaHecho) continue;
      const total = g._sum.lineTotal ?? 0n;
      const statement = await this.appDb.tx(ctx, (tx) =>
        tx.billingStatement.create({
          data: { tenantId, customerId: g.customerId, period, total, chargesCount: g._count._all },
        }),
      );
      const customer = await this.appDb.tx(ctx, (tx) => tx.customer.findFirst({ where: { id: g.customerId } }));
      const nombre = customer ? `${customer.firstName} ${customer.lastName ?? ''}`.trim() : 'cliente';
      let detalleFactura = '';
      let invoiceId: string | null = null;
      let notifiedCustomer = false;
      try {
        if (autoInvoice) {
          const { invoice, sent } = await this.invoiceAccount(ctx, g.customerId, { issue: true, send: true, until });
          invoiceId = invoice.id;
          notifiedCustomer = Boolean(sent?.ok);
          const numero = invoice.docNumber ? `${invoice.establishment}-${invoice.expeditionPoint}-${invoice.docNumber}` : 'borrador';
          detalleFactura = ` Factura ${numero} ${sent?.ok ? `enviada por ${sent.channel}` : `NO enviada${sent?.detail ? ` (${sent.detail})` : ''}`}.`;
        } else {
          const r = await this.notifyAccount(ctx, g.customerId, until, nombrePeriodo(period));
          notifiedCustomer = r.ok;
          detalleFactura = r.ok ? ` Resumen enviado al cliente por ${r.channel}.` : ` No se pudo enviar el resumen${r.detail ? ` (${r.detail})` : ''}.`;
        }
      } catch (error) {
        detalleFactura = ` Atencion: ${error instanceof Error ? error.message : String(error)}.`;
        this.logger.warn(`cierre mensual: cliente ${g.customerId} tenant=${tenantId}: ${detalleFactura}`);
      }
      const aviso =
        `Cuenta de ${nombrePeriodo(period)} de ${nombre}: ${fmtGs(total)} en ${g._count._all} consumo${g._count._all === 1 ? '' : 's'}.` +
        detalleFactura +
        (invoiceId ? '' : ' Facturala desde Facturación → Cuentas del mes.');
      await this.notifier.owner(tenantId, g.customerId, aviso, `${nombreNegocio}: cuenta del mes de ${nombre}`);
      await this.appDb.tx(ctx, (tx) =>
        tx.billingStatement.update({
          where: { id: statement.id },
          data: {
            invoiceId,
            notifiedCustomerAt: notifiedCustomer ? new Date() : null,
            notifiedOwnerAt: new Date(),
          },
        }),
      );
      this.logger.log(`cierre mensual tenant=${tenantId} cliente=${g.customerId} periodo=${period} total=${total}`);
      procesados++;
    }
    return procesados;
  }
}
