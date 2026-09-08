-- Modo desarrollo por cliente (pedido de Johan 2026-09-08): con dev_mode los
-- comprobantes son simulaciones (se emiten sin receptor ni datos de SIFEN y
-- el KuDE lo dice). En produccion (false) rigen los bloqueos.
ALTER TABLE control.tenants ADD COLUMN dev_mode boolean NOT NULL DEFAULT false;
-- Hoy no hay ningun cliente en produccion: todos arrancan en desarrollo.
UPDATE control.tenants SET dev_mode = true;
