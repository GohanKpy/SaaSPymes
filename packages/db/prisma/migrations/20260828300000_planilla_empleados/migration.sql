-- Planilla de empleados (pedido 2026-08-28): datos que exige el Ministerio
-- de Trabajo (estado civil y cantidad de hijos) y contacto de emergencia
-- desglosado en nombre / telefono / relacion con el empleado.
-- Expand-and-contract: el texto libre emergency_contact se copia a
-- emergency_contact_name y la columna vieja queda hasta confirmar la carga
-- nueva (se retira en una migracion posterior).
ALTER TABLE app.employees
  ADD COLUMN emergency_contact_name text,
  ADD COLUMN emergency_contact_phone text,
  ADD COLUMN emergency_contact_relation text,
  ADD COLUMN marital_status text
    CHECK (marital_status IN ('soltero', 'casado', 'divorciado', 'viudo', 'union_de_hecho')),
  ADD COLUMN children_count smallint CHECK (children_count BETWEEN 0 AND 30);

UPDATE app.employees
  SET emergency_contact_name = emergency_contact
  WHERE emergency_contact IS NOT NULL;

-- Campos obligatorios de la planilla, definidos por el admin de CADA tenant
-- (nombre y apellido son siempre obligatorios: piso tecnico, no configurable).
-- Una fila por tenant, mismo patron que bot_settings (PK = tenant_id).
CREATE TABLE app.employee_form_settings (
  tenant_id       uuid PRIMARY KEY REFERENCES control.tenants(id),
  required_fields text[] NOT NULL DEFAULT '{}',
  updated_by      uuid,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE app.employee_form_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.employee_form_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON app.employee_form_settings
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

CREATE TRIGGER trg_employee_form_settings_touch
  BEFORE UPDATE ON app.employee_form_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- row_audit_bot_settings audita usando tenant_id como entity_id: sirve para
-- cualquier tabla de config con PK tenant_id (como esta).
CREATE TRIGGER trg_employee_form_settings_audit
  AFTER INSERT OR UPDATE OR DELETE ON app.employee_form_settings
  FOR EACH ROW EXECUTE FUNCTION app.row_audit_bot_settings();
