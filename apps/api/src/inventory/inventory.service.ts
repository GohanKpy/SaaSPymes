import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { TenantContext, TenantTx } from '@pymes/db';
import type { MovementsQuery, StockAdjustment, StockEntry, StockMovementKind, StockQuery, StockTransfer } from '@pymes/shared';

import { NotifierService } from '../notifications/notifier.service';
import { AppPrisma } from '../prisma/app-prisma.service';

// Inventario fase 1 (2026-09-14, ADR 0013). El libro `stock_movements` es la
// verdad; `stock_levels` es el saldo materializado por item y sucursal, que
// se actualiza con lock de fila en la misma transaccion del movimiento.

const round2 = (n: number) => Math.round(n * 100) / 100;

export type ReferenciaStock = 'invoice' | 'credit_note' | 'return_request' | 'manual';

export interface MovimientoInput {
  serviceId: string;
  branchId: string;
  kind: StockMovementKind;
  /** Con signo: positivo entra, negativo sale. */
  quantity: number;
  unitCost?: bigint | null;
  referenceType?: ReferenciaStock;
  referenceId?: string | null;
  note?: string | null;
  createdBy?: string | null;
}

export interface Faltante {
  serviceId: string;
  name: string;
  requested: number;
  available: number;
}

export interface LineaVenta {
  serviceId: string | null;
  quantity: number;
}

/** Item bajo el minimo tras un movimiento (para avisar al dueno una vez, al cruzar). */
export interface AlertaStock {
  serviceId: string;
  name: string;
  total: number;
  min: number;
}

@Injectable()
export class InventoryService {
  private readonly logger = new Logger('Inventory');

  constructor(
    private readonly appDb: AppPrisma,
    private readonly notifier: NotifierService,
  ) {}

  // ------------------------------------------------------------ nucleo ----

  private async ajustes(tx: TenantTx): Promise<{ allowNegative: boolean; lowAlerts: boolean }> {
    const s = await tx.tenantSettings.findFirst({ select: { allowNegativeStock: true, lowStockAlerts: true } });
    return { allowNegative: s?.allowNegativeStock ?? false, lowAlerts: s?.lowStockAlerts ?? true };
  }

  /** Existencia total de un item sumando sucursales. */
  private async total(tx: TenantTx, serviceId: string): Promise<number> {
    const agg = await tx.stockLevel.aggregate({ where: { serviceId }, _sum: { quantity: true } });
    return Number(agg._sum.quantity ?? 0);
  }

