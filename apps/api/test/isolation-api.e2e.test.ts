// e2e de aislamiento multitenant POR API (docs/plan/08 §2, casos 1, 2 y 6).
// Complementa la suite SQL de packages/db (casos 3, 4, 5, 10): aca se levanta
// la app real (misma configuracion que produccion, via createApp) y se
// ejercitan los endpoints con tokens de verdad. El caso 7 (scoping por
// sucursal para staff) queda pendiente hasta implementar ese scoping.
import 'reflect-metadata';

import { hash } from '@node-rs/argon2';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createPrismaClient, tenantTx } from '@pymes/db';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.factory';

const MIGRATOR_URL = process.env.MIGRATOR_DATABASE_URL;
if (!MIGRATOR_URL) throw new Error('Falta MIGRATOR_DATABASE_URL para el e2e de aislamiento');

const migrator = createPrismaClient(MIGRATOR_URL);
const PASSWORD = 'ClaveDePrueba123!';

interface SeededTenant {
  id: string;
  rootEmail: string;
  adminEmail: string;
  customerId: string;
  customerName: string;
  serviceId: string;
  conversationId: string;
  invoiceId: string;
  phone: string;
}

/** Plan E2E con TODAS las features reales: sin plan, el FeatureGuard corta
 *  con 403 antes de llegar al scoping que esta suite quiere probar. En CI la
 *  base viene sin seeds, asi que features y plan se garantizan aca. */
async function ensurePlan(): Promise<string> {
  const codes = ['crm', 'catalog', 'scheduling', 'chat_inbox', 'bot', 'invoicing', 'payments'];
  for (const code of codes) {
    await migrator.feature.upsert({
      where: { code },
      update: {},
      create: { code, name: `E2E ${code}` },
    });
  }
  const plan = await migrator.plan.upsert({
    where: { code: 'e2e-full' },
    update: {},
    create: { code: 'e2e-full', name: 'E2E full', monthlyPrice: 0n },
  });
  const features = await migrator.feature.findMany({ where: { code: { in: codes } } });
  for (const f of features) {
    await migrator.planFeature.upsert({
      where: { planId_featureId: { planId: plan.id, featureId: f.id } },
      update: {},
      create: { planId: plan.id, featureId: f.id },
    });
  }
  return plan.id;
}

async function seedTenant(slug: string, phone: string): Promise<SeededTenant> {
  const passwordHash = await hash(PASSWORD, { memoryCost: 8192, timeCost: 2, parallelism: 1 });
  const tenant = await migrator.tenant.create({
    data: { legalName: `E2E API ${slug}`, status: 'active', currentPlanId: await ensurePlan() },
  });
  return tenantTx(migrator, { tenantId: tenant.id, actorType: 'system' }, async (tx) => {
    const branch = await tx.branch.create({
      data: { tenantId: tenant.id, name: 'Central', isMain: true },
    });
    await tx.user.create({
      data: {
        tenantId: tenant.id,
        email: `root@${slug}.e2e.test`,
        passwordHash,
        fullName: `Root ${slug}`,
        role: 'root',
      },
    });
    await tx.user.create({
      data: {
        tenantId: tenant.id,
        email: `admin@${slug}.e2e.test`,
        passwordHash,
        fullName: `Admin ${slug}`,
        role: 'admin',
      },
    });
    const customer = await tx.customer.create({
      data: {
        tenantId: tenant.id,
        firstName: `SecretoDe${slug}`,
        lastName: 'Aislado',
        phoneE164: phone,
      },
    });
    const category = await tx.serviceCategory.create({
      data: { tenantId: tenant.id, name: 'General' },
    });
    const service = await tx.service.create({
      data: {
        tenantId: tenant.id,
        categoryId: category.id,
        name: `Servicio ${slug}`,
        price: 100000n,
      },
    });
    const conversation = await tx.conversation.create({
      data: { tenantId: tenant.id, phoneE164: phone, customerId: customer.id },
    });
    await tx.message.create({
      data: {
        tenantId: tenant.id,
        conversationId: conversation.id,
        direction: 'in',
        senderType: 'customer',
        body: `mensaje privado de ${slug}`,
      },
    });
    const invoice = await tx.invoice.create({
      data: { tenantId: tenant.id, branchId: branch.id, customerId: customer.id },
    });
    return {
      id: tenant.id,
      rootEmail: `root@${slug}.e2e.test`,
      adminEmail: `admin@${slug}.e2e.test`,
      customerId: customer.id,
      customerName: `SecretoDe${slug}`,
      serviceId: service.id,
      conversationId: conversation.id,
      invoiceId: invoice.id,
      phone,
    };
  });
}

