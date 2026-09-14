import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { TenantContext } from '@pymes/db';
import type { ReturnComplete, ReturnCreate, ReturnDecide, ReturnListQuery } from '@pymes/shared';

import { InventoryService } from '../inventory/inventory.service';
import { NotifierService } from '../notifications/notifier.service';
import { AppPrisma } from '../prisma/app-prisma.service';

// Devoluciones (pedido de Johan 2026-09-14): la gestion es interna. El bot
// solo registra el pedido y deriva; una persona lo revisa, decide (con nota)
// y lo cierra, reingresando la mercaderia y/o emitiendo la nota de credito.

const INCLUDE = {
  customer: { select: { id: true, firstName: true, lastName: true, phoneE164: true, email: true, notifyWhatsapp: true, notifyEmail: true } },
  invoice: { select: { id: true, establishment: true, expeditionPoint: true, docNumber: true, total: true, status: true, branchId: true } },
  service: { select: { id: true, name: true, trackStock: true, isCombo: true } },
  creditNote: { select: { id: true, establishment: true, expeditionPoint: true, docNumber: true, total: true, status: true } },
} as const;

@Injectable()
export class ReturnsService {
  private readonly logger = new Logger('Returns');

  constructor(
    private readonly appDb: AppPrisma,
    private readonly notifier: NotifierService,
    private readonly inventory: InventoryService,
  ) {}

