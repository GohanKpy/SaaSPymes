-- Fotos de catalogo (P1 replanteo 2026-08-26): hasta N imagenes por
-- servicio/item, guardadas en Postgres (bytea) a escala de laboratorio.
-- El pase a S3/MinIO llega con el hardening: mismo contrato de API,
-- cambia solo el backend de almacenamiento.
CREATE TABLE app.service_photos (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES control.tenants(id),
  service_id uuid NOT NULL,
  mime       text NOT NULL CHECK (mime IN ('image/png', 'image/jpeg', 'image/webp')),
  size_bytes integer NOT NULL,
  data       bytea NOT NULL,
  sort       integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, service_id) REFERENCES app.services (tenant_id, id)
);
CREATE INDEX service_photos_service_idx ON app.service_photos (tenant_id, service_id, sort);

ALTER TABLE app.service_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.service_photos FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON app.service_photos
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

-- Auditoria SIN los bytes de la imagen (misma idea que row_audit_credentials
-- con encrypted_payload): el audit_log registra el hecho, no la foto.
CREATE OR REPLACE FUNCTION app.row_audit_sin_data() RETURNS trigger AS $$
BEGIN
  INSERT INTO app.audit_log (tenant_id, actor_user_id, actor_type, action,
                             entity, entity_id, before, after)
  VALUES (
    coalesce(NEW.tenant_id, OLD.tenant_id),
    NULLIF(current_setting('app.user_id', true), '')::uuid,
    coalesce(NULLIF(current_setting('app.actor_type', true), ''), 'user'),
    TG_TABLE_NAME || '.' || lower(TG_OP),
    TG_TABLE_NAME,
    coalesce(NEW.id, OLD.id),
    CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) - 'data' END,
    CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) - 'data' END
  );
  RETURN coalesce(NEW, OLD);
END $$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_service_photos_audit AFTER INSERT OR UPDATE OR DELETE ON app.service_photos
  FOR EACH ROW EXECUTE FUNCTION app.row_audit_sin_data();
