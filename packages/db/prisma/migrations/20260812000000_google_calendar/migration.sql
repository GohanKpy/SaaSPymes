-- Google Calendar (ADR 0007 + fase C reciproca pedida 2026-08-12).
-- appointments.google_event_id ya existe desde el init (schema previsor);
-- lo nuevo es la vuelta reciproca: eventos creados A MANO en el calendario
-- del negocio ("almuerzo con proveedor") bloquean la agenda interna: la
-- disponibilidad los resta; el bot y el panel dejan de ofrecer esos huecos.
CREATE TABLE app.calendar_blocks (
  id              bigserial PRIMARY KEY,
  tenant_id       uuid NOT NULL REFERENCES control.tenants(id),
  -- Reserva para multi-sucursal / recursos agendables (doc 03 §3.3): hoy el
  -- bloqueo aplica a todo el tenant y va NULL.
  branch_id       uuid,
  google_event_id text NOT NULL,
  starts_at       timestamptz NOT NULL,
  ends_at         timestamptz NOT NULL,
  summary         text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, google_event_id)
);
CREATE INDEX calendar_blocks_rango
  ON app.calendar_blocks (tenant_id, starts_at, ends_at);

ALTER TABLE app.calendar_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.calendar_blocks FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON app.calendar_blocks
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());
