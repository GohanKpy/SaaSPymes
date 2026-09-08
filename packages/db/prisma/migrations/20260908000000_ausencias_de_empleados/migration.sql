-- Ausencias de empleados (pedido de Johan 2026-09-08): cuando alguien se
-- ausenta o se retira, sus turnos del periodo se detectan, el dueno recibe
-- el aviso y los clientes afectados eligen otra persona u otro dia.

CREATE TABLE app.employee_absences (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES control.tenants(id),
  employee_id uuid NOT NULL,
  starts_on   date NOT NULL,
  -- NULL = hasta nuevo aviso (se retira o no se sabe cuando vuelve).
  ends_on     date,
  reason      text,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, employee_id) REFERENCES app.employees (tenant_id, id),
  CHECK (ends_on IS NULL OR ends_on >= starts_on)
);
CREATE INDEX employee_absences_employee_idx ON app.employee_absences (tenant_id, employee_id, starts_on);
ALTER TABLE app.employee_absences ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.employee_absences FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON app.employee_absences
  USING (tenant_id = app.current_tenant()) WITH CHECK (tenant_id = app.current_tenant());
CREATE TRIGGER trg_employee_absences_audit AFTER INSERT OR UPDATE OR DELETE ON app.employee_absences
  FOR EACH ROW EXECUTE FUNCTION app.row_audit();

-- Cuando se le aviso al cliente que su profesional no podra atenderlo
-- (queda esperando que elija otra persona u otro dia).
ALTER TABLE app.appointments ADD COLUMN absence_notified_at timestamptz;
