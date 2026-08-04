import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { TenantContext } from '@pymes/db';
import type { CustomerCreate, CustomerListQuery, CustomerUpdate, Page } from '@pymes/shared';

import { decodeCursor, encodeCursor } from '../common/pagination';
import { AppPrisma } from '../prisma/app-prisma.service';

@Injectable()
export class CustomersService {
  constructor(private readonly appDb: AppPrisma) {}

  /** Busqueda por nombre (trigram via ILIKE), telefono, documento o email. */
  async list(ctx: TenantContext, query: CustomerListQuery): Promise<Page<unknown>> {
    const cursorId = decodeCursor(query.cursor);
    const rows = await this.appDb.tx(ctx, (tx) =>
      tx.customer.findMany({
        where: {
          deletedAt: null,
          ...(query.q
            ? {
                OR: [
                  { firstName: { contains: query.q, mode: 'insensitive' } },
                  { lastName: { contains: query.q, mode: 'insensitive' } },
                  { phoneE164: { contains: query.q } },
                  { docNumber: { contains: query.q } },
                  { email: { contains: query.q, mode: 'insensitive' } },
                ],
              }
            : {}),
        },
        orderBy: { id: 'asc' },
        take: query.limit + 1,
        ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
      }),
    );
    const hasMore = rows.length > query.limit;
    const data = hasMore ? rows.slice(0, query.limit) : rows;
    const last = data[data.length - 1];
    return { data, next_cursor: hasMore && last ? encodeCursor(last.id) : null };
  }

  async create(ctx: TenantContext, dto: CustomerCreate) {
    // La unicidad real la garantizan los indices parciales; el 409
    // informativo con referencia al existente sale de este chequeo previo.
    return this.appDb.tx(ctx, async (tx) => {
      const clash = await tx.customer.findFirst({
        where: {
          deletedAt: null,
          OR: [
            ...(dto.phone_e164 ? [{ phoneE164: dto.phone_e164 }] : []),
            ...(dto.email ? [{ email: dto.email }] : []),
            ...(dto.doc_number ? [{ docType: dto.doc_type, docNumber: dto.doc_number }] : []),
          ],
        },
      });
      if (clash) {
        throw new ConflictException({
          type: 'https://docs.pymes.local/errors/duplicate-customer',
          title: 'Ya existe un cliente con ese telefono, email o documento',
          detail: clash.id,
        });
      }
      return tx.customer.create({
        data: { tenantId: ctx.tenantId, ...mapCustomer(dto), firstName: dto.first_name },
      });
    });
  }

  async get(ctx: TenantContext, id: string) {
    const customer = await this.appDb.tx(ctx, (tx) =>
      tx.customer.findFirst({ where: { id, deletedAt: null } }),
    );
    if (!customer) throw new NotFoundException();
    return customer;
  }

  async update(ctx: TenantContext, id: string, dto: CustomerUpdate) {
    return this.appDb.tx(ctx, async (tx) => {
      const existing = await tx.customer.findFirst({ where: { id, deletedAt: null } });
      if (!existing) throw new NotFoundException();
      return tx.customer.update({ where: { id }, data: mapCustomer(dto) });
    });
  }

  /** Soft delete; 409 si tiene facturas: se desactiva, no se borra (doc 04 §3.4). */
  async remove(ctx: TenantContext, id: string): Promise<void> {
    await this.appDb.tx(ctx, async (tx) => {
      const existing = await tx.customer.findFirst({ where: { id, deletedAt: null } });
      if (!existing) throw new NotFoundException();
      const invoices = await tx.invoice.count({ where: { customerId: id } });
      if (invoices > 0) {
        throw new ConflictException({ title: 'El cliente tiene facturas: desactivar, no borrar' });
      }
      await tx.customer.update({ where: { id }, data: { deletedAt: new Date() } });
    });
  }

  /** Vista unificada: visitas, servicios, facturas (doc 03 §6). */
  async history(ctx: TenantContext, id: string) {
    await this.get(ctx, id);
    return this.appDb.tx(ctx, (tx) =>
      tx.$queryRaw`
        SELECT customer_id, starts_at, visit_status, service_name,
               invoice_id, total, invoice_status
        FROM app.customer_history
        WHERE customer_id = ${id}::uuid
        ORDER BY starts_at DESC
        LIMIT 200`,
    );
  }

  /** Une un duplicado (source) sobre este registro; operacion auditada. */
  async merge(ctx: TenantContext, targetId: string, sourceId: string) {
    if (targetId === sourceId) throw new ConflictException({ title: 'No se puede unir consigo mismo' });
    return this.appDb.tx(ctx, async (tx) => {
      const [target, source] = await Promise.all([
        tx.customer.findFirst({ where: { id: targetId, deletedAt: null } }),
        tx.customer.findFirst({ where: { id: sourceId, deletedAt: null } }),
      ]);
      if (!target || !source) throw new NotFoundException();

      await tx.appointment.updateMany({ where: { customerId: sourceId }, data: { customerId: targetId } });
      await tx.invoice.updateMany({ where: { customerId: sourceId }, data: { customerId: targetId } });
      // Una conversacion viva por telefono: la del duplicado se re-vincula.
      await tx.conversation.updateMany({ where: { customerId: sourceId }, data: { customerId: targetId } });
      await tx.customer.update({
        where: { id: sourceId },
        data: { deletedAt: new Date(), notes: `[merge] unido a ${targetId}` },
      });
      await tx.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorUserId: ctx.userId,
          action: 'customer.merge',
          entity: 'customers',
          entityId: targetId,
          before: { source_id: sourceId },
        },
      });
      return tx.customer.findFirst({ where: { id: targetId } });
    });
  }
}

function mapCustomer(dto: CustomerCreate | CustomerUpdate) {
  return {
    firstName: dto.first_name,
    lastName: dto.last_name,
    docType: dto.doc_type,
    docNumber: dto.doc_number,
    rucDv: dto.ruc_dv,
    email: dto.email,
    phoneE164: dto.phone_e164,
    birthDate: dto.birth_date ? new Date(dto.birth_date) : dto.birth_date,
    address: dto.address,
    notes: dto.notes,
    notifyWhatsapp: dto.notify_whatsapp,
    notifyEmail: dto.notify_email,
  };
}
