import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { TenantContext } from '@pymes/db';
import PDFDocument from 'pdfkit';
import { toBuffer } from 'qrcode';

import { AppPrisma } from '../prisma/app-prisma.service';

const money = (v: bigint | number) => new Intl.NumberFormat('es-PY').format(Number(v));

/**
 * KuDE: representacion grafica de la factura electronica (doc 04 §3.9).
 * En laboratorio el CDC es sintetico del provider fake; el layout ya sigue
 * el formato KuDE (datos del emisor, timbrado, items, IVA, CDC y QR de
 * consulta) para que con SIFEN real solo cambie el origen de los datos.
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
        select: { legalName: true, tradeName: true, ruc: true, timezone: true },
      });
      return { invoice, tenant };
    });

    const { invoice, tenant } = data;
    if (!invoice.cdc || !['approved', 'cancelled', 'credited'].includes(invoice.status)) {
      throw new UnprocessableEntityException({
        title: 'El KuDE existe solo para facturas emitidas (aprobadas por SIFEN)',
      });
    }

    const numero = `${invoice.establishment}-${invoice.expeditionPoint}-${invoice.docNumber}`;
    // QR de consulta publica del documento (formato e-Kuatia; host real con SIFEN productivo)
    const qrPayload = `https://ekuatia.set.gov.py/consultas/qr?cdc=${invoice.cdc}`;
    const qr = await toBuffer(qrPayload, { margin: 1, width: 110 });

    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((resolve) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
    });

    // Encabezado del emisor
    doc.fontSize(15).font('Helvetica-Bold').text(tenant?.tradeName ?? tenant?.legalName ?? '');
    doc.fontSize(9).font('Helvetica').fillColor('#444444');
    doc.text(tenant?.legalName ?? '');
    if (tenant?.ruc) doc.text(`RUC: ${tenant.ruc}`);
    doc.text(`Sucursal: ${invoice.branch?.name ?? ''}`);

    // Recuadro del documento
    doc.fillColor('#000000').moveDown(0.5);
    const boxTop = doc.y;
    doc.rect(360, 40, 195, 84).stroke();
    doc.fontSize(9).text(`Timbrado N° ${invoice.timbrado ?? ''}`, 368, 48, { width: 180 });
    doc.text(`Inicio de vigencia: —`, { width: 180 });
    doc.font('Helvetica-Bold').fontSize(11).text('FACTURA ELECTRONICA', { width: 180 });
    doc.fontSize(11).text(numero, { width: 180 });
    doc.font('Helvetica').fontSize(9);
    doc.y = Math.max(doc.y, boxTop);

    // Datos del receptor y de la operacion
    doc.moveDown(1);
    doc.x = 40;
    const issued = invoice.issuedAt ?? invoice.createdAt;
    doc.text(
      `Fecha de emision: ${issued.toLocaleString('es-PY', { timeZone: tenant?.timezone ?? 'America/Asuncion', hour12: false })}`,
    );
    const cliente = `${invoice.customer.firstName} ${invoice.customer.lastName ?? ''}`.trim();
    doc.text(`Cliente: ${cliente}`);
    if (invoice.customer.docNumber) {
      doc.text(`${(invoice.customer.docType ?? 'ci').toUpperCase()}: ${invoice.customer.docNumber}${invoice.customer.rucDv ? `-${invoice.customer.rucDv}` : ''}`);
    }
    doc.text(`Moneda: ${invoice.currency} · Condicion: contado`);

    // Tabla de items
    doc.moveDown(1);
    const col = { desc: 40, qty: 330, unit: 380, iva: 455, total: 495 } as const;
    doc.font('Helvetica-Bold');
    doc.text('Descripcion', col.desc, doc.y, { continued: false });
    const headerY = doc.y - 11;
    doc.text('Cant.', col.qty, headerY);
    doc.text('P. unit.', col.unit, headerY);
    doc.text('IVA', col.iva, headerY);
    doc.text('Total', col.total, headerY);
    doc.moveTo(40, doc.y + 2).lineTo(555, doc.y + 2).stroke();
    doc.font('Helvetica');
    for (const item of invoice.items) {
      const y = doc.y + 4;
      doc.text(item.description, col.desc, y, { width: 280 });
      const rowY = y;
      doc.text(String(item.quantity), col.qty, rowY);
      doc.text(money(item.unitPrice), col.unit, rowY);
      doc.text(`${item.taxRate}%`, col.iva, rowY);
      doc.text(money(item.lineTotal), col.total, rowY);
    }
    doc.moveTo(40, doc.y + 4).lineTo(555, doc.y + 4).stroke();

    // Totales (IVA incluido, doc 04 §3.9)
    doc.moveDown(1);
    doc.x = 380;
    doc.text(`Subtotal: ${money(invoice.subtotal)} Gs`);
    doc.text(`IVA: ${money(invoice.taxTotal)} Gs`);
    doc.font('Helvetica-Bold').fontSize(11).text(`TOTAL: ${money(invoice.total)} Gs`);
    doc.font('Helvetica').fontSize(9);

    // Estado (anulada cruza el documento)
    if (invoice.status === 'cancelled') {
      doc.save();
      doc.rotate(-25, { origin: [300, 400] });
      doc.fontSize(52).fillColor('#cc0000').opacity(0.35).text('ANULADA', 140, 380);
      doc.restore();
      doc.opacity(1).fillColor('#000000').fontSize(9);
    }

    // Pie KuDE: CDC + QR de consulta
    doc.x = 40;
    doc.y = 700;
    doc.moveTo(40, 695).lineTo(555, 695).stroke();
    doc.image(qr, 40, 705, { width: 80 });
    doc.fontSize(8).text('Consulte la validez de este documento con el CDC en:', 130, 710);
    doc.text('https://ekuatia.set.gov.py/consultas (laboratorio: CDC sintetico)', 130);
    doc.font('Helvetica-Bold').text(`CDC: ${invoice.cdc}`, 130, doc.y + 4);
    doc.font('Helvetica').text(`KuDE generado el ${new Date().toLocaleString('es-PY', { timeZone: tenant?.timezone ?? 'America/Asuncion', hour12: false })}`, 130, doc.y + 4);

    doc.end();
    const pdf = await done;
    return { pdf, filename: `kude-${numero}.pdf` };
  }
}