  async list(ctx: TenantContext, q: ReturnListQuery) {
    return this.appDb.tx(ctx, async (tx) => {
      let cursor: { createdAt: Date; id: string } | null = null;
      if (q.cursor) {
        const [at, id] = q.cursor.split('|');
        if (at && id) cursor = { createdAt: new Date(at), id };
      }
      const rows = await tx.returnRequest.findMany({
        where: {
          ...(q.status ? { status: q.status } : {}),
          ...(q.customer_id ? { customerId: q.customer_id } : {}),
          ...(cursor ? { OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] } : {}),
        },
        include: INCLUDE,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: q.limit + 1,
      });
      const page = rows.slice(0, q.limit);
      const last = page[page.length - 1];
      const pendientes = await tx.returnRequest.count({ where: { status: { in: ['requested', 'reviewing'] } } });
      return { data: page, next_cursor: rows.length > q.limit && last ? `${last.createdAt.toISOString()}|${last.id}` : null, pending: pendientes };
    });
  }

  async get(ctx: TenantContext, id: string) {
    const row = await this.appDb.tx(ctx, (tx) => tx.returnRequest.findFirst({ where: { id }, include: INCLUDE }));
    if (!row) throw new NotFoundException();
    return row;
  }

  /**
   * Registra el pedido (panel o bot) y avisa al equipo: tarea en la ficha del
   * cliente (vence hoy) + correo a los emails de aviso. La conversacion la
   * marca "necesita humano" el bot cuando viene por chat.
   */
  async create(ctx: TenantContext, dto: ReturnCreate, via: 'panel' | 'bot', extra: { conversationId?: string | null } = {}) {
    const row = await this.appDb.tx(ctx, async (tx) => {
      const customer = await tx.customer.findFirst({ where: { id: dto.customer_id, deletedAt: null } });
      if (!customer) throw new NotFoundException({ title: 'El cliente no existe' });
      if (dto.invoice_id) {
        const inv = await tx.invoice.findFirst({ where: { id: dto.invoice_id, customerId: dto.customer_id } });
        if (!inv) throw new NotFoundException({ title: 'La factura no es de este cliente' });
      }
      return tx.returnRequest.create({
        data: {
          tenantId: ctx.tenantId,
          customerId: dto.customer_id,
          conversationId: extra.conversationId ?? null,
          invoiceId: dto.invoice_id ?? null,
          serviceId: dto.service_id ?? null,
          description: dto.description,
          reason: dto.reason ?? null,
          createdVia: via,
        },
        include: INCLUDE,
      });
    });
    const nombre = `${row.customer.firstName} ${row.customer.lastName ?? ''}`.trim();
    const origen = via === 'bot' ? 'por WhatsApp (bot)' : 'desde el panel';
    await this.notifier.owner(
      ctx.tenantId,
      row.customerId,
      `Devolución solicitada ${origen} por ${nombre}: ${row.description}${row.reason ? ` (motivo: ${row.reason})` : ''}. Revisarla y decidir en Facturación → Devoluciones. Caso sensible: responder con cuidado.`,
      `Devolución solicitada por ${nombre}`,
    );
    return row;
  }

  /** Decision de una persona del equipo; avisa al cliente por su canal. */
  async decide(ctx: TenantContext, id: string, dto: ReturnDecide) {
    const row = await this.appDb.tx(ctx, async (tx) => {
      const actual = await tx.returnRequest.findFirst({ where: { id } });
      if (!actual) throw new NotFoundException();
      if (['completed'].includes(actual.status)) throw new ConflictException({ title: 'La devolución ya está cerrada' });
      return tx.returnRequest.update({
        where: { id },
        data: {
          status: dto.decision,
          resolution: dto.note,
          handledBy: ctx.userId ?? null,
          decidedAt: dto.decision === 'reviewing' ? actual.decidedAt : new Date(),
        },
        include: INCLUDE,
      });
    });
    if (dto.notify_customer) await this.avisarCliente(ctx.tenantId, row, dto.decision, dto.note);
    return row;
  }

  /** Cierre: reingreso al stock y/o nota de credito vinculada. */
  async complete(ctx: TenantContext, id: string, dto: ReturnComplete) {
    const row = await this.appDb.tx(ctx, async (tx) => {
      const actual = await tx.returnRequest.findFirst({ where: { id } });
      if (!actual) throw new NotFoundException();
      if (actual.status !== 'approved') throw new ConflictException({ title: 'Solo se cierra una devolución aprobada' });
      if (dto.restock) {
        await this.inventory.registrar(
          tx,
          ctx.tenantId,
          {
            serviceId: dto.restock.service_id,
            branchId: dto.restock.branch_id,
            kind: 'return',
            quantity: dto.restock.quantity,
            referenceType: 'return_request',
            referenceId: id,
            note: 'Devolución de cliente',
            createdBy: ctx.userId ?? null,
          },
          { allowNegative: true },
        );
      }
      if (dto.credit_note_id) {
        const nc = await tx.invoice.findFirst({ where: { id: dto.credit_note_id, docType: 'nota_credito' } });
        if (!nc) throw new NotFoundException({ title: 'La nota de crédito no existe' });
      }
      return tx.returnRequest.update({
        where: { id },
        data: {
          status: 'completed',
          completedAt: new Date(),
          resolution: dto.note ? `${actual.resolution ?? ''}\n${dto.note}`.trim() : actual.resolution,
          restockedAt: dto.restock ? new Date() : actual.restockedAt,
          creditNoteId: dto.credit_note_id ?? actual.creditNoteId,
          handledBy: ctx.userId ?? actual.handledBy,
        },
        include: INCLUDE,
      });
    });
    if (dto.notify_customer) await this.avisarCliente(ctx.tenantId, row, 'completed', dto.note ?? '');
    return row;
  }

  private async avisarCliente(
    tenantId: string,
    row: { description: string; customer: { firstName: string; phoneE164: string | null; email: string | null; notifyWhatsapp: boolean; notifyEmail: boolean } },
    decision: 'approved' | 'rejected' | 'reviewing' | 'completed',
    nota: string,
  ): Promise<void> {
    const tenant = await this.appDb.tx({ tenantId, actorType: 'system' }, (tx) => tx.tenant.findUnique({ where: { id: tenantId }, select: { tradeName: true, legalName: true } }));
    const negocio = tenant?.tradeName ?? tenant?.legalName ?? 'el negocio';
    const que = row.description.length > 80 ? `${row.description.slice(0, 77)}…` : row.description;
    const textos: Record<typeof decision, string> = {
      reviewing: `Hola ${row.customer.firstName}! Te escribimos de ${negocio}. Estamos revisando tu pedido de devolución (${que}). ${nota} Te respondemos por acá a la brevedad.`,
      approved: `Hola ${row.customer.firstName}! Te escribimos de ${negocio}. Revisamos tu pedido de devolución (${que}) y está aprobado. ${nota} Coordinamos por acá los pasos que siguen.`,
      rejected: `Hola ${row.customer.firstName}! Te escribimos de ${negocio}. Revisamos tu pedido de devolución (${que}) y en este caso no podemos aceptarlo. Motivo: ${nota} Si querés conversarlo, respondé por acá y una persona del equipo te atiende.`,
      completed: `Hola ${row.customer.firstName}! Tu devolución (${que}) quedó resuelta. ${nota} Gracias por tu paciencia.`,
    };
    const body = textos[decision].replace(/\s+/g, ' ').trim();
    try {
      if (row.customer.phoneE164 && row.customer.notifyWhatsapp) await this.notifier.whatsapp(tenantId, row.customer.phoneE164, body);
      else if (row.customer.email && row.customer.notifyEmail) await this.notifier.email(row.customer.email, `${negocio}: tu pedido de devolución`, body);
    } catch (error) {
      this.logger.warn(`aviso de devolución fallo tenant=${tenantId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
