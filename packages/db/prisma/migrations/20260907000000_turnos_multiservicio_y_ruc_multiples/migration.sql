-- Turnos con varios servicios y clientes con varios RUC (pedidos de Johan
-- 2026-09-07; propuesta docs/propuestas/2026-09-07-turnos-multiservicio-y-ruc-multiples.md).

-- 1. Duracion de un servicio cuando se combina con otro en el mismo turno
--    (NULL = la duracion completa). Permite acortar los adicionales.
ALTER TABLE app.services
  ADD COLUMN combo_duration_min integer CHECK (combo_duration_min > 0);

-- 2. Servicios de un turno. appointments.service_id sigue siendo el principal
--    (el de sort 0): bot, historial y "Cobrar" desde la agenda lo usan.
CREATE TABLE app.appointment_services (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES control.tenants(id),
  appointment_id uuid NOT NULL,
  service_id     uuid NOT NULL,
  sort           integer NOT NULL DEFAULT 0,
  duration_min   integer NOT NULL CHECK (duration_min > 0),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, appointment_id, service_id),
  FOREIGN KEY (tenant_id, appointment_id) REFERENCES app.appointments (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, service_id) REFERENCES app.services (tenant_id, id)
);
CREATE INDEX appointment_services_appt_idx ON app.appointment_services (tenant_id, appointment_id);

-- Los turnos existentes con servicio pasan a tener su fila (duracion real del turno).
INSERT INTO app.appointment_services (tenant_id, appointment_id, service_id, sort, duration_min)
SELECT a.tenant_id, a.id, a.service_id, 0,
       GREATEST(1, ROUND(EXTRACT(EPOCH FROM (a.ends_at - a.starts_at)) / 60)::integer)
FROM app.appointments a
WHERE a.service_id IS NOT NULL;

-- 3. Identidades fiscales del cliente: a nombre de quien factura.
CREATE TABLE app.customer_fiscal_ids (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES control.tenants(id),
  customer_id uuid NOT NULL,
  doc_type    text NOT NULL CHECK (doc_type IN ('ruc', 'ci', 'pasaporte')),
  doc_number  text NOT NULL,
  ruc_dv      text,
  legal_name  text NOT NULL,
  is_default  boolean NOT NULL DEFAULT false,
  deleted_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, customer_id) REFERENCES app.customers (tenant_id, id)
);
CREATE INDEX customer_fiscal_ids_customer_idx ON app.customer_fiscal_ids (tenant_id, customer_id);
-- El mismo documento no se repite dentro de una ficha (salvo los quitados).
CREATE UNIQUE INDEX customer_fiscal_ids_doc_unique
  ON app.customer_fiscal_ids (tenant_id, customer_id, doc_type, doc_number)
  WHERE deleted_at IS NULL;

-- 4. A nombre de quien salio la factura: congelado en la factura (dato fiscal).
--    NULL en las facturas anteriores a este cambio = el documento del cliente.
ALTER TABLE app.invoices
  ADD COLUMN fiscal_id_id       uuid,
  ADD COLUMN billing_name       text,
  ADD COLUMN billing_doc_type   text CHECK (billing_doc_type IN ('ruc', 'ci', 'pasaporte')),
  ADD COLUMN billing_doc_number text,
  ADD COLUMN billing_ruc_dv     text,
  ADD FOREIGN KEY (tenant_id, fiscal_id_id) REFERENCES app.customer_fiscal_ids (tenant_id, id);

-- 5. RLS fail-closed + auditoria en las tablas nuevas (regla numero uno).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['appointment_services', 'customer_fiscal_ids'] LOOP
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON app.%I
         USING (tenant_id = app.current_tenant())
         WITH CHECK (tenant_id = app.current_tenant())', t);
    EXECUTE format(
      'CREATE TRIGGER trg_%s_audit AFTER INSERT OR UPDATE OR DELETE ON app.%I
         FOR EACH ROW EXECUTE FUNCTION app.row_audit()', t, t);
  END LOOP;
END $$;

CREATE TRIGGER trg_customer_fiscal_ids_touch BEFORE UPDATE ON app.customer_fiscal_ids
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