  /**
   * Registra UN movimiento: bloquea el saldo del item en la sucursal, valida
   * que no quede negativo (salvo permiso del negocio), actualiza el costo
   * promedio en ingresos con costo y anota la fila del libro. Devuelve el
   * saldo nuevo y si el item cruzo hacia abajo su minimo.
   */
  async registrar(
    tx: TenantTx,
    tenantId: string,
    m: MovimientoInput,
    opts: { allowNegative?: boolean } = {},
  ): Promise<{ balance: number; alerta: AlertaStock | null }> {
    if (m.quantity === 0) throw new ConflictException({ title: 'La cantidad no puede ser cero' });
    const service = await tx.service.findFirst({
      where: { id: m.serviceId, deletedAt: null },
      select: { id: true, name: true, kind: true, trackStock: true, isCombo: true, cost: true, minStock: true },
    });
    if (!service) throw new NotFoundException({ title: 'El producto no existe' });
    if (service.isCombo) throw new ConflictException({ title: `${service.name} es un combo: el stock se maneja en sus componentes` });
    if (!service.trackStock) throw new ConflictException({ title: `${service.name} no controla stock: activá "Controlar stock" en el Catálogo` });
    const branch = await tx.branch.findFirst({ where: { id: m.branchId, deletedAt: null }, select: { id: true } });
    if (!branch) throw new NotFoundException({ title: 'La sucursal no existe' });

    // Saldo con lock de fila (se crea en cero si no existia).
    await tx.$executeRaw`INSERT INTO app.stock_levels (tenant_id, service_id, branch_id, quantity)
      VALUES (${tenantId}::uuid, ${m.serviceId}::uuid, ${m.branchId}::uuid, 0)
      ON CONFLICT (tenant_id, service_id, branch_id) DO NOTHING`;
    const rows = await tx.$queryRaw<{ id: string; quantity: string }[]>`SELECT id, quantity::text FROM app.stock_levels
      WHERE tenant_id = ${tenantId}::uuid AND service_id = ${m.serviceId}::uuid AND branch_id = ${m.branchId}::uuid FOR UPDATE`;
    const level = rows[0];
    if (!level) throw new ConflictException({ title: 'No se pudo bloquear el saldo de stock' });
    const before = Number(level.quantity);
    const after = round2(before + m.quantity);
    const allowNegative = opts.allowNegative ?? (await this.ajustes(tx)).allowNegative;
    if (after < 0 && m.quantity < 0 && !allowNegative) {
      throw new ConflictException({
        type: 'https://docs.pymes.local/errors/insufficient-stock',
        title: `Sin stock suficiente de ${service.name}: hay ${before}, se necesitan ${round2(-m.quantity)}`,
        faltantes: [{ serviceId: service.id, name: service.name, requested: round2(-m.quantity), available: before }],
      });
    }
    await tx.stockLevel.update({ where: { id: level.id }, data: { quantity: after, updatedAt: new Date() } });

    const totalAntes = await this.total(tx, m.serviceId);
    const totalDespues = totalAntes; // ya incluye el saldo actualizado
    const totalPrevio = round2(totalDespues - m.quantity);

    // Costo promedio ponderado: solo en ingresos con costo informado.
    if (m.quantity > 0 && m.unitCost !== undefined && m.unitCost !== null && (m.kind === 'purchase' || m.kind === 'initial')) {
      const oldQty = Math.max(0, totalPrevio);
      const oldCost = Number(service.cost);
      const nuevo = oldQty + m.quantity > 0 ? Math.round((oldQty * oldCost + m.quantity * Number(m.unitCost)) / (oldQty + m.quantity)) : Number(m.unitCost);
      await tx.service.update({ where: { id: m.serviceId }, data: { cost: BigInt(nuevo) } });
    }

    await tx.stockMovement.create({
      data: {
        tenantId,
        serviceId: m.serviceId,
        branchId: m.branchId,
        kind: m.kind,
        quantity: m.quantity,
        unitCost: m.unitCost ?? null,
        balanceAfter: after,
        referenceType: m.referenceType ?? null,
        referenceId: m.referenceId ?? null,
        note: m.note ?? null,
        createdBy: m.createdBy ?? null,
      },
    });

    const min = Number(service.minStock);
    const cruzo = min > 0 && totalDespues < min && totalPrevio >= min;
    return { balance: after, alerta: cruzo ? { serviceId: service.id, name: service.name, total: totalDespues, min } : null };
  }

