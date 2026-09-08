# Alta de cliente con datos de facturación — 2026-09-08

**Pedido de Johan:** "al crear cliente nuevo pide nombre, apellido, mail,
celular; también debe solicitar datos de facturación de una vez, RUC y razón
social, no obligatorios al crear cliente."

**Estado:** implementado el 2026-09-08.

- `POST /customers` acepta `legal_name` (con `doc_type`/`doc_number`): el
  servidor guarda el documento en la ficha y crea la identidad fiscal
  predeterminada (`customer_fiscal_ids`, `is_default`), con el DV del RUC
  calculado si no viene.
- Panel: modal "Nuevo cliente" (Clientes) y alta rápida del selector
  (Agenda → Nuevo turno, Facturación → Nueva factura) con los campos "RUC
  (para facturar, opcional)" y "Razón social (opcional)"; la razón social se
  habilita al cargar el RUC.
