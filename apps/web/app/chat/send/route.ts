import { createHmac } from 'node:crypto';

import { NextResponse } from 'next/server';

// SOLO laboratorio: simula a Meta. Construye el payload real de WhatsApp
// Cloud API, lo firma con el mismo app secret (X-Hub-Signature-256) y lo
// entrega al webhook de la API. Asi el pipeline que se prueba desde /chat
// es exactamente el que usara WhatsApp en produccion (doc 11 §1).
export async function POST(request: Request): Promise<NextResponse> {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_WEBCHAT !== 'true') {
    return NextResponse.json({ error: 'solo laboratorio' }, { status: 404 });
  }
  const secret = process.env.META_APP_SECRET;
  const apiUrl = process.env.WEBHOOK_API_URL ?? process.env.NEXT_PUBLIC_API_URL;
  if (!secret || !apiUrl) {
    return NextResponse.json({ error: 'faltan META_APP_SECRET / NEXT_PUBLIC_API_URL' }, { status: 500 });
  }

  const input = (await request.json()) as {
    phone_number_id: string;
    from_phone: string;
    from_name?: string;
    body: string;
  };

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
              metadata: {
                display_phone_number: input.phone_number_id,
                phone_number_id: input.phone_number_id,
              },
              contacts: [
                {
                  profile: { name: input.from_name ?? 'Cliente web' },
                  wa_id: input.from_phone.replace(/^\+/, ''),
                },
              ],
              messages: [
                {
                  from: input.from_phone.replace(/^\+/, ''),
                  id: `webchat.${crypto.randomUUID()}`,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  type: 'text',
                  text: { body: input.body },
                },
              ],
            },
          },
        ],
      },
    ],
  });

  const signature = createHmac('sha256', secret).update(payload).digest('hex');
  const res = await fetch(`${apiUrl}/api/v1/webhooks/whatsapp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-hub-signature-256': `sha256=${signature}`,
    },
    body: payload,
  });
  return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
}
