// Seed de datos de control: features, planes y el primer padmin.
// Corre como `migrator` (MIGRATOR_DATABASE_URL). Idempotente por upsert.
// Los precios reales de los planes se cargan desde el panel de plataforma:
// los planes son datos, no codigo (doc 02).
import { hash } from '@node-rs/argon2';

import { createPrismaClient } from './index';

// Parametros Argon2id del doc 05 §3: memoria 64 MB, iteraciones 3, paralelismo 4.
export const ARGON2_OPTIONS = {
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
} as const;

const FEATURES = [
  { code: 'crm', name: 'CRM de clientes' },
  { code: 'catalog', name: 'Catalogo de servicios' },
  { code: 'scheduling', name: 'Agenda y turnos' },
  { code: 'chat_inbox', name: 'Bandeja de chat' },
  { code: 'bot', name: 'Bot de WhatsApp' },
  { code: 'invoicing', name: 'Facturacion electronica' },
  { code: 'payments', name: 'Pagos y envio de KuDE' },
];

// Composicion inicial; el panel de plataforma la ajusta sin deploy.
const PLANS: { code: string; name: string; sortOrder: number; features: string[] }[] = [
  { code: 'standard', name: 'Estandar', sortOrder: 1, features: ['crm', 'catalog', 'scheduling'] },
  {
    code: 'plus',
    name: 'Plus',
    sortOrder: 2,
    features: ['crm', 'catalog', 'scheduling', 'chat_inbox', 'bot'],
  },
  {
    code: 'enterprise',
    name: 'Enterprise',
    sortOrder: 3,
    features: ['crm', 'catalog', 'scheduling', 'chat_inbox', 'bot', 'invoicing', 'payments'],
  },
];

async function main(): Promise<void> {
  const url = process.env.MIGRATOR_DATABASE_URL;
  if (!url) throw new Error('Falta MIGRATOR_DATABASE_URL (ver .env.local.example).');
  const prisma = createPrismaClient(url);

  const featureIds = new Map<string, string>();
  for (const f of FEATURES) {
    const row = await prisma.feature.upsert({
      where: { code: f.code },
      update: { name: f.name },
      create: f,
    });
    featureIds.set(f.code, row.id);
  }

  for (const p of PLANS) {
    const plan = await prisma.plan.upsert({
      where: { code: p.code },
      update: { name: p.name, sortOrder: p.sortOrder },
      create: {
        code: p.code,
        name: p.name,
        sortOrder: p.sortOrder,
        monthlyPrice: 0n, // precio real: lo define el panel de plataforma
      },
    });
    for (const code of p.features) {
      const featureId = featureIds.get(code);
      if (!featureId) continue;
      await prisma.planFeature.upsert({
        where: { planId_featureId: { planId: plan.id, featureId } },
        update: {},
        create: { planId: plan.id, featureId },
      });
    }
  }

  // Primer usuario de plataforma para entrar al panel admin. SOLO desarrollo:
  // en ambientes reales se crea con credenciales reales y TOTP obligatorio.
  const adminEmail = process.env.SEED_PADMIN_EMAIL ?? 'admin@pymes.local';
  const adminPassword = process.env.SEED_PADMIN_PASSWORD ?? 'Admin1234!dev';
  await prisma.platformUser.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      email: adminEmail,
      passwordHash: await hash(adminPassword, ARGON2_OPTIONS),
      fullName: 'Admin Plataforma',
      role: 'admin',
    },
  });

  console.log(`Seed OK: ${FEATURES.length} features, ${PLANS.length} planes, padmin ${adminEmail}`);
  await prisma.$disconnect();
}

void main();
