// @pymes/invoicing — interfaz InvoicingProvider e implementaciones (docs/plan/01 §4).
// Fase 0: stub. La interfaz real (emision, anulacion, nota de credito, KuDE)
// se define en fase 2 junto con el modulo de facturacion.

/** Implementaciones previstas: 'fake' (local), 'sandbox', proveedor homologado (opcion B). */
export type InvoicingProviderKind = 'fake' | 'sandbox' | 'provider';
