#!/usr/bin/env node
// SOLO laboratorio. Envía un mensaje al bot como si viniera de WhatsApp:
// construye el payload real de Meta, lo firma con META_APP_SECRET
// (x-hub-signature-256) y lo entrega al webhook de la API — el mismo pipeline
// que usará WhatsApp en producción (doc 11 §1). Después espera la respuesta
// consultando el endpoint webchat (inexistente en producción).
//
// Uso (desde la raíz del repo):
//   node .claude/skills/testear-bot/scripts/enviar-mensaje.mjs \
//     --phone-number-id <id> --from +595981000101 --body "hola" \
//     [--name "Cliente QA"] [--api http://localhost:4301] [--timeout 90] [--no-wait]
//
// Salida: JSON { status, nuevos: [mensajes posteriores al envío] }.
// Códigos: 0 ok · 1 rechazo del webhook · 2 argumentos/entorno · 3 timeout sin respuesta.

import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const has = (name) => process.argv.includes(`--${name}`);

const api = arg('api', process.env.API_URL ?? 'http://localhost:4301');
const phoneNumberId = arg('phone-number-id');
const from = arg('from');
const body = arg('body');
const name = arg('name', 'Cliente QA');
const timeoutS = Number(arg('timeout', '90'));

if (!phoneNumberId || !from || !body) {
  console.error('faltan --phone-number-id / --from / --body');
  process.exit(2);
}

let secret = process.env.META_APP_SECRET;
if (!secret) {
  try {
    const env = readFileSync('.env.local', 'utf8');
    secret = /^META_APP_SECRET=(.*)$/m.exec(env)?.[1]?.trim().replace(/^["']|["']$/g, '');
  } catch {
    /* se valida abajo */
  }
}
if (!secret) {
  console.error('META_APP_SECRET no está en el entorno ni en .env.local (¿estás en la raíz del repo?)');
  process.exit(2);
}

const waId = from.replace(/^\+/, '');
const pollUrl =
  `${api}/api/v1/webhooks/webchat/messages` +
  `?phone_number_id=${encodeURIComponent(phoneNumberId)}&from_phone=${encodeURIComponent(from)}`;

async function mensajes() {
  const res = await fetch(pollUrl);
  if (!res.ok) throw new Error(`webchat/messages ${res.status}: ${await res.text()}`);
  return res.json();
}

const antes = await mensajes();
const ultimoId = BigInt(antes.messages.at(-1)?.id ?? '0');

const payload = JSON.stringify({
  object: 'whatsapp_business_account',
  entry: [
    {
      id: 'webchat',
      changes: [
        {
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: { display_phone_number: phoneNumberId, phone_number_id: phoneNumberId },
            contacts: [{ profile: { name }, wa_id: waId }],
            messages: [
              {
                from: waId,
                id: `qa.${randomUUID()}`,
                timestamp: String(Math.floor(Date.now() / 1000)),
                type: 'text',
                text: { body },
              },
            ],
          },
        },
      ],
    },
  ],
});

const firma = 'sha256=' + createHmac('sha256', secret).update(payload).digest('hex');
const envio = await fetch(`${api}/api/v1/webhooks/whatsapp`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-hub-signature-256': firma },
  body: payload,
});
if (!envio.ok) {
  console.error(`webhook ${envio.status}: ${await envio.text()}`);
  process.exit(1);
}

if (has('no-wait')) {
  console.log(JSON.stringify({ enviado: true }));
  process.exit(0);
}

const limite = Date.now() + timeoutS * 1000;
for (;;) {
  await new Promise((r) => setTimeout(r, 2000));
  const ahora = await mensajes();
  const nuevos = ahora.messages.filter((m) => BigInt(m.id) > ultimoId);
  if (nuevos.some((m) => m.direction === 'out')) {
    console.log(JSON.stringify({ status: ahora.status, nuevos }, null, 2));
    process.exit(0);
  }
  if (Date.now() > limite) {
    // sin respuesta del bot: puede ser proveedor caído (regla R7) o presupuesto
    // agotado — revisar `docker compose logs api` antes de emitir veredicto.
    console.log(JSON.stringify({ status: ahora.status, nuevos, timeout: true }, null, 2));
    process.exit(3);
  }
}
