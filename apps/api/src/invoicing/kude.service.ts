import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { TenantContext } from '@pymes/db';
import PDFDocument from 'pdfkit';
import { toBuffer } from 'qrcode';

import { AppPrisma } from '../prisma/app-prisma.service';
import { numeroALetras } from './letras';

const money = (v: bigint | number) => new Intl.NumberFormat('es-PY').format(Number(v));

// Geometria A4 con margen 40: contenido entre x=40 y x=555.
const LEFT = 40;
const RIGHT = 555;
const WIDTH = RIGHT - LEFT;

interface Branding {
  logo?: string;
  actividad?: string;
  email_facturacion?: string;
}

/**
 * KuDE: representacion grafica de la factura electronica (doc 04 §3.9),
 * con el layout del formato paraguayo: banda de titulo, caja del emisor
 * (logo + datos), caja de timbrado, datos del receptor, tabla con columnas
 * EXENTAS / IVA 5% / IVA 10%, total en letras, liquidacion de IVA y pie
 * con QR + CDC. En laboratorio el CDC es sintetico del provider fake.
 */
@Injectable()
export class KudeService {
  constructor(private readonly appDb: AppPrisma) {}

  async render(ctx: TenantContext, invoiceId: string): Promise<{ pdf: Buffer; filename: string }> {
    const data = await this.appDb.tx(ctx, async (tx) => {
      const invoice = await tx.invoice.findFirst({
        where: { id: invoiceId },
        include: { items: true, payments: true, customer: true, branch: true },
      });
      if (!invoice) throw new NotFoundException();
      const tenant = await tx.tenant.findUnique({
        where: { id: ctx.tenantId },
        select: { legalName: true, tradeName: true, ruc: true, timezone: true, branding: true },
      });
      const sifen = await tx.integrationCredential.findFirst({ where: { type: 'sifen' } });
      return { invoice, tenant, sifen };
    });

    const { invoice, tenant, sifen } = data;
    if (!invoice.cdc || !['approved', 'cancelled', 'credited'].includes(invoice.status)) {
      throw new UnprocessableEntityException({
        title: 'El KuDE existe solo para facturas emitidas (aprobadas por SIFEN)',
      });
    }

    const tz = tenant?.timezone ?? 'America/Asuncion';
    const branding = (tenant?.branding ?? {}) as Branding;
    const sifenConfig = (sifen?.publicConfig ?? {}) as { vigencia_desde?: string | null };
    const numero = `${invoice.establishment}-${invoice.expeditionPoint}-${invoice.docNumber}`;
    const qrPayload = `https://ekuatia.set.gov.py/consultas/qr?cdc=${invoice.cdc}`;
    const qr = await toBuffer(qrPayload, { margin: 1, width: 110 });

    const logo = this.decodeLogo(branding.logo);

    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((resolve) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
    });

    // ---- Banda de titulo -------------------------------------------------
    doc.rect(LEFT, 40, WIDTH, 20).fillAndStroke('#eeeeee', '#444444');
    doc
      .fillColor('#111111')
      .font('Helvetica-Bold')
      .fontSize(11)
      .text('KuDE DE FACTURA ELECTRONICA', LEFT, 46, { width: WIDTH, align: 'center' });

    // ---- Caja del emisor + caja de timbrado ------------------------------
    const headTop = 60;
    const headH = 96;
    doc.rect(LEFT, headTop, WIDTH, headH).stroke('#444444');
    const boxW = 180;
    const boxX = RIGHT - boxW;
    doc.moveTo(boxX, headTop).lineTo(boxX, headTop + headH).stroke('#444444');

    let textX = LEFT + 10;
    if (logo) {
      try {
        doc.image(logo, LEFT + 8, headTop + 14, { fit: [70, 68] });
        textX = LEFT + 88;
      } catch {
        // logo corrupto: el KuDE sale igual, sin imagen
      }
    }
    doc.font('Helvetica-Bold').fontSize(12).fillColor('#111111');
    doc.text(tenant?.tradeName ?? tenant?.legalName ?? '', textX, headTop + 10, {
      width: boxX - textX - 8,
    });
    doc.font('Helvetica').fontSize(8).fillColor('#333333');
    doc.text(tenant?.legalName ?? '', { width: boxX - textX - 8 });
    if (branding.actividad) {
      doc.text(`Actividad Economica: ${branding.actividad}`, { width: boxX - textX - 8 });
    }
    if (tenant?.ruc) doc.text(`RUC: ${tenant.ruc}`);
    if (invoice.branch?.address) doc.text(invoice.branch.address, { width: boxX - textX - 8 });
    if (invoice.branch?.phone) doc.text(`Tel: ${invoice.branch.phone}`);
    if (branding.email_facturacion) doc.text(branding.email_facturacion);

