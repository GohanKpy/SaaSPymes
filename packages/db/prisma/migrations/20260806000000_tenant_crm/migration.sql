-- CRM de clientes de la plataforma (ADR 0005): en fase 1 el tenant ES la
-- ficha del cliente del dueño del sistema. Datos de contacto y notas
-- comerciales, editables solo desde el portal admin.
ALTER TABLE control.tenants
  ADD COLUMN contact_name  text,
  ADD COLUMN contact_email citext,
  ADD COLUMN contact_phone text,
  ADD COLUMN notes         text;
