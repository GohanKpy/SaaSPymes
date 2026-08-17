-- Empleados agendables (ADR 0009, fase 1): ficha de RRHH + asignación de
-- turnos. El anti-solape se impone en la transacción de reserva (advisory
-- lock por tenant:empleado, patrón de la numeración de facturas).
CREATE TABLE app.employees (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES control.tenants(id),
  branch_id         uuid,
  -- Vinculo opcional al login del panel: empleado != usuario (ADR 0009 §1).
  user_id           uuid,
  first_name        text NOT NULL,
  last_name         text NOT NULL,
  ci_number         text,
  birth_date        date,
  phone             text,
  email             citext,
  address           text,
  position          text,            -- cargo/puesto
  hired_at          date,            -- fecha de ingreso
  ips_number        text,            -- nro de asegurado IPS
  emergency_contact text,
  salary            bigint,          -- guaranies; visible solo root/admin
  notes             text,
  bookable          boolean NOT NULL DEFAULT true,
  is_active         boolean NOT NULL DEFAULT true,
  deleted_at        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES app.branches (tenant_id, id)
);
CREATE INDEX employees_tenant_idx ON app.employees (tenant_id, is_active, bookable);

ALTER TABLE app.employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.employees FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON app.employees
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

-- Auditoria generica (doc 05 §8), misma que el resto de las tablas de app.
CREATE TRIGGER trg_employees_audit AFTER INSERT OR UPDATE OR DELETE ON app.employees
  FOR EACH ROW EXECUTE FUNCTION app.row_audit();

-- Turno asignado a un empleado (nullable: tenants sin empleados siguen igual).
ALTER TABLE app.appointments
  ADD COLUMN employee_id uuid,
  ADD FOREIGN KEY (tenant_id, employee_id) REFERENCES app.employees (tenant_id, id);
CREATE INDEX appointments_employee_idx
  ON app.appointments (tenant_id, employee_id, starts_at)
  WHERE deleted_at IS NULL;
