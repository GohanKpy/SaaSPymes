-- Motivo de la nota de credito (2026-09-14): queda en el DTE y en el aviso al cliente.
ALTER TABLE app.invoices ADD COLUMN credit_reason text;
