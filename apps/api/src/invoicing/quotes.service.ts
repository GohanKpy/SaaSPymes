import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { TenantContext, TenantTx } from '@pymes/db';
import type { QuoteCreate, QuoteListQuery, QuoteUpdate } from '@pymes/shared';
import PDFDocument from 'pdfkit';

import { AppPrisma } from '../prisma/app-prisma.service';
import { resolveItems, taxPortion, type ResolvedItem } from './invoices.service';

const money = (v: bigint | number) => new Intl.NumberFormat('es-PY').format(Number(v));

// Geometria A4 con margen 40 (misma que el KuDE).
const LEFT = 40;
const RIGHT = 555;
const WIDTH = RIGHT - LEFT;

/** Transiciones manuales permitidas (invoiced solo via convert). */
const TRANSITIONS: Record<string, string[]> = {
  draft: ['sent'],
  sent: ['accepted', 'rejected'],
  accepted: ['sent'],
  rejected: ['sent'],
};

/**
 * Presupuestos formales (P1 replanteo 2026-08-26): espejo liviano de la
 * factura SIN caracter fiscal. Numeracion propia por tenant (P-0001...),
 * items congelados al guardar y conversion a borrador de factura que entra
 * al circuito fiscal normal (emitir/pagar/KuDE).
 */
@Injectable()
export class QuotesService {
  constructor(private readonly appDb: AppPrisma) {}

