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
  'employees',
  'employee_form_settings',
  'bot_settings',
  'bot_usage_monthly',
  'bot_tool_calls',
  'calendar_blocks',
  'integration_credentials',
  'notification_emails',
  'customer_contact_points',
  'custom_field_defs',
  'customer_activities',
  'service_photos',
  'quotes',
  'quote_items',
  'appointment_services',
  'customer_fiscal_ids',
  'tenant_settings',
  'recurring_bookings',
  'customer_charges',
  'billing_statements',
  'employee_absences',
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
    const employee = await tx.employee.create({
      data: { tenantId: tenant.id, firstName: 'Empleado', lastName: name, bookable: true },
    });
    // Ausencias (2026-09-08).
    await tx.employeeAbsence.create({
      data: { tenantId: tenant.id, employeeId: employee.id, startsOn: new Date('2026-09-10'), endsOn: new Date('2026-09-11'), reason: `ausencia ${name}` },
    });
    // Planilla de empleados (2026-08-28): campos obligatorios por tenant.
    await tx.employeeFormSettings.create({
      data: { tenantId: tenant.id, requiredFields: ['phone'] },
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
    // CRM extendido (2026-08-26): una fila por tabla nueva para el caso 4.
    await tx.customerContactPoint.create({
      data: {
        tenantId: tenant.id,
        customerId: customer.id,
        kind: 'phone',
        label: 'celular',
        value: phone,
        isPrimary: true,
      },
    });
    await tx.customFieldDef.create({
      data: {
        tenantId: tenant.id,
        entity: 'customer',
        code: 'talla',
        label: 'Talla',
        fieldType: 'text',
      },
    });
    await tx.customerActivity.create({
      data: {
        tenantId: tenant.id,
        customerId: customer.id,
        activityType: 'nota',
        body: `nota de ${name}`,
      },
    });
    await tx.servicePhoto.create({
      data: {
        tenantId: tenant.id,
        serviceId: service.id,
        mime: 'image/png',
        sizeBytes: 3,
        data: Buffer.from([1, 2, 3]),
      },
    });
    const invoice = await tx.invoice.create({
      data: { tenantId: tenant.id, branchId: branch.id, customerId: customer.id },
    });
    const quote = await tx.quote.create({
      data: {
        tenantId: tenant.id,
        branchId: branch.id,
        customerId: customer.id,
        number: 1,
        total: 100000n,
      },
    });
    await tx.quoteItem.create({
      data: {
        tenantId: tenant.id,
        quoteId: quote.id,
        serviceId: service.id,
        description: `Servicio ${name}`,
        unitPrice: 100000n,
        taxRate: 10,
        lineTotal: 100000n,
      },
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
    // Turnos multi-servicio y RUCs multiples (2026-09-07): una fila por tabla nueva.
    await tx.appointmentService.create({
      data: { tenantId: tenant.id, appointmentId: appointment.id, serviceId: service.id, durationMin: 60 },
    });
    await tx.customerFiscalId.create({
      data: {
        tenantId: tenant.id,
        customerId: customer.id,
        docType: 'ruc',
        docNumber: '80012345',
        rucDv: '7',
        legalName: `Empresa ${name}`,
        isDefault: true,
      },
    });
    // Cuenta mensual y recurrentes (2026-09-07): una fila por tabla nueva.
    await tx.tenantSettings.create({ data: { tenantId: tenant.id, monthlyCloseDay: 1 } });
    await tx.recurringBooking.create({
      data: {
        tenantId: tenant.id,
        customerId: customer.id,
        branchId: branch.id,
        serviceIds: [service.id],
        frequency: 'weekly',
        weekday: 1,
        timeLocal: '10:00',
        durationMin: 60,
        startsOn: new Date('2026-09-01'),
      },
    });
    await tx.customerCharge.create({
      data: {
        tenantId: tenant.id,
        customerId: customer.id,
        serviceId: service.id,
        appointmentId: appointment.id,
        description: `Servicio ${name}`,
        unitPrice: 100000n,
        taxRate: 10,
        lineTotal: 100000n,
        source: 'appointment',
      },
    });
    await tx.billingStatement.create({
      data: { tenantId: tenant.id, customerId: customer.id, period: '2026-08', total: 100000n, chargesCount: 1 },
    });
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
      'quote_items',
      'quotes',
      'invoice_items',
      'billing_statements',
      'customer_charges',
      'appointment_services',
      'appointments',
      'recurring_bookings',
      'invoices',
      'customer_fiscal_ids',
      'tenant_settings',
      'service_photos',
      'services',
      'service_categories',
      'user_branch_access',
      'refresh_tokens',
      'notification_emails',
      'employee_absences',
      'employees',
      'employee_form_settings',
      'bot_settings',
      'integration_credentials',
      'customer_contact_points',
      'customer_activities',
      'custom_field_defs',
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

  it('caso 3c: colgar un servicio de B de un turno de A es imposible (FK compuesta)', async () => {
    const turnoA = await tenantTx(appRw, { tenantId: A.id }, (tx) =>
      tx.appointment.findFirstOrThrow({ select: { id: true } }),
    );
    await expect(
      tenantTx(appRw, { tenantId: A.id }, (tx) =>
        tx.appointmentService.create({
          data: { tenantId: A.id, appointmentId: turnoA.id, serviceId: B.serviceId, durationMin: 30 },
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
