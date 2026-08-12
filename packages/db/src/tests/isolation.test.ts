// Suite de aislamiento multitenant — capa SQL/ORM (docs/plan/08 §2).
// Cubre los casos 3, 4, 5 y 10 de la tabla del doc 08 contra Postgres real
// (laboratorio local o service container de CI). Los casos por API (1, 2, 6,
// 7) viven en el e2e de apps/api y se ejecutan con la app levantada.
// REGLA (CLAUDE.md): ninguna tarea que toque datos se declara terminada sin
// correr esta suite.
import { describe, it, beforeAll, afterAll, expect } from 'vitest';

import { createPrismaClient, tenantTx } from '../index';

// En el laboratorio y en CI los tres roles comparten password de juguete;
// derivamos las URLs de la de migrator para no multiplicar variables.
function roleUrl(base: string, role: string): string {
  const url = new URL(base);
  url.username = role;
  return url.toString();
}

const MIGRATOR_URL = process.env.MIGRATOR_DATABASE_URL;
if (!MIGRATOR_URL) throw new Error('Falta MIGRATOR_DATABASE_URL para la suite de aislamiento');

const migrator = createPrismaClient(MIGRATOR_URL);
const appRw = createPrismaClient(roleUrl(MIGRATOR_URL, 'app_rw'));

// Tablas de app con tenant_id (todas): el caso 4/5 itera sobre ellas.
const APP_TABLES = [
  'branches',
  'users',
  'user_branch_access',
  'refresh_tokens',
  'customers',
  'service_categories',
  'services',
  'appointments',
  'conversations',
  'messages',
  'invoices',
  'invoice_items',
  'payments',
  'bot_settings',
  'bot_usage_monthly',
  'bot_tool_calls',
  'calendar_blocks',
  'integration_credentials',
  'notification_emails',
  'audit_log',
] as const;

interface SeededTenant {
  id: string;
  branchId: string;
  customerId: string;
  serviceId: string;
  categoryId: string;
  conversationId: string;
  invoiceId: string;
}

async function seedTenant(name: string, phone: string): Promise<SeededTenant> {
  const tenant = await migrator.tenant.create({
    data: { legalName: name, status: 'active' },
  });
  return tenantTx(appRw, { tenantId: tenant.id, actorType: 'system' }, async (tx) => {
    const branch = await tx.branch.create({
      data: { tenantId: tenant.id, name: 'Casa central', isMain: true },
    });
    await tx.user.create({
      data: {
        tenantId: tenant.id,
        email: `root@${name}.test`,
        passwordHash: 'x',
        fullName: `Root ${name}`,
        role: 'root',
      },
    });
    const customer = await tx.customer.create({
      data: { tenantId: tenant.id, firstName: `Cliente ${name}`, phoneE164: phone },
    });
    const category = await tx.serviceCategory.create({
      data: { tenantId: tenant.id, name: 'General' },
    });
    const service = await tx.service.create({
      data: {
        tenantId: tenant.id,
        categoryId: category.id,
        name: `Servicio ${name}`,
        price: 100000n,
      },
    });
    const conversation = await tx.conversation.create({
      data: { tenantId: tenant.id, phoneE164: phone },
    });
    await tx.botToolCall.create({
      data: {
        tenantId: tenant.id,
        conversationId: conversation.id,
        tool: 'list_services',
        ok: true,
      },
    });
    await tx.botUsageMonthly.create({
      data: { tenantId: tenant.id, period: '2026-08', inputTokens: 1n, outputTokens: 1n },
    });
    await tx.calendarBlock.create({
      data: {
        tenantId: tenant.id,
        googleEventId: `evt-${name}`,
        startsAt: new Date('2026-09-01T15:00:00Z'),
        endsAt: new Date('2026-09-01T16:00:00Z'),
        summary: `bloqueo ${name}`,
      },
    });
    await tx.message.create({
      data: {
        tenantId: tenant.id,
        conversationId: conversation.id,
        direction: 'in',
        senderType: 'customer',
        body: `hola desde ${name}`,
      },
    });
    const invoice = await tx.invoice.create({
      data: { tenantId: tenant.id, branchId: branch.id, customerId: customer.id },
    });
    const appointment = await tx.appointment.create({
      data: {
        tenantId: tenant.id,
        branchId: branch.id,
        customerId: customer.id,
        serviceId: service.id,
        startsAt: new Date('2026-09-01T13:00:00Z'),
        endsAt: new Date('2026-09-01T14:00:00Z'),
        invoiceId: invoice.id,
      },
    });
    void appointment;
    return {
      id: tenant.id,
      branchId: branch.id,
      customerId: customer.id,
      serviceId: service.id,
      categoryId: category.id,
      conversationId: conversation.id,
      invoiceId: invoice.id,
    };
  });
}

