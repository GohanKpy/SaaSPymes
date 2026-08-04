-- Configuracion operativa de la plataforma gestionada desde el panel
-- (ADR 0003): clave-valor con secretos cifrados a nivel de aplicacion
-- (mismo patron que integration_credentials, doc 05 §4.2).
-- Primer uso: 'bot_engine' (proveedor, modelo y llaves del motor del bot).

CREATE TABLE control.platform_settings (
  key                text PRIMARY KEY,
  public_config      jsonb NOT NULL DEFAULT '{}',
  encrypted_payload  bytea,                        -- secretos: jamas en claro
  updated_by         uuid REFERENCES control.platform_users(id),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_platform_settings_touch BEFORE UPDATE ON control.platform_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
