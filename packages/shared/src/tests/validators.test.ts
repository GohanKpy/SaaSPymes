// Tests de validadores compartidos: montos en guaranies (formato humano),
// digito verificador de RUC y topes del webhook publico.
import { describe, expect, it } from 'vitest';

import { planCreate } from '../dtos/platform';
import { paymentCreate } from '../dtos/invoice';
import { waWebhookPayload } from '../dtos/conversation';
import { computeRucDv, rucWithDv } from '../validators';

describe('montos en guaranies: separador de miles humano', () => {
  const parse = (monthly_price: string) =>
    planCreate.safeParse({ code: 'p', name: 'P', monthly_price });

  it.each([
    ['150.000', 150000n],
    ['150,000', 150000n],
    ['2.500.000', 2500000n],
    ['150000', 150000n],
  ])('acepta %s como %s', (entrada, esperado) => {
    const r = parse(entrada);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.monthly_price).toBe(esperado);
  });

  it.each(['1,5', '15.00', 'abc', '150.000,5'])('rechaza %s', (entrada) => {
    expect(parse(entrada).success).toBe(false);
  });

  it('los pagos tambien lo aceptan', () => {
    const r = paymentCreate.safeParse({ method: 'efectivo', amount: '1.500.000' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.amount).toBe(1500000n);
  });
});

describe('digito verificador de RUC (modulo 11 SET)', () => {
  it.each([
    ['80089722', 6],
    ['2489073', 1],
  ])('RUC %s -> DV %d', (base, dv) => {
    expect(computeRucDv(base)).toBe(dv);
  });

  it('rucWithDv valida el formato base-dv completo', () => {
    expect(rucWithDv.safeParse('80089722-6').success).toBe(true);
    expect(rucWithDv.safeParse('80089722-5').success).toBe(false);
    expect(rucWithDv.safeParse('80089722').success).toBe(false);
  });
});

describe('webhook inbound: topes contra payloads gigantes (auditoria 2026-08-07)', () => {
  const payload = (body: string) => ({
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'e1',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '595991000000', phone_number_id: 'pn1' },
              messages: [
                { from: '595991000001', id: 'wamid.1', timestamp: '0', type: 'text', text: { body } },
              ],
            },
          },
        ],
      },
    ],
  });

  it('acepta un texto del tamano maximo de WhatsApp (4096)', () => {
    expect(waWebhookPayload.safeParse(payload('a'.repeat(4096))).success).toBe(true);
  });

  it('rechaza un texto mas grande', () => {
    expect(waWebhookPayload.safeParse(payload('a'.repeat(4097))).success).toBe(false);
  });
});
