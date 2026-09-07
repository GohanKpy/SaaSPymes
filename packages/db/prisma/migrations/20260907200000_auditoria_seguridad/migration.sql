-- Auditoria de seguridad (pedido de Johan 2026-09-07): cada accion con quien,
-- desde que IP, que, cuando, estado anterior y nuevo; jamas contraseñas.
-- docs/propuestas/2026-09-07-auditoria-seguridad.md

-- 1. La auditoria por fila (app.audit_log) suma el id del pedido HTTP que la
--    causo y el navegador. La IP ya tenia columna pero nadie la llenaba.
ALTER TABLE app.audit_log
  ADD COLUMN request_id uuid,
  ADD COLUMN user_agent text;
CREATE INDEX ix_audit_request ON app.audit_log (tenant_id, request_id) WHERE request_id IS NOT NULL;

-- 2. Un solo punto de insercion para todas las variantes de trigger: lee ip,
--    request_id y user_agent de la sesion (set_config desde la API) y saca
--    SIEMPRE los secretos, cualquiera sea la tabla: password_hash, totp_secret,
--    encrypted_payload, token_hash y data (bytes de fotos).
CREATE OR REPLACE FUNCTION app.audit_scrub(j jsonb) RETURNS jsonb AS $$
  SELECT CASE WHEN j IS NULL THEN NULL
              ELSE j - 'password_hash' - 'totp_secret' - 'encrypted_payload' - 'token_hash' - 'data' END
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION app.audit_row(
  p_tenant uuid, p_entity text, p_op text, p_entity_id uuid, p_before jsonb, p_after jsonb
) RETURNS void AS $$
DECLARE
  v_ip inet;
  v_req uuid;
BEGIN
  -- Formatos raros (ip o request_id ilegibles) no pueden frenar la operacion auditada.
  BEGIN v_ip := NULLIF(current_setting('app.ip', true), '')::inet; EXCEPTION WHEN OTHERS THEN v_ip := NULL; END;
  BEGIN v_req := NULLIF(current_setting('app.request_id', true), '')::uuid; EXCEPTION WHEN OTHERS THEN v_req := NULL; END;
  INSERT INTO app.audit_log (tenant_id, actor_user_id, actor_type, action, entity, entity_id,
                             before, after, ip, request_id, user_agent)
  VALUES (
    p_tenant,
    NULLIF(current_setting('app.user_id', true), '')::uuid,
    coalesce(NULLIF(current_setting('app.actor_type', true), ''), 'user'),
    p_entity || '.' || p_op,
    p_entity,
    p_entity_id,
    app.audit_scrub(p_before),
    app.audit_scrub(p_after),
    v_ip,
    v_req,
    NULLIF(current_setting('app.user_agent', true), '')
  );
END $$ LANGUAGE plpgsql SECURITY DEFINER;

-- Las cinco funciones de trigger existentes pasan a delegar en audit_row
-- (misma firma, mismos triggers: no hace falta recrearlos).
CREATE OR REPLACE FUNCTION app.row_audit() RETURNS trigger AS $$
BEGIN
  PERFORM app.audit_row(coalesce(NEW.tenant_id, OLD.tenant_id), TG_TABLE_NAME, lower(TG_OP), coalesce(NEW.id, OLD.id),
    CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) END,
    CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) END);
  RETURN coalesce(NEW, OLD);
END $$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION app.row_audit_users() RETURNS trigger AS $$
BEGIN
  PERFORM app.audit_row(coalesce(NEW.tenant_id, OLD.tenant_id), TG_TABLE_NAME, lower(TG_OP), coalesce(NEW.id, OLD.id),
    CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) END,
    CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) END);
  RETURN coalesce(NEW, OLD);
END $$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION app.row_audit_credentials() RETURNS trigger AS $$
BEGIN
  PERFORM app.audit_row(coalesce(NEW.tenant_id, OLD.tenant_id), TG_TABLE_NAME, lower(TG_OP), coalesce(NEW.id, OLD.id),
    CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) END,
    CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) END);
  RETURN coalesce(NEW, OLD);
END $$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION app.row_audit_sin_data() RETURNS trigger AS $$
BEGIN
  PERFORM app.audit_row(coalesce(NEW.tenant_id, OLD.tenant_id), TG_TABLE_NAME, lower(TG_OP), coalesce(NEW.id, OLD.id),
    CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) END,
    CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) END);
  RETURN coalesce(NEW, OLD);
END $$ LANGUAGE plpgsql SECURITY DEFINER;

-- Tablas con PK tenant_id (sin columna id): el entity_id es el tenant.
CREATE OR REPLACE FUNCTION app.row_audit_bot_settings() RETURNS trigger AS $$
BEGIN
  PERFORM app.audit_row(coalesce(NEW.tenant_id, OLD.tenant_id), TG_TABLE_NAME, lower(TG_OP), coalesce(NEW.tenant_id, OLD.tenant_id),
    CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) END,
    CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) END);
  RETURN coalesce(NEW, OLD);
END $$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Registro de acciones: toda peticion que cambia algo (paneles de clientes
--    y portal admin) y los intentos de login, con IP, navegador, resultado y el
--    cuerpo enviado ya redactado (contraseñas/tokens = "[oculto]"). Esquema
--    control: lo lee solo el portal admin; sin tenant en claro que filtrar.
CREATE TABLE control.action_log (
  id            bigserial PRIMARY KEY,
  at            timestamptz NOT NULL DEFAULT now(),
  request_id    uuid,
  tenant_id     uuid,
  actor_user_id uuid,
  actor_scope   text NOT NULL CHECK (actor_scope IN ('tenant', 'platform', 'anon')),
  actor_role    text,
  actor_email   text,
  ip            text,
  user_agent    text,
  method        text NOT NULL,
  path          text NOT NULL,
  route         text,
  status        integer NOT NULL,
  duration_ms   integer NOT NULL DEFAULT 0,
  body          jsonb,
  error_title   text
);
CREATE INDEX ix_action_log_at ON control.action_log (at DESC);
CREATE INDEX ix_action_log_tenant ON control.action_log (tenant_id, at DESC);
CREATE INDEX ix_action_log_actor ON control.action_log (actor_user_id, at DESC);
CREATE INDEX ix_action_log_request ON control.action_log (request_id);