async function wipeTenant(tenantId: string): Promise<void> {
  await tenantTx(migrator, { tenantId, actorType: 'system' }, async (tx) => {
    // Orden por dependencias FK; audit_log al final (los deletes lo alimentan).
    for (const table of [
      'calendar_blocks',
      'bot_tool_calls',
      'bot_usage_monthly',
      'messages',
      'conversations',
      'payments',
      'invoice_items',
      'appointments',
      'invoices',
      'services',
      'service_categories',
      'user_branch_access',
      'refresh_tokens',
      'notification_emails',
      'bot_settings',
      'integration_credentials',
      'customers',
      'users',
      'branches',
      'audit_log',
    ]) {
      await tx.$executeRawUnsafe(`DELETE FROM app.${table} WHERE tenant_id = $1::uuid`, tenantId);
    }
  });
  await migrator.tenant.delete({ where: { id: tenantId } });
}

let A: SeededTenant;
let B: SeededTenant;

beforeAll(async () => {
  A = await seedTenant('tenant-a-iso', '+595970000001');
  B = await seedTenant('tenant-b-iso', '+595970000002');
}, 60000);

afterAll(async () => {
  if (A) await wipeTenant(A.id);
  if (B) await wipeTenant(B.id);
  await migrator.$disconnect();
  await appRw.$disconnect();
});

describe('aislamiento multitenant (SQL, rol app_rw)', () => {
  it('caso 4: con contexto de A no se ve ninguna fila de B, tabla por tabla', async () => {
    for (const table of APP_TABLES) {
      const rows = await tenantTx(appRw, { tenantId: A.id }, (tx) =>
        tx.$queryRawUnsafe<{ n: bigint }[]>(
          `SELECT count(*)::bigint AS n FROM app.${table} WHERE tenant_id = $1::uuid`,
          B.id,
        ),
      );
      expect(Number(rows[0]?.n ?? -1), `filas de B visibles en app.${table}`).toBe(0);
    }
  });

  it('caso 4b: la busqueda directa del cliente de B devuelve nada', async () => {
    const found = await tenantTx(appRw, { tenantId: A.id }, (tx) =>
      tx.customer.findFirst({ where: { id: B.customerId } }),
    );
    expect(found).toBeNull();
  });

  it('caso 5: sin tenant en la sesion, cero filas totales (fallo cerrado)', async () => {
    for (const table of APP_TABLES) {
      const rows = await appRw.$queryRawUnsafe<{ n: bigint }[]>(
        `SELECT count(*)::bigint AS n FROM app.${table}`,
      );
      expect(Number(rows[0]?.n ?? -1), `filas visibles sin contexto en app.${table}`).toBe(0);
    }
  });

  it('caso 3: facturar a un cliente de B desde A es imposible (FK compuesta)', async () => {
    await expect(
      tenantTx(appRw, { tenantId: A.id }, (tx) =>
        tx.invoice.create({
          data: { tenantId: A.id, branchId: A.branchId, customerId: B.customerId },
        }),
      ),
    ).rejects.toThrow();
  });

  it('caso 3b: agendar un servicio de B desde A es imposible (FK compuesta)', async () => {
    await expect(
      tenantTx(appRw, { tenantId: A.id }, (tx) =>
        tx.appointment.create({
          data: {
            tenantId: A.id,
            branchId: A.branchId,
            customerId: A.customerId,
            serviceId: B.serviceId,
            startsAt: new Date('2026-09-02T13:00:00Z'),
            endsAt: new Date('2026-09-02T14:00:00Z'),
          },
        }),
      ),
    ).rejects.toThrow();
  });

  it('escritura cruzada: UPDATE sobre fila de B desde contexto A afecta 0 filas', async () => {
    const affected = await tenantTx(appRw, { tenantId: A.id }, (tx) =>
      tx.$executeRawUnsafe(
        `UPDATE app.customers SET notes = 'hackeado' WHERE id = $1::uuid`,
        B.customerId,
      ),
    );
    expect(affected).toBe(0);
  });

  it('suplantacion: insertar con tenant_id de B desde contexto A es rechazado', async () => {
    await expect(
      tenantTx(appRw, { tenantId: A.id }, (tx) =>
        tx.customer.create({
          data: { tenantId: B.id, firstName: 'Intruso' },
        }),
      ),
    ).rejects.toThrow();
  });

  it('caso 10: la vista customer_history respeta RLS (security_invoker)', async () => {
    const mine = await tenantTx(appRw, { tenantId: A.id }, (tx) =>
      tx.$queryRawUnsafe<{ tenant_id: string }[]>(`SELECT tenant_id FROM app.customer_history`),
    );
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((r) => r.tenant_id === A.id)).toBe(true);

    const closed = await appRw.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*)::bigint AS n FROM app.customer_history`,
    );
    expect(Number(closed[0]?.n ?? -1)).toBe(0);
  });

  it('auditoria: los triggers registran actor y tenant', async () => {
    const entries = await tenantTx(appRw, { tenantId: A.id }, (tx) =>
      tx.auditLog.findMany({ where: { entity: 'customers', action: 'customers.insert' } }),
    );
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((e) => e.tenantId === A.id)).toBe(true);
  });
});