  list(ctx: TenantContext, query: QuoteListQuery) {
    return this.appDb.tx(ctx, (tx) =>
      tx.quote.findMany({
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
    const quote = await this.appDb.tx(ctx, (tx) =>
      tx.quote.findFirst({
        where: { id },
        include: { items: true, customer: true, branch: true },
      }),
    );
    if (!quote) throw new NotFoundException();
    return quote;
  }

  async create(ctx: TenantContext, dto: QuoteCreate) {
    return this.appDb.tx(ctx, async (tx) => {
      const items = await resolveItems(tx, dto.items);
      const totals = this.totals(items);
      // Numeracion correlativa simple por tenant, bajo lock (sin huecos
      // fiscales que cuidar: es solo un identificador comercial).
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${ctx.tenantId}:quotes`}, 0))`;
      const last = await tx.quote.findFirst({ orderBy: { number: 'desc' }, select: { number: true } });
      const quote = await tx.quote.create({
        data: {
          tenantId: ctx.tenantId,
          branchId: dto.branch_id,
          customerId: dto.customer_id,
          number: (last?.number ?? 0) + 1,
          validUntil: dto.valid_until ? new Date(dto.valid_until) : undefined,
          notes: dto.notes,
          createdBy: ctx.userId,
          ...totals,
        },
      });
      await this.writeItems(tx, ctx.tenantId, quote.id, items);
      return tx.quote.findFirst({ where: { id: quote.id }, include: { items: true } });
    });
  }

  async update(ctx: TenantContext, id: string, dto: QuoteUpdate) {
    return this.appDb.tx(ctx, async (tx) => {
      const quote = await tx.quote.findFirst({ where: { id } });
      if (!quote) throw new NotFoundException();

      if (dto.status) {
        if (!TRANSITIONS[quote.status]?.includes(dto.status)) {
          throw new ConflictException({
            title: `Un presupuesto ${quote.status} no puede pasar a ${dto.status}`,
          });
        }
        return tx.quote.update({ where: { id }, data: { status: dto.status }, include: { items: true } });
      }

      if (quote.status !== 'draft') {
        throw new ConflictException({ title: 'Solo los borradores se editan; crea uno nuevo' });
      }
      if (dto.items) {
        const items = await resolveItems(tx, dto.items);
        await tx.quoteItem.deleteMany({ where: { quoteId: id } });
        await this.writeItems(tx, ctx.tenantId, id, items);
        await tx.quote.update({ where: { id }, data: this.totals(items) });
      }
      return tx.quote.update({
        where: { id },
        data: {
          validUntil:
            dto.valid_until === undefined ? undefined : dto.valid_until ? new Date(dto.valid_until) : null,
          notes: dto.notes,
        },
        include: { items: true },
      });
    });
  }

  /** Borradores se borran; el resto queda como registro comercial. */
  async remove(ctx: TenantContext, id: string): Promise<void> {
    await this.appDb.tx(ctx, async (tx) => {
      const quote = await tx.quote.findFirst({ where: { id } });
      if (!quote) throw new NotFoundException();
      if (quote.status !== 'draft') {
        throw new ConflictException({ title: 'Solo se borran borradores' });
      }
      await tx.quoteItem.deleteMany({ where: { quoteId: id } });
      await tx.quote.delete({ where: { id } });
    });
  }

  /** quote → borrador de factura con los items congelados del presupuesto. */
  async convertToInvoice(ctx: TenantContext, id: string) {
    return this.appDb.tx(ctx, async (tx) => {
      const quote = await tx.quote.findFirst({ where: { id }, include: { items: true } });
      if (!quote) throw new NotFoundException();
      if (quote.status === 'invoiced') {
        throw new ConflictException({ title: 'Este presupuesto ya se facturo' });
      }
      if (quote.status === 'rejected') {
        throw new ConflictException({ title: 'Un presupuesto rechazado no se factura' });
      }
      const invoice = await tx.invoice.create({
        data: {
          tenantId: ctx.tenantId,
          branchId: quote.branchId,
          customerId: quote.customerId,
          createdBy: ctx.userId,
          subtotal: quote.subtotal,
          taxTotal: quote.taxTotal,
          total: quote.total,
        },
      });
      await tx.invoiceItem.createMany({
        data: quote.items.map((i) => ({
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
      await tx.quote.update({
        where: { id },
        data: { status: 'invoiced', invoiceId: invoice.id },
      });
      return tx.invoice.findFirst({ where: { id: invoice.id }, include: { items: true } });
    });
  }

  /** PDF del presupuesto: mismo lenguaje visual que el KuDE, sin datos fiscales. */
  async pdf(ctx: TenantContext, id: string): Promise<{ pdf: Buffer; filename: string }> {
    const data = await this.appDb.tx(ctx, async (tx) => {
      const quote = await tx.quote.findFirst({
        where: { id },
        include: { items: true, customer: true, branch: true },
      });
      if (!quote) throw new NotFoundException();
      const tenant = await tx.tenant.findUnique({
        where: { id: ctx.tenantId },
        select: { legalName: true, tradeName: true, ruc: true, timezone: true, branding: true },
      });
      return { quote, tenant };
    });

    const { quote, tenant } = data;
    const tz = tenant?.timezone ?? 'America/Asuncion';
    const branding = (tenant?.branding ?? {}) as { logo?: string; actividad?: string; email_facturacion?: string };
    const numero = `P-${String(quote.number).padStart(4, '0')}`;

    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((resolve) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
    });

    // ---- Banda de titulo ----
    doc.rect(LEFT, 40, WIDTH, 20).fillAndStroke('#eeeeee', '#444444');
    doc
      .fillColor('#111111')
      .font('Helvetica-Bold')
      .fontSize(11)
      .text('PRESUPUESTO', LEFT, 46, { width: WIDTH, align: 'center' });

    // ---- Caja del emisor + caja del numero ----
    const headTop = 60;
    const headH = 96;
    doc.rect(LEFT, headTop, WIDTH, headH).stroke('#444444');
    const boxW = 180;
    const boxX = RIGHT - boxW;
    doc.moveTo(boxX, headTop).lineTo(boxX, headTop + headH).stroke('#444444');

    let textX = LEFT + 10;
    const logo = this.decodeLogo(branding.logo);
    if (logo) {
      try {
        doc.image(logo, LEFT + 8, headTop + 14, { fit: [70, 68] });
        textX = LEFT + 88;
      } catch {
        // logo corrupto: el PDF sale igual, sin imagen
      }
    }
    doc.font('Helvetica-Bold').fontSize(12).fillColor('#111111');
    doc.text(tenant?.tradeName ?? tenant?.legalName ?? '', textX, headTop + 10, { width: boxX - textX - 8 });
    doc.font('Helvetica').fontSize(8).fillColor('#333333');
    doc.text(tenant?.legalName ?? '', { width: boxX - textX - 8 });
    if (branding.actividad) doc.text(`Actividad Economica: ${branding.actividad}`, { width: boxX - textX - 8 });
    if (tenant?.ruc) doc.text(`RUC: ${tenant.ruc}`);
    if (quote.branch?.address) doc.text(quote.branch.address, { width: boxX - textX - 8 });
    if (quote.branch?.phone) doc.text(`Tel: ${quote.branch.phone}`);
    if (branding.email_facturacion) doc.text(branding.email_facturacion);

    doc.font('Helvetica-Bold').fontSize(11).fillColor('#111111');
    doc.text('PRESUPUESTO', boxX + 10, headTop + 16, { width: boxW - 20, align: 'center' });
    doc.fontSize(13).text(numero, boxX + 10, doc.y + 2, { width: boxW - 20, align: 'center' });
    doc.font('Helvetica').fontSize(8.5);
    doc.text(`Fecha: ${quote.createdAt.toLocaleDateString('es-PY', { timeZone: tz })}`, boxX + 10, doc.y + 8, {
      width: boxW - 20,
      align: 'center',
    });
    if (quote.validUntil) {
      doc.text(`Valido hasta: ${quote.validUntil.toLocaleDateString('es-PY', { timeZone: 'UTC' })}`, boxX + 10, doc.y + 2, {
        width: boxW - 20,
        align: 'center',
      });
    }

    // ---- Datos del cliente ----
    const recTop = headTop + headH + 6;
    const recH = 50;
    doc.rect(LEFT, recTop, WIDTH, recH).stroke('#444444');
    const c = quote.customer;
    const docCliente =
      c.docNumber != null
        ? `${(c.docType ?? 'ci').toUpperCase()} ${c.docNumber}${c.rucDv ? `-${c.rucDv}` : ''}`
        : '—';
    doc.font('Helvetica').fontSize(8.5).fillColor('#111111');
    let ry = recTop + 8;
    for (const [label, value] of [
      ['Cliente', `${c.firstName} ${c.lastName ?? ''}`.trim()],
      ['Documento', docCliente],
      ['Contacto', [c.phoneE164, c.email].filter(Boolean).join(' · ') || '—'],
    ] as const) {
      doc.font('Helvetica-Bold').text(`${label}:`, LEFT + 10, ry, { continued: true });
      doc.font('Helvetica').text(` ${value}`);
      ry += 13;
    }

    // ---- Tabla de items ----
    const tabTop = recTop + recH + 6;
    const cols = [
      { label: 'CONCEPTO', x: LEFT, w: 285, align: 'left' as const },
      { label: 'PRECIO UNIT.', x: LEFT + 285, w: 90, align: 'right' as const },
      { label: 'CANT.', x: LEFT + 375, w: 50, align: 'right' as const },
      { label: 'TOTAL', x: LEFT + 425, w: 90, align: 'right' as const },
    ];
    const headRowH = 16;
    doc.rect(LEFT, tabTop, WIDTH, headRowH).fillAndStroke('#eeeeee', '#444444');
    doc.fillColor('#111111').font('Helvetica-Bold').fontSize(8);
    for (const col of cols) doc.text(col.label, col.x + 4, tabTop + 5, { width: col.w - 8, align: col.align });

    doc.font('Helvetica').fontSize(8.5);
    let y = tabTop + headRowH;
    for (const item of quote.items) {
      const rowH = 16;
      const values = [item.description, money(item.unitPrice), String(Number(item.quantity)), money(item.lineTotal)];
      doc.rect(LEFT, y, WIDTH, rowH).stroke('#bbbbbb');
      values.forEach((value, i) => {
        const col = cols[i];
        if (!col) return;
        doc.text(value, col.x + 4, y + 4, { width: col.w - 8, align: col.align });
      });
      y += rowH;
    }
    for (const col of cols.slice(1)) {
      doc.moveTo(col.x, tabTop).lineTo(col.x, y).stroke('#bbbbbb');
    }

    const subH = 16;
    doc.rect(LEFT, y, WIDTH, subH).stroke('#444444');
    doc.font('Helvetica-Bold').fontSize(9.5);
    doc.text('TOTAL:', LEFT + 4, y + 3, { width: WIDTH - 98, align: 'right' });
    doc.text(`${money(quote.total)} Gs`, RIGHT - 92, y + 3, { width: 88, align: 'right' });
    y += subH;
    doc.font('Helvetica').fontSize(8);
    doc.text(`Los precios incluyen IVA (IVA contenido: ${money(quote.taxTotal)} Gs).`, LEFT, y + 6);
    y += 20;

    if (quote.notes) {
      doc.font('Helvetica-Bold').fontSize(8.5).text('Observaciones:', LEFT, y + 4);
      doc.font('Helvetica').text(quote.notes, LEFT, doc.y + 2, { width: WIDTH });
      y = doc.y + 8;
    }

    doc.font('Helvetica').fontSize(7.5).fillColor('#555555');
    doc.text(
      'Este presupuesto no es un comprobante fiscal. Los precios pueden variar vencido el plazo de validez.',
      LEFT,
      y + 10,
      { width: WIDTH },
    );

    doc.end();
    return { pdf: await done, filename: `presupuesto-${numero}.pdf` };
  }

  private totals(items: ResolvedItem[]) {
    const total = items.reduce((acc, i) => acc + i.lineTotal, 0n);
    const taxTotal = items.reduce((acc, i) => acc + taxPortion(i.lineTotal, i.taxRate), 0n);
    return { subtotal: total - taxTotal, taxTotal, total };
  }

  private writeItems(tx: TenantTx, tenantId: string, quoteId: string, items: ResolvedItem[]) {
    return tx.quoteItem.createMany({
      data: items.map((i) => ({
        tenantId,
        quoteId,
        serviceId: i.serviceId,
        description: i.description,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        taxRate: i.taxRate,
        lineTotal: i.lineTotal,
      })),
    });
  }

  private decodeLogo(logo: string | undefined): Buffer | null {
    if (!logo) return null;
    const match = /^data:image\/(?:png|jpeg);base64,(.+)$/.exec(logo);
    if (!match?.[1]) return null;
    try {
      return Buffer.from(match[1], 'base64');
    } catch {
      return null;
    }
  }
}
