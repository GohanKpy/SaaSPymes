-- Empleados fase 3 (ADR 0009): horarios individuales, Google Calendar propio
-- por empleado y bloqueos personales.

-- Horario propio del empleado (mismo formato que branches.schedule:
-- week 0..6 con franjas + closed_dates). NULL = usa el horario de la sucursal.
ALTER TABLE app.employees ADD COLUMN schedule jsonb;

-- Bloqueo personal: un evento importado del Google Calendar DEL EMPLEADO solo
-- lo saca a el de la franja; employee_id NULL sigue tapando todo el negocio.
ALTER TABLE app.calendar_blocks
  ADD COLUMN employee_id uuid,
  ADD FOREIGN KEY (tenant_id, employee_id) REFERENCES app.employees (tenant_id, id);
-- El mismo evento puede venir por la conexion del negocio Y la del empleado
-- (misma cuenta conectada dos veces): la unicidad ahora distingue el origen.
ALTER TABLE app.calendar_blocks DROP CONSTRAINT calendar_blocks_tenant_id_google_event_id_key;
CREATE UNIQUE INDEX calendar_blocks_tenant_event_employee_key
  ON app.calendar_blocks (tenant_id, google_event_id, employee_id) NULLS NOT DISTINCT;

-- Conexion Google propia por empleado: una fila mas de la misma integracion,
-- con employee_id; NULL sigue siendo la conexion del negocio.
ALTER TABLE app.integration_credentials
  ADD COLUMN employee_id uuid,
  ADD FOREIGN KEY (tenant_id, employee_id) REFERENCES app.employees (tenant_id, id);
ALTER TABLE app.integration_credentials DROP CONSTRAINT integration_credentials_tenant_id_type_key;
CREATE UNIQUE INDEX integration_credentials_tenant_type_employee_key
  ON app.integration_credentials (tenant_id, type, employee_id) NULLS NOT DISTINCT;

-- Copia del evento en el calendario del empleado asignado (la del negocio
-- sigue en google_event_id). Solo la copia del NEGOCIO dispara cancelaciones.
ALTER TABLE app.appointments ADD COLUMN employee_google_event_id text;