async function wipeTenant(tenantId: string): Promise<void> {
  await tenantTx(migrator, { tenantId, actorType: 'system' }, async (tx) => {
    for (const table of [
      'bot_tool_calls',
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

let app: NestFastifyApplication;
let fastify: FastifyInstance;
let A: SeededTenant;
let B: SeededTenant;
let tokenRootA: string;
let tokenAdminA: string;

async function login(email: string, tenantId: string): Promise<string> {
  const res = await fastify.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email, password: PASSWORD, scope: 'tenant', tenant_id: tenantId },
  });
  expect(res.statusCode, `login de ${email}: ${res.body}`).toBe(200);
  const body = JSON.parse(res.body) as { access_token?: string };
  expect(body.access_token, `login de ${email} sin access_token: ${res.body}`).toBeTruthy();
  return body.access_token as string;
}

/** Tenants E2E huerfanos de corridas anteriores que crashearon antes del
 *  afterAll: sin esta limpieza el mismo email existe en varios tenants. */
async function wipeStale(): Promise<void> {
  const stale = await migrator.tenant.findMany({
    where: { legalName: { startsWith: 'E2E API ' } },
    select: { id: true },
  });
  for (const t of stale) await wipeTenant(t.id);
}

const get = (url: string, token: string) =>
  fastify.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } });

beforeAll(async () => {
  await wipeStale();
  A = await seedTenant('alfa', '+595960000001');
  B = await seedTenant('beta', '+595960000002');
  app = await createApp();
  await app.init();
  fastify = app.getHttpAdapter().getInstance() as unknown as FastifyInstance;
  await fastify.ready();
  tokenRootA = await login(A.rootEmail, A.id);
  tokenAdminA = await login(A.adminEmail, A.id);
}, 120_000);

afterAll(async () => {
  if (app) await app.close();
  if (A) await wipeTenant(A.id);
  if (B) await wipeTenant(B.id);
  await migrator.$disconnect();
});

describe('aislamiento multitenant por API (doc 08 §2)', () => {
  it('caso 1: GET de cada recurso de B por ID directo devuelve 404, indistinguible de inexistente', async () => {
    const urls = [
      `/api/v1/customers/${B.customerId}`,
      `/api/v1/customers/${B.customerId}/history`,
      `/api/v1/invoices/${B.invoiceId}`,
      `/api/v1/conversations/${B.conversationId}/messages`,
    ];
    for (const url of urls) {
      const res = await get(url, tokenRootA);
      expect(res.statusCode, `A no debe ver ${url}: ${res.body}`).toBe(404);
    }
  });

  it('caso 1b: un ID inventado da la MISMA respuesta que el ID real de B (sin filtrar existencia)', async () => {
    const fake = '00000000-0000-4000-8000-000000000000';
    const real = await get(`/api/v1/customers/${B.customerId}`, tokenRootA);
    const invented = await get(`/api/v1/customers/${fake}`, tokenRootA);
    expect(real.statusCode).toBe(invented.statusCode);
  });

  it('caso 2: listados con filtros que matchearian datos de B devuelven solo datos de A', async () => {
    const porNombre = await get(
      `/api/v1/customers?q=${encodeURIComponent(B.customerName)}`,
      tokenRootA,
    );
    expect(porNombre.statusCode).toBe(200);
    expect((JSON.parse(porNombre.body) as { data: unknown[] }).data).toHaveLength(0);

    const porTelefono = await get(
      `/api/v1/conversations?q=${encodeURIComponent(B.phone)}`,
      tokenRootA,
    );
    expect(porTelefono.statusCode).toBe(200);
    expect((JSON.parse(porTelefono.body) as { data: unknown[] }).data).toHaveLength(0);

    const servicios = await get('/api/v1/catalog/services', tokenRootA);
    expect(servicios.statusCode).toBe(200);
    const ids = (JSON.parse(servicios.body) as { id: string }[]).map((s) => s.id);
    expect(ids).not.toContain(B.serviceId);
  });

  it('caso 6: admin de A pide /integrations y recibe 403 (solo root)', async () => {
    const res = await get('/api/v1/integrations', tokenAdminA);
    expect(res.statusCode).toBe(403);

    const comoRoot = await get('/api/v1/integrations', tokenRootA);
    expect(comoRoot.statusCode).toBe(200);
  });
});