    doc.font('Helvetica').fontSize(9).fillColor('#111111');
    doc.text(`Timbrado N°: ${invoice.timbrado ?? '—'}`, boxX + 10, headTop + 12, { width: boxW - 20 });
    doc.text(
      `Inicio Vigencia: ${sifenConfig.vigencia_desde ? this.fecha(sifenConfig.vigencia_desde) : '—'}`,
      { width: boxW - 20 },
    );
    doc.moveDown(0.4);
    doc.font('Helvetica-Bold').fontSize(11);
    doc.text('FACTURA ELECTRONICA', boxX + 10, doc.y, { width: boxW - 20, align: 'center' });
    doc.fontSize(12).text(numero, boxX + 10, doc.y + 2, { width: boxW - 20, align: 'center' });

    // ---- Datos del receptor ----------------------------------------------
    const recTop = headTop + headH + 6;
    const recH = 64;
    doc.rect(LEFT, recTop, WIDTH, recH).stroke('#444444');
    const colSplit = LEFT + WIDTH / 2 + 30;

    const issued = invoice.issuedAt ?? invoice.createdAt;
    const c = invoice.customer;
    const docCliente =
      c.docNumber != null
        ? `${(c.docType ?? 'ci').toUpperCase()}: ${c.docNumber}${c.rucDv ? `-${c.rucDv}` : ''}`
        : null;

    doc.font('Helvetica').fontSize(8.5).fillColor('#111111');
    const rowsL: [string, string][] = [
      ['Fecha', issued.toLocaleString('es-PY', { timeZone: tz, hour12: false })],
      ['Nombre o Razon Social', `${c.firstName} ${c.lastName ?? ''}`.trim()],
      ['Direccion', c.address ?? '—'],
      ['Email', c.email ?? '—'],
    ];
    const rowsR: [string, string][] = [
      ['Condicion de Venta', 'CONTADO'],
      ['Tipo de Operacion', 'Prestacion de servicios'],
      [docCliente ? docCliente.split(':')[0] ?? 'Documento' : 'Documento', docCliente ? (docCliente.split(': ')[1] ?? '—') : '—'],
      ['Telefono', c.phoneE164 ?? '—'],
    ];
    let ry = recTop + 8;
    for (const [label, value] of rowsL) {
      doc.font('Helvetica-Bold').text(`${label}:`, LEFT + 10, ry, { continued: true, width: colSplit - LEFT - 20 });
      doc.font('Helvetica').text(` ${value}`);
      ry += 13;
    }
    ry = recTop + 8;
    for (const [label, value] of rowsR) {
      doc.font('Helvetica-Bold').text(`${label}:`, colSplit, ry, { continued: true, width: RIGHT - colSplit - 10 });
      doc.font('Helvetica').text(` ${value}`);
      ry += 13;
    }

    // ---- Tabla de items ---------------------------------------------------
    const tabTop = recTop + recH + 6;
    // Columnas: CONCEPTO | P.UNIT | CANT | EXENTAS | IVA 5% | IVA 10%
    const cols = [
      { label: 'CONCEPTO', x: LEFT, w: 205, align: 'left' as const },
      { label: 'PRECIO UNIT.', x: LEFT + 205, w: 75, align: 'right' as const },
      { label: 'CANT.', x: LEFT + 280, w: 45, align: 'right' as const },
      { label: 'EXENTAS', x: LEFT + 325, w: 63, align: 'right' as const },
      { label: 'IVA 5%', x: LEFT + 388, w: 63, align: 'right' as const },
      { label: 'IVA 10%', x: LEFT + 451, w: 64, align: 'right' as const },
    ];
    const headRowH = 16;
    doc.rect(LEFT, tabTop, WIDTH, headRowH).fillAndStroke('#eeeeee', '#444444');
    doc.fillColor('#111111').font('Helvetica-Bold').fontSize(8);
    for (const col of cols) {
      doc.text(col.label, col.x + 4, tabTop + 5, { width: col.w - 8, align: col.align });
    }

    doc.font('Helvetica').fontSize(8.5);
    let y = tabTop + headRowH;
    const sums = { exentas: 0n, iva5: 0n, iva10: 0n };
    for (const item of invoice.items) {
      const rowH = 16;
      const cells = this.itemCells(item);
      sums.exentas += cells.exentas;
      sums.iva5 += cells.iva5;
      sums.iva10 += cells.iva10;
      const values = [
        item.description,
        money(item.unitPrice),
        String(Number(item.quantity)),
        cells.exentas > 0n ? money(cells.exentas) : '0',
        cells.iva5 > 0n ? money(cells.iva5) : '0',
        cells.iva10 > 0n ? money(cells.iva10) : '0',
      ];
      doc.rect(LEFT, y, WIDTH, rowH).stroke('#bbbbbb');
      values.forEach((value, i) => {
        const col = cols[i];
        if (!col) return;
        doc.text(value, col.x + 4, y + 4, { width: col.w - 8, align: col.align });
      });
      y += rowH;
    }
    // Lineas verticales de la tabla
    for (const col of cols.slice(1)) {
      doc.moveTo(col.x, tabTop).lineTo(col.x, y).stroke('#bbbbbb');
    }

