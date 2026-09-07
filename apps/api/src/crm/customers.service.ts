import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, type TenantContext, type TenantTx } from '@pymes/db';
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
          ...(query.tag ? { tags: { has: query.tag } } : {}),
          ...(query.source ? { source: query.source } : {}),
          ...(query.q
            ? {
                OR: [
                  { firstName: { contains: query.q, mode: 'insensitive' } },
                  { lastName: { contains: query.q, mode: 'insensitive' } },
                  { phoneE164: { contains: query.q } },
                  { docNumber: { contains: query.q } },
                  { email: { contains: query.q, mode: 'insensitive' } },
                  { companyName: { contains: query.q, mode: 'insensitive' } },
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
      await this.validateCustomData(tx, dto.custom_data);
      return tx.customer.create({
        data: { tenantId: ctx.tenantId, ...mapCustomer(dto), firstName: dto.first_name },
      });
    });
  }

  async get(ctx: TenantContext, id: string) {
    const customer = await this.appDb.tx(ctx, (tx) =>
      tx.customer.findFirst({
        where: { id, deletedAt: null },
        include: {
          contactPoints: { orderBy: [{ kind: 'asc' }, { sort: 'asc' }] },
          // A nombre de quien factura (2026-09-07): la ficha las administra.
          fiscalIds: { where: { deletedAt: null }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] },
        },
      }),
    );
    if (!customer) throw new NotFoundException();
    return customer;
  }

  async update(ctx: TenantContext, id: string, dto: CustomerUpdate) {
    return this.appDb.tx(ctx, async (tx) => {
      const existing = await tx.customer.findFirst({ where: { id, deletedAt: null } });
      if (!existing) throw new NotFoundException();
      await this.validateCustomData(tx, dto.custom_data);
      return tx.customer.update({ where: { id }, data: mapCustomer(dto) });
    });
  }

  /** custom_data solo acepta claves DEFINIDAS y activas del tenant, con el
   *  tipo declarado: el panel jamas guarda datos huerfanos ni mal tipados. */
  private async validateCustomData(
    tx: TenantTx,
    data: Record<string, string | number | boolean> | undefined,
  ): Promise<void> {
    if (!data || Object.keys(data).length === 0) return;
    const defs = await tx.customFieldDef.findMany({
      where: { entity: 'customer', isActive: true },
    });
    const porCode = new Map(defs.map((d) => [d.code, d]));
    for (const [code, value] of Object.entries(data)) {
      const def = porCode.get(code);
      if (!def) {
        throw new UnprocessableEntityException({
          title: `El campo personalizado '${code}' no existe (definilo primero en Ajustes)`,
        });
      }
      const esperado =
        def.fieldType === 'number' || def.fieldType === 'money'
          ? typeof value === 'number'
          : def.fieldType === 'boolean'
            ? typeof value === 'boolean'
            : typeof value === 'string';
      const opcionValida =
        def.fieldType !== 'list' ||
        (Array.isArray(def.options) && (def.options as unknown[]).includes(value));
      if (!esperado || !opcionValida) {
        throw new UnprocessableEntityException({
          title: `Valor invalido para el campo '${def.label}' (${def.fieldType})`,
        });
      }
    }
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
    // CRM extendido (2026-08-26)
    source: dto.source,
    sourceDetail: dto.source_detail,
    companyName: dto.company_name,
    jobTitle: dto.job_title,
    city: dto.city,
    tags: dto.tags,
    assignedUserId: dto.assigned_user_id,
    marketingOptIn: dto.marketing_opt_in,
    // Cuenta mensual (2026-09-07)
    billingMode: dto.billing_mode,
    invoiceChannel: dto.invoice_channel,
    rating: dto.rating,
    customData: dto.custom_data === undefined ? undefined : (dto.custom_data as Prisma.InputJsonValue),
  };
}
