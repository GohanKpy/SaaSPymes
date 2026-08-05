-- Correccion de la 20260807000000: su UPDATE de limpieza corria como
-- migrator SIN contexto de tenant y, con FORCE RLS en app.audit_log,
-- no veia ninguna fila (no-op silencioso). La politica tenant_isolation
-- exige app.tenant_id, asi que se limpia tenant por tenant.
DO $$
DECLARE
  t uuid;
BEGIN
  FOR t IN SELECT id FROM control.tenants LOOP
    PERFORM set_config('app.tenant_id', t::text, true);
    UPDATE app.audit_log
    SET before = before - 'password_hash' - 'totp_secret',
        after  = after  - 'password_hash' - 'totp_secret'
    WHERE tenant_id = t
      AND entity = 'users'
      AND (before ? 'password_hash' OR after ? 'password_hash'
           OR before ? 'totp_secret' OR after ? 'totp_secret');
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);
END $$;