  /**
   * Expande las lineas de una venta a items que controlan stock: un combo se
   * convierte en sus componentes (cantidad x cantidad del combo); lo que no
   * controla stock se ignora. Agrupa por item.
   */
  async expandir(tx: TenantTx, lineas: LineaVenta[]): Promise<{ serviceId: string; name: string; quantity: number }[]> {
    const ids = [...new Set(lineas.map((l) => l.serviceId).filter((id): id is string => Boolean(id)))];
    if (ids.length === 0) return [];
    const services = await tx.service.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        name: true,
        trackStock: true,
        isCombo: true,
        components: { select: { componentServiceId: true, quantity: true, component: { select: { name: true, trackStock: true } } } },
      },
    });
    const acc = new Map<string, { serviceId: string; name: string; quantity: number }>();
    const sumar = (serviceId: string, name: string, q: number) => {
      const cur = acc.get(serviceId) ?? { serviceId, name, quantity: 0 };
      cur.quantity = round2(cur.quantity + q);
      acc.set(serviceId, cur);
    };
    for (const l of lineas) {
      if (!l.serviceId) continue;
      const s = services.find((x) => x.id === l.serviceId);
      if (!s) continue;
      if (s.isCombo) {
        for (const c of s.components) {
          if (c.component.trackStock) sumar(c.componentServiceId, c.component.name, round2(l.quantity * Number(c.quantity)));
        }
      } else if (s.trackStock) {
        sumar(s.id, s.name, l.quantity);
      }
    }
    return [...acc.values()].filter((x) => x.quantity > 0);
  }

  /** Faltantes de una venta en una sucursal (vacio = se puede emitir). */
  async faltantes(tx: TenantTx, branchId: string, lineas: LineaVenta[]): Promise<Faltante[]> {
    const { allowNegative } = await this.ajustes(tx);
    if (allowNegative) return [];
    const necesarios = await this.expandir(tx, lineas);
    if (necesarios.length === 0) return [];
    const levels = await tx.stockLevel.findMany({ where: { branchId, serviceId: { in: necesarios.map((n) => n.serviceId) } } });
    const out: Faltante[] = [];
    for (const n of necesarios) {
      const disponible = Number(levels.find((l) => l.serviceId === n.serviceId)?.quantity ?? 0);
      if (disponible < n.quantity) out.push({ serviceId: n.serviceId, name: n.name, requested: n.quantity, available: disponible });
    }
    return out;
  }

  /** Venta emitida: descuenta cada item (combos expandidos) en la sucursal de la factura. */
  async consumirVenta(
    tx: TenantTx,
    tenantId: string,
    venta: { invoiceId: string; branchId: string; lineas: LineaVenta[]; userId?: string | null },
  ): Promise<AlertaStock[]> {
    const necesarios = await this.expandir(tx, venta.lineas);
    const alertas: AlertaStock[] = [];
    for (const n of necesarios) {
      const r = await this.registrar(tx, tenantId, {
        serviceId: n.serviceId,
        branchId: venta.branchId,
        kind: 'sale',
        quantity: -n.quantity,
        referenceType: 'invoice',
        referenceId: venta.invoiceId,
        createdBy: venta.userId ?? null,
      });
      if (r.alerta) alertas.push(r.alerta);
    }
    return alertas;
  }

  /**
   * Factura anulada dentro del plazo: revierte exactamente lo que descontó
   * esa factura (idempotente: si no hubo descuento o ya se revirtio, no hace nada).
   */
  async revertirVenta(tx: TenantTx, tenantId: string, invoiceId: string, userId?: string | null): Promise<void> {
    const ventas = await tx.stockMovement.findMany({ where: { referenceType: 'invoice', referenceId: invoiceId } });
    const ya = ventas.some((v) => v.kind === 'sale_reversal');
    if (ya) return;
    for (const v of ventas.filter((x) => x.kind === 'sale')) {
      await this.registrar(
        tx,
        tenantId,
        { serviceId: v.serviceId, branchId: v.branchId, kind: 'sale_reversal', quantity: -Number(v.quantity), referenceType: 'invoice', referenceId: invoiceId, createdBy: userId ?? null, note: 'Factura anulada' },
        { allowNegative: true },
      );
    }
  }

  /** Nota de credito con reingreso: los items acreditados vuelven al stock de la sucursal. */
  async reingresarPorNota(
    tx: TenantTx,
    tenantId: string,
    nota: { creditNoteId: string; branchId: string; lineas: LineaVenta[]; userId?: string | null },
  ): Promise<void> {
    const necesarios = await this.expandir(tx, nota.lineas);
    for (const n of necesarios) {
      await this.registrar(
        tx,
        tenantId,
        { serviceId: n.serviceId, branchId: nota.branchId, kind: 'return', quantity: n.quantity, referenceType: 'credit_note', referenceId: nota.creditNoteId, createdBy: nota.userId ?? null, note: 'Nota de crédito' },
        { allowNegative: true },
      );
    }
  }

  /** Nota de credito anulada: deshace su reingreso (si lo hubo); idempotente. */
  async revertirNota(tx: TenantTx, tenantId: string, creditNoteId: string, userId?: string | null): Promise<void> {
    const movs = await tx.stockMovement.findMany({ where: { referenceType: 'credit_note', referenceId: creditNoteId } });
    if (movs.some((m) => m.kind === 'adjustment')) return;
    for (const m of movs.filter((x) => x.kind === 'return')) {
      await this.registrar(
        tx,
        tenantId,
        { serviceId: m.serviceId, branchId: m.branchId, kind: 'adjustment', quantity: -Number(m.quantity), referenceType: 'credit_note', referenceId: creditNoteId, note: 'Nota de crédito anulada', createdBy: userId ?? null },
        { allowNegative: true },
      );
    }
  }

  /** Avisa al dueno (correo) de los items que cruzaron el minimo; nunca lanza. */
  async avisarBajoMinimo(tenantId: string, alertas: AlertaStock[]): Promise<void> {
    if (alertas.length === 0) return;
    try {
      const ctx = { tenantId, actorType: 'system' as const };
      const { lowAlerts } = await this.appDb.tx(ctx, (tx) => this.ajustes(tx));
      if (!lowAlerts) return;
      const lineas = alertas.map((a) => `- ${a.name}: quedan ${a.total} (mínimo ${a.min})`);
      await this.notifier.ownerEmail(
        tenantId,
        `Stock bajo: ${alertas.map((a) => a.name).join(', ')}`,
        `Estos productos quedaron por debajo de su stock mínimo:\n${lineas.join('\n')}\n\nRevisalo en Catálogo → Inventario.`,
      );
    } catch (error) {
      this.logger.warn(`aviso de stock bajo fallo tenant=${tenantId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // ------------------------------------------------------- consultas ----

  /** Existencias por item (con sucursales), valorizadas, con combos calculados. */
  async stock(ctx: TenantContext, query: StockQuery) {
    return this.appDb.tx(ctx, async (tx) => {
      const [branches, items, levels] = await Promise.all([
        tx.branch.findMany({ where: { deletedAt: null }, select: { id: true, name: true, isMain: true }, orderBy: [{ isMain: 'desc' }, { name: 'asc' }] }),
        tx.service.findMany({
          where: { deletedAt: null, kind: 'item', OR: [{ trackStock: true }, { isCombo: true }] },
          select: {
            id: true, name: true, sku: true, barcode: true, unit: true, trackStock: true, isCombo: true, minStock: true, cost: true, price: true, isActive: true,
            category: { select: { name: true } },
            components: { select: { componentServiceId: true, quantity: true, component: { select: { name: true, trackStock: true } } } },
          },
          orderBy: { name: 'asc' },
        }),
        tx.stockLevel.findMany({ select: { serviceId: true, branchId: true, quantity: true } }),
      ]);
      const nivel = (serviceId: string, branchId?: string) =>
        levels.filter((l) => l.serviceId === serviceId && (!branchId || l.branchId === branchId)).reduce((s, l) => s + Number(l.quantity), 0);
      const rows = items.map((it) => {
        const porSucursal = branches.map((b) => ({ branch_id: b.id, branch: b.name, quantity: it.isCombo ? this.comboDisponible(it.components, (id) => nivel(id, b.id)) : nivel(it.id, b.id) }));
        const total = it.isCombo ? this.comboDisponible(it.components, (id) => nivel(id)) : nivel(it.id);
        const min = Number(it.minStock);
        return {
          id: it.id,
          name: it.name,
          sku: it.sku,
          barcode: it.barcode,
          unit: it.unit,
          category: it.category.name,
          is_active: it.isActive,
          track_stock: it.trackStock,
          is_combo: it.isCombo,
          components: it.components.map((c) => ({ service_id: c.componentServiceId, name: c.component.name, quantity: Number(c.quantity), track_stock: c.component.trackStock })),
          min_stock: min,
          cost: it.cost.toString(),
          price: it.price.toString(),
          total,
          value: it.isCombo ? null : (BigInt(Math.round(total)) * it.cost).toString(),
          low: !it.isCombo && min > 0 && total < min,
          out: total <= 0,
          by_branch: porSucursal,
        };
      });
      const filtradas = rows.filter((r) => (!query.low_only || r.low || r.out) && (!query.branch_id || r.by_branch.some((b) => b.branch_id === query.branch_id)));
      return {
        branches,
        items: query.branch_id ? filtradas.map((r) => ({ ...r, total: r.by_branch.find((b) => b.branch_id === query.branch_id)?.quantity ?? 0 })) : filtradas,
        summary: {
          items: rows.length,
          low: rows.filter((r) => r.low).length,
          out: rows.filter((r) => r.out && r.track_stock).length,
          value: rows.reduce((s, r) => s + (r.value ? BigInt(r.value) : 0n), 0n).toString(),
        },
      };
    });
  }

  /** Unidades de combo armables con lo que hay de cada componente que controla stock. */
  private comboDisponible(
    components: { componentServiceId: string; quantity: unknown; component: { trackStock: boolean } }[],
    nivel: (serviceId: string) => number,
  ): number {
    const tracked = components.filter((c) => c.component.trackStock);
    if (tracked.length === 0) return 0;
    return Math.max(0, Math.min(...tracked.map((c) => Math.floor(nivel(c.componentServiceId) / Number(c.quantity)))));
  }

  /** Kardex: movimientos con item y sucursal, paginado por cursor (fecha+id). */
  async movimientos(ctx: TenantContext, q: MovementsQuery) {
    return this.appDb.tx(ctx, async (tx) => {
      let cursor: { createdAt: Date; id: string } | null = null;
      if (q.cursor) {
        const [at, id] = q.cursor.split('|');
        if (at && id) cursor = { createdAt: new Date(at), id };
      }
      const rows = await tx.stockMovement.findMany({
        where: {
          ...(q.service_id ? { serviceId: q.service_id } : {}),
          ...(q.branch_id ? { branchId: q.branch_id } : {}),
          ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } } : {}),
          ...(cursor ? { OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] } : {}),
        },
        include: { service: { select: { name: true, sku: true, unit: true } }, branch: { select: { name: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: q.limit + 1,
      });
      const page = rows.slice(0, q.limit);
      const last = page[page.length - 1];
      const usuarios = await tx.user.findMany({ where: { id: { in: [...new Set(page.map((m) => m.createdBy).filter((x): x is string => Boolean(x)))] } }, select: { id: true, fullName: true } });
      return {
        data: page.map((m) => ({
          id: m.id,
          created_at: m.createdAt,
          service_id: m.serviceId,
          service: m.service.name,
          sku: m.service.sku,
          unit: m.service.unit,
          branch_id: m.branchId,
          branch: m.branch.name,
          kind: m.kind,
          quantity: Number(m.quantity),
          unit_cost: m.unitCost?.toString() ?? null,
          balance_after: Number(m.balanceAfter),
          reference_type: m.referenceType,
          reference_id: m.referenceId,
          note: m.note,
          by: usuarios.find((u) => u.id === m.createdBy)?.fullName ?? null,
        })),
        next_cursor: rows.length > q.limit && last ? `${last.createdAt.toISOString()}|${last.id}` : null,
      };
    });
  }

  // ------------------------------------------------------- acciones ----

  /** Ingreso (compra o carga inicial). */
  async ingresar(ctx: TenantContext, dto: StockEntry) {
    const r = await this.appDb.tx(ctx, (tx) =>
      this.registrar(tx, ctx.tenantId, {
        serviceId: dto.service_id,
        branchId: dto.branch_id,
        kind: dto.kind,
        quantity: dto.quantity,
        unitCost: dto.unit_cost ?? null,
        referenceType: 'manual',
        note: dto.note ?? null,
        createdBy: ctx.userId ?? null,
      }),
    );
    return { balance: r.balance };
  }

  /** Ajuste por conteo/rotura/perdida (motivo obligatorio). */
  async ajustar(ctx: TenantContext, dto: StockAdjustment) {
    const r = await this.appDb.tx(ctx, async (tx) => {
      const level = await tx.stockLevel.findFirst({ where: { serviceId: dto.service_id, branchId: dto.branch_id } });
      const actual = Number(level?.quantity ?? 0);
      const delta = dto.new_quantity !== undefined ? round2(dto.new_quantity - actual) : round2(dto.delta ?? 0);
      if (delta === 0) throw new ConflictException({ title: 'El ajuste no cambia nada: la cantidad ya es esa' });
      return this.registrar(tx, ctx.tenantId, {
        serviceId: dto.service_id,
        branchId: dto.branch_id,
        kind: 'adjustment',
        quantity: delta,
        referenceType: 'manual',
        note: dto.reason,
        createdBy: ctx.userId ?? null,
      });
    });
    if (r.alerta) void this.avisarBajoMinimo(ctx.tenantId, [r.alerta]);
    return { balance: r.balance };
  }

  /** Traslado entre sucursales: salida en una y entrada en la otra, en la misma transaccion. */
  async transferir(ctx: TenantContext, dto: StockTransfer) {
    const r = await this.appDb.tx(ctx, async (tx) => {
      const salida = await this.registrar(tx, ctx.tenantId, {
        serviceId: dto.service_id,
        branchId: dto.from_branch_id,
        kind: 'transfer_out',
        quantity: -dto.quantity,
        referenceType: 'manual',
        note: dto.note ?? 'Traslado',
        createdBy: ctx.userId ?? null,
      });
      const entrada = await this.registrar(tx, ctx.tenantId, {
        serviceId: dto.service_id,
        branchId: dto.to_branch_id,
        kind: 'transfer_in',
        quantity: dto.quantity,
        referenceType: 'manual',
        note: dto.note ?? 'Traslado',
        createdBy: ctx.userId ?? null,
      });
      return { from_balance: salida.balance, to_balance: entrada.balance };
    });
    return r;
  }

  /** Disponibilidad para el bot: true/false para items con stock o combos; null si no se controla. */
  async disponible(tx: TenantTx, serviceId: string): Promise<boolean | null> {
    const s = await tx.service.findFirst({
      where: { id: serviceId },
      select: { trackStock: true, isCombo: true, components: { select: { componentServiceId: true, quantity: true, component: { select: { trackStock: true } } } } },
    });
    if (!s) return null;
    if (s.isCombo) {
      if (!s.components.some((c) => c.component.trackStock)) return null;
      const ids = s.components.map((c) => c.componentServiceId);
      const levels = await tx.stockLevel.groupBy({ by: ['serviceId'], where: { serviceId: { in: ids } }, _sum: { quantity: true } });
      return this.comboDisponible(s.components, (id) => Number(levels.find((l) => l.serviceId === id)?._sum.quantity ?? 0)) > 0;
    }
    if (!s.trackStock) return null;
    return (await this.total(tx, serviceId)) > 0;
  }
}
