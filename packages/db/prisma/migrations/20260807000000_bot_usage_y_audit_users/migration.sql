-- 1) Consumo mensual del bot por tenant (doc 05 §6.4, doc 09 R9; ADR 0006).
--    Ledger simple por periodo YYYY-MM en la zona del tenant: alcanza para
--    cortar el bot al agotar monthly_token_budget y para el margen por
--    tenant del panel de plataforma.
CREATE TABLE app.bot_usage_monthly (
  tenant_id     uuid NOT NULL REFERENCES control.tenants(id),
  period        text NOT NULL CHECK (period ~ '^[0-9]{4}-[0-9]{2}$'),
  input_tokens  bigint NOT NULL DEFAULT 0,
  output_tokens bigint NOT NULL DEFAULT 0,
  turns         int NOT NULL DEFAULT 0,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, period)
);

ALTER TABLE app.bot_usage_monthly ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.bot_usage_monthly FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON app.bot_usage_monthly
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

-- 2) La auditoria de app.users usaba la funcion generica y copiaba
--    password_hash (y totp_secret) al audit log. Variante que los excluye,
--    mismo criterio que bot_settings y credentials (doc 05).
CREATE OR REPLACE FUNCTION app.row_audit_users() RETURNS trigger AS $$
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
    CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) - 'password_hash' - 'totp_secret' END,
    CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) - 'password_hash' - 'totp_secret' END
  );
  RETURN coalesce(NEW, OLD);
END $$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER trg_users_audit ON app.users;
CREATE TRIGGER trg_users_audit AFTER INSERT OR UPDATE OR DELETE ON app.users
  FOR EACH ROW EXECUTE FUNCTION app.row_audit_users();

-- Limpieza retroactiva: borrar hashes ya copiados en el audit log existente.
UPDATE app.audit_log
SET before = before - 'password_hash' - 'totp_secret',
    after  = after  - 'password_hash' - 'totp_secret'
WHERE entity = 'users'
  AND (before ? 'password_hash' OR after ? 'password_hash'
       OR before ? 'totp_secret' OR after ? 'totp_secret');