    // Sub-totales y total
    const subH = 16;
    doc.rect(LEFT, y, WIDTH, subH).stroke('#444444');
    doc.font('Helvetica-Bold');
    doc.text('SUB-TOTALES:', LEFT + 4, y + 4, { width: 325 - 8, align: 'right' });
    doc.text(money(sums.exentas), (cols[3]?.x ?? 0) + 4, y + 4, { width: (cols[3]?.w ?? 0) - 8, align: 'right' });
    doc.text(money(sums.iva5), (cols[4]?.x ?? 0) + 4, y + 4, { width: (cols[4]?.w ?? 0) - 8, align: 'right' });
    doc.text(money(sums.iva10), (cols[5]?.x ?? 0) + 4, y + 4, { width: (cols[5]?.w ?? 0) - 8, align: 'right' });
    y += subH;

    doc.rect(LEFT, y, WIDTH, subH).stroke('#444444');
    doc.fontSize(9.5);
    doc.text('TOTAL A PAGAR:', LEFT + 4, y + 3, { width: WIDTH - 90, align: 'right' });
    doc.text(`${money(invoice.total)}`, RIGHT - 84, y + 3, { width: 80, align: 'right' });
    y += subH;

    doc.rect(LEFT, y, WIDTH, subH).stroke('#444444');
    doc.fontSize(8.5);
    doc.text('TOTAL A PAGAR EN LETRAS:', LEFT + 4, y + 4, { continued: true });
    doc.font('Helvetica').text(` Guaranies ${numeroALetras(invoice.total)}`);
    y += subH;

    // Liquidacion de IVA (montos de IVA contenidos, IVA incluido: doc 04 §3.9).
    // Redondeo al guarani mas cercano, igual que el calculo de tax_total.
    const iva5 = Math.round(Number(sums.iva5) / 21);
    const iva10 = Math.round(Number(sums.iva10) / 11);
    doc.rect(LEFT, y, WIDTH, subH).stroke('#444444');
    doc.font('Helvetica-Bold').text('LIQUIDACION DE IVA:', LEFT + 4, y + 4, { continued: true });
    doc.font('Helvetica').text(
      `   5%: ${money(iva5)}      10%: ${money(iva10)}      TOTAL IVA: ${money(invoice.taxTotal)}`,
    );
    y += subH;

    // ---- Marca de anulada -------------------------------------------------
    if (invoice.status === 'cancelled') {
      doc.save();
      doc.rotate(-25, { origin: [300, 420] });
      doc.fontSize(56).fillColor('#cc0000').opacity(0.3);
      doc.text('ANULADA', 150, 400, { width: 400, align: 'center' });
      doc.restore();
      doc.opacity(1).fillColor('#111111');
    }

    // ---- Pie: QR + CDC ----------------------------------------------------
    const footTop = 700;
    doc.rect(LEFT, footTop, WIDTH, 96).stroke('#444444');
    doc.image(qr, LEFT + 8, footTop + 8, { width: 80 });
    const fx = LEFT + 100;
    doc.font('Helvetica').fontSize(8).fillColor('#111111');
    doc.text('Consulte la validez de esta FACTURA ELECTRONICA con el numero CDC impreso abajo en:', fx, footTop + 10, { width: RIGHT - fx - 10 });
    doc.fillColor('#1155cc').text('https://ekuatia.set.gov.py/consultas/', { width: RIGHT - fx - 10 });
    doc.fillColor('#111111').font('Helvetica-Bold').fontSize(9);
    doc.text(`CDC: ${invoice.cdc}`, fx, doc.y + 6, { width: RIGHT - fx - 10 });
    doc.font('Helvetica').fontSize(7.5).fillColor('#555555');
    doc.text(
      'ESTE DOCUMENTO ES UNA REPRESENTACION GRAFICA DE UN DOCUMENTO ELECTRONICO (XML). Laboratorio: CDC sintetico del provider fake.',
      fx,
      doc.y + 6,
      { width: RIGHT - fx - 10 },
    );
    doc.fontSize(7).text(
      `KuDE generado el ${new Date().toLocaleString('es-PY', { timeZone: tz, hour12: false })}`,
      fx,
      doc.y + 4,
    );

    doc.end();
    const pdf = await done;
    return { pdf, filename: `kude-${numero}.pdf` };
  }

  /** Reparte el total de la linea en la columna de su tasa (formato KuDE). */
  private itemCells(item: { taxRate: number; lineTotal: bigint }) {
    return {
      exentas: item.taxRate === 0 ? item.lineTotal : 0n,
      iva5: item.taxRate === 5 ? item.lineTotal : 0n,
      iva10: item.taxRate === 10 ? item.lineTotal : 0n,
    };
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

  private fecha(iso: string): string {
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  }
}
