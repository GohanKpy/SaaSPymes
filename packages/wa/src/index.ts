// @pymes/wa — cliente de WhatsApp Cloud API (docs/plan/01 §4).
// Solo texto por ahora (lo que usan el bot y la bandeja); plantillas y
// multimedia llegan con la fase de notificaciones.

export interface WaClientOptions {
  accessToken: string;
  phoneNumberId: string;
  /** Base de Graph API; viene de env (WA_GRAPH_BASE_URL) — nunca fija (doc 11). */
  baseUrl: string;
}

export interface WaSendResult {
  waMessageId: string;
}

export class WaCloudError extends Error {
  constructor(
    public readonly status: number,
    body: string,
  ) {
    super(`WhatsApp Cloud API ${status}: ${body.slice(0, 300)}`);
  }
}

export class WaCloudClient {
  constructor(private readonly options: WaClientOptions) {}

  /** Envia un texto libre (ventana de 24 h de servicio al cliente). */
  async sendText(toE164: string, body: string): Promise<WaSendResult> {
    const url = `${this.options.baseUrl.replace(/\/$/, '')}/${this.options.phoneNumberId}/messages`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.options.accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: toE164.replace(/^\+/, ''),
        type: 'text',
        text: { preview_url: false, body },
      }),
    });
    if (!res.ok) {
      throw new WaCloudError(res.status, await res.text());
    }
    const data = (await res.json()) as { messages?: { id: string }[] };
    return { waMessageId: data.messages?.[0]?.id ?? '' };
  }
}

export const WA_PACKAGE_READY = true;
