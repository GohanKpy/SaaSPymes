// @pymes/invoicing — interfaz InvoicingProvider (doc 01 §4).
// El dominio de facturacion habla SOLO con esta interfaz; la via de
// transmision (fake local, sandbox, proveedor homologado opcion B, o
// integracion directa opcion A) es un detalle intercambiable por config.
import { randomBytes } from 'node:crypto';

export interface FiscalConfig {
  timbrado: string;
  establishment: string; // '001'
  expeditionPoint: string; // '001'
}

export interface IssueRequest {
  invoiceId: string;
  tenantId: string;
  docType: 'factura' | 'nota_credito';
  docNumber: string; // correlativo ya asignado con lock (doc 04 §3.9)
  fiscal: FiscalConfig;
  customer: { name: string; ruc?: string | null; docNumber?: string | null };
  items: { description: string; quantity: number; unitPrice: bigint; taxRate: number }[];
  totals: { subtotal: bigint; taxTotal: bigint; total: bigint; currency: string };
}

export type IssueResult =
  | { status: 'approved'; cdc: string; responseCode: string }
  | { status: 'rejected'; responseCode: string; detail: string };

export interface CancelRequest {
  invoiceId: string;
  cdc: string;
  reason: string;
}

export type CancelResult =
  | { status: 'cancelled'; responseCode: string }
  | { status: 'rejected'; responseCode: string; detail: string };

export interface InvoicingProvider {
  readonly kind: string;
  issue(req: IssueRequest): Promise<IssueResult>;
  cancel(req: CancelRequest): Promise<CancelResult>;
}

/**
 * Provider fake del laboratorio (doc 11 §1): aprueba todo al instante con un
 * CDC sintetico de 44 digitos. Permite operar el modulo completo de
 * facturacion (numeracion, estados, anulacion) sin SIFEN real.
 */
export class FakeInvoicingProvider implements InvoicingProvider {
  readonly kind = 'fake';

  issue(req: IssueRequest): Promise<IssueResult> {
    const random = Array.from(randomBytes(22), (b) => String(b % 10)).join('');
    const cdc = `01${req.fiscal.timbrado}${req.fiscal.establishment}${req.fiscal.expeditionPoint}${req.docNumber}${random}`
      .replace(/\D/g, '')
      .padEnd(44, '0')
      .slice(0, 44);
    return Promise.resolve({ status: 'approved', cdc, responseCode: '0260-fake' });
  }

  cancel(_req: CancelRequest): Promise<CancelResult> {
    return Promise.resolve({ status: 'cancelled', responseCode: '0420-fake' });
  }
}

export function createInvoicingProvider(kind: string): InvoicingProvider {
  switch (kind) {
    case 'fake':
      return new FakeInvoicingProvider();
    default:
      // 'sandbox' y el proveedor homologado real llegan con la decision
      // [ABIERTO] del doc 01; la interfaz ya fija el contrato.
      throw new Error(`InvoicingProvider '${kind}' no implementado todavia`);
  }
}
