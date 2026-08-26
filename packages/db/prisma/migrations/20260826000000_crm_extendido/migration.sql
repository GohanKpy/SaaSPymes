-- CRM extendido (replanteo 2026-08-26, referencia Bitrix24):
--  1. Multifield tipado: N telefonos/emails/webs/redes por cliente, con
--     etiqueta y principal (estilo PHONE/EMAIL/WEB/IM de Bitrix).
--  2. Campos personalizados por tenant (definicion en tabla, valores en
--     jsonb del cliente): el default minimo sigue siendo nombre, apellido,
--     celular y email; todo lo demas es opcional/configurable.
--  3. Campos estandar nuevos del cliente: origen, empresa/cargo (B2B
--     liviano), ciudad, etiquetas, responsable, rating, consentimiento.
--  4. Timeline propio: notas y tareas de seguimiento por cliente.

-- ---------- 1. puntos de contacto multiples ----------
CREATE TABLE app.customer_contact_points (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES control.tenants(id),
  customer_id uuid NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('phone', 'email', 'web', 'im')),
  -- celular|trabajo|casa|whatsapp|instagram|facebook|telegram|x|tiktok|otro
  label       text NOT NULL DEFAULT 'otro',
  value       text NOT NULL,
  is_primary  boolean NOT NULL DEFAULT false,
  sort        integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, customer_id) REFERENCES app.customers (tenant_id, id)
);
CREATE INDEX contact_points_customer_idx ON app.customer_contact_points (tenant_id, customer_id, kind);

-- ---------- 2. campos personalizados por tenant ----------
CREATE TABLE app.custom_field_defs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES control.tenants(id),
  entity       text NOT NULL CHECK (entity IN ('customer', 'service', 'appointment', 'invoice')),
  code         text NOT NULL, -- slug estable; clave dentro de custom_data
  label        text NOT NULL,
  field_type   text NOT NULL CHECK (field_type IN ('text', 'number', 'date', 'boolean', 'list', 'money', 'url')),
  options      jsonb NOT NULL DEFAULT '[]', -- opciones cuando field_type = list
  required     boolean NOT NULL DEFAULT false,
  show_in_form boolean NOT NULL DEFAULT true,
  sort         integer NOT NULL DEFAULT 0,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, entity, code)
);

-- Valores de campos personalizados + estandar nuevos del cliente.
ALTER TABLE app.customers
  ADD COLUMN custom_data      jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN source           text, -- whatsapp|instagram|facebook|recomendacion|web|local|otro
  ADD COLUMN source_detail    text,
  ADD COLUMN company_name     text,
  ADD COLUMN job_title        text,
  ADD COLUMN city             text,
  ADD COLUMN tags             text[] NOT NULL DEFAULT '{}',
  ADD COLUMN assigned_user_id uuid,
  ADD COLUMN marketing_opt_in boolean NOT NULL DEFAULT true,
  ADD COLUMN rating           smallint CHECK (rating IS NULL OR rating BETWEEN 1 AND 5);
CREATE INDEX customers_tags_idx ON app.customers USING gin (tags);

-- ---------- 4. timeline: notas y tareas de seguimiento ----------
CREATE TABLE app.customer_activities (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES control.tenants(id),
  customer_id      uuid NOT NULL,
  activity_type    text NOT NULL CHECK (activity_type IN ('nota', 'llamada', 'reunion', 'tarea', 'seguimiento')),
  body             text NOT NULL,
  due_at           timestamptz, -- solo tareas/seguimientos
  done_at          timestamptz,
  assigned_user_id uuid,
  created_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, customer_id) REFERENCES app.customers (tenant_id, id)
);
CREATE INDEX activities_customer_idx ON app.customer_activities (tenant_id, customer_id, created_at DESC);
CREATE INDEX activities_pendientes_idx ON app.customer_activities (tenant_id, due_at)
  WHERE done_at IS NULL AND due_at IS NOT NULL;

-- ---------- RLS + auditoria (mismas reglas que toda tabla de app) ----------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['customer_contact_points', 'custom_field_defs', 'customer_activities'] LOOP
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON app.%I
         USING (tenant_id = app.current_tenant())
         WITH CHECK (tenant_id = app.current_tenant())', t);
    EXECUTE format(
      'CREATE TRIGGER trg_%s_audit AFTER INSERT OR UPDATE OR DELETE ON app.%I
         FOR EACH ROW EXECUTE FUNCTION app.row_audit()', t, t);
  END LOOP;
END $$;
