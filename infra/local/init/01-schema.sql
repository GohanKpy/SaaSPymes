-- =============================================================================
-- Preparacion de la instancia PostgreSQL local (docs/plan/03 §1, docs/plan/11 §3)
-- Corre una sola vez, en el primer arranque del volumen, via
-- docker-entrypoint-initdb.d, conectado como superusuario a la base `pymes`.
--
-- Adaptaciones respecto del texto del doc 03 (mecanica del laboratorio local,
-- no cambios de arquitectura):
--   1. Passwords como literales de DESARROLLO (initdb no soporta variables
--      psql). En AWS los roles se crean con secretos reales.
--   2. ALTER DEFAULT PRIVILEGES FOR ROLE migrator: el grant por defecto del
--      doc solo cubre objetos creados por quien ejecuta este script (el
--      superusuario); las migraciones Prisma corren como `migrator`, y sin
--      esta linea sus tablas no serian accesibles para `app_rw`.
-- =============================================================================

-- Extensiones
CREATE EXTENSION IF NOT EXISTS citext;      -- emails case-insensitive
CREATE EXTENSION IF NOT EXISTS pg_trgm;     -- busqueda difusa de nombres

-- Esquemas
CREATE SCHEMA IF NOT EXISTS control;   -- plano de la plataforma
CREATE SCHEMA IF NOT EXISTS app;       -- plano de los tenants

-- Roles de conexion
-- migrator: dueño de los objetos, corre migraciones, NO se usa en runtime.
-- app_rw:   rol de la aplicacion. Sin BYPASSRLS: las politicas SIEMPRE aplican.
CREATE ROLE migrator LOGIN PASSWORD 'devpass';
CREATE ROLE app_rw   LOGIN PASSWORD 'devpass' NOBYPASSRLS;

-- migrator es dueño de ambos esquemas: las migraciones crean objetos ahi.
ALTER SCHEMA control OWNER TO migrator;
ALTER SCHEMA app     OWNER TO migrator;
GRANT CONNECT ON DATABASE pymes TO migrator, app_rw;

GRANT USAGE ON SCHEMA control, app TO app_rw;
ALTER DEFAULT PRIVILEGES IN SCHEMA control, app
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_rw;
ALTER DEFAULT PRIVILEGES FOR ROLE migrator IN SCHEMA control, app
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_rw;

-- Funcion utilitaria: updated_at automatico
CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$ LANGUAGE plpgsql;

-- Funcion utilitaria: tenant actual de la sesion (fija el contrato RLS)
CREATE OR REPLACE FUNCTION app.current_tenant() RETURNS uuid AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid
$$ LANGUAGE sql STABLE;
