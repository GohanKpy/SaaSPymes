# 03 · Database Schema
## DDL PostgreSQL 16 de referencia

Este documento es el contrato del modelo físico. Prisma generará las migraciones definitivas a partir de `schema.prisma`, pero este DDL define **exactamente** qué debe existir: tipos, llaves, índices, constraints, RLS, auditoría y soft delete. Cualquier diferencia entre Prisma y este documento se resuelve a favor de este documento.

**Convenciones**

- `snake_case` para todo. Tablas en plural.
- Dinero: `bigint` (guaraníes, sin decimales) + `currency char(3)`.
- Tiempos: `timestamptz` siempre, en UTC. La zona horaria (America/Asuncion) es asunto de presentación.
- Soft delete: `deleted_at timestamptz NULL`. Las consultas de negocio filtran `deleted_at IS NULL`; los índices únicos son parciales sobre esa condición.
- **Toda tabla del esquema `app` lleva `tenant_id`, incluidas las hijas** (`invoice_items`, `messages`, `payments`). Es una desnormalización deliberada: hace las políticas RLS triviales y eficientes, y las FKs compuestas garantizan que una hija jamás apunte a un padre de otro tenant.

---

## 1. Preparación de la instancia

```sql
-- Extensiones
CREATE EXTENSION IF NOT EXISTS citext;      -- emails case-insensitive
CREATE EXTENSION IF NOT EXISTS pg_trgm;     -- busqueda difusa de nombres

-- Esquemas
CREATE SCHEMA IF NOT EXISTS control;   -- plano de la plataforma
CREATE SCHEMA IF NOT EXISTS app;       -- plano de los tenants

-- Roles de conexion
-- migrator: dueño de los objetos, corre migraciones, NO se usa en runtime.
-- app_rw:   rol de la aplicacion. Sin BYPASSRLS: las politicas SIEMPRE aplican.
CREATE ROLE migrator LOGIN PASSWORD :'migrator_pw';
CREATE ROLE app_rw   LOGIN PASSWORD :'app_pw' NOBYPASSRLS;

GRANT USAGE ON SCHEMA control, app TO app_rw;
ALTER DEFAULT PRIVILEGES IN SCHEMA control, app
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
```

El backend abre cada unidad de trabajo así (patrón Prisma con transacción):

```sql
BEGIN;
SELECT set_config('app.tenant_id', '<uuid-del-tenant>', true);  -- SET LOCAL
-- ... consultas de la request ...
COMMIT;
```

---

## 2. Esquema `control`

```sql
CREATE TABLE control.platform_users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email          citext NOT NULL UNIQUE,
  password_hash  text   NOT NULL,                    -- Argon2id
  full_name      text   NOT NULL,
  role           text   NOT NULL CHECK (role IN ('admin','agent')),
  totp_secret    bytea,                              -- cifrado app-level
  totp_enabled   boolean NOT NULL DEFAULT false,
  is_active      boolean NOT NULL DEFAULT true,
  last_login_at  timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE control.features (
  id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code  text NOT NULL UNIQUE,   -- 'crm','catalog','scheduling','bot','chat_inbox','invoicing','payments'
  name  text NOT NULL
);

CREATE TABLE control.plans (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code           text NOT NULL UNIQUE,               -- 'standard','plus','enterprise'
  name           text NOT NULL,
  monthly_price  bigint NOT NULL CHECK (monthly_price >= 0),
  currency       char(3) NOT NULL DEFAULT 'PYG',
  max_users      int NOT NULL DEFAULT 1,
  max_branches   int NOT NULL DEFAULT 1,
  is_active      boolean NOT NULL DEFAULT true,
  sort_order     int NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE control.plan_features (
  plan_id     uuid NOT NULL REFERENCES control.plans(id) ON DELETE CASCADE,
  feature_id  uuid NOT NULL REFERENCES control.features(id) ON DELETE CASCADE,
  limits      jsonb NOT NULL DEFAULT '{}',   -- ej {"bot_messages_month": 1000}
  PRIMARY KEY (plan_id, feature_id)
);

CREATE TABLE control.tenants (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_name       text NOT NULL,
  trade_name       text,
  ruc              text UNIQUE,                      -- con digito verificador
  status           text NOT NULL DEFAULT 'trial'
                   CHECK (status IN ('trial','active','suspended','closed')),
  current_plan_id  uuid REFERENCES control.plans(id),
  branding         jsonb NOT NULL DEFAULT '{}',      -- logo_key, colores
  timezone         text NOT NULL DEFAULT 'America/Asuncion',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE control.tenant_feature_overrides (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES control.tenants(id) ON DELETE CASCADE,
  feature_id  uuid NOT NULL REFERENCES control.features(id),
  enabled     boolean NOT NULL,
  extra_fee   bigint NOT NULL DEFAULT 0,
  limits      jsonb,                -- si no es NULL, reemplaza los del plan
  note        text NOT NULL,        -- motivo del acuerdo: obligatorio
  created_by  uuid NOT NULL REFERENCES control.platform_users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, feature_id)
);

CREATE TABLE control.subscriptions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES control.tenants(id),
  plan_id               uuid NOT NULL REFERENCES control.plans(id),
  status                text NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active','past_due','cancelled')),
  agreed_price          bigint,       -- NULL = precio de lista del plan
  current_period_start  date NOT NULL,
  current_period_end    date NOT NULL,
  cancelled_at          timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CHECK (current_period_end > current_period_start)
);
CREATE INDEX ix_subscriptions_tenant ON control.subscriptions (tenant_id, status);

CREATE TABLE control.platform_invoices (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES control.tenants(id),
  subscription_id  uuid REFERENCES control.subscriptions(id),
  status           text NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft','issuing','approved','rejected','cancelled')),
  cdc              text UNIQUE,
  total            bigint NOT NULL,
  currency         char(3) NOT NULL DEFAULT 'PYG',
  issued_at        timestamptz,
  kude_pdf_key     text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE control.platform_audit_log (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id    uuid REFERENCES control.platform_users(id),
  action      text NOT NULL,          -- 'tenant.suspend', 'plan.update', ...
  entity      text NOT NULL,
  entity_id   uuid,
  detail      jsonb,
  ip          inet,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_platform_audit_entity ON control.platform_audit_log (entity, entity_id);
```

---

## 3. Esquema `app`

### 3.1 Identidad y estructura

```sql
CREATE TABLE app.branches (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES control.tenants(id),
  name        text NOT NULL,
  address     text,
  phone       text,
  is_main     boolean NOT NULL DEFAULT false,
  deleted_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)                       -- habilita FKs compuestas
);
CREATE UNIQUE INDEX ux_branches_main
  ON app.branches (tenant_id) WHERE is_main AND deleted_at IS NULL;
CREATE INDEX ix_branches_tenant ON app.branches (tenant_id) WHERE deleted_at IS NULL;

CREATE TABLE app.users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES control.tenants(id),
  email          citext NOT NULL,
  password_hash  text NOT NULL,
  full_name      text NOT NULL,
  role           text NOT NULL CHECK (role IN ('root','admin','staff')),
  totp_secret    bytea,
  totp_enabled   boolean NOT NULL DEFAULT false,
  is_active      boolean NOT NULL DEFAULT true,
  last_login_at  timestamptz,
  deleted_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);
-- email unico por tenant (vivo); el mismo email puede existir en otro tenant
CREATE UNIQUE INDEX ux_users_email
  ON app.users (tenant_id, email) WHERE deleted_at IS NULL;

CREATE TABLE app.user_branch_access (
  tenant_id  uuid NOT NULL,
  user_id    uuid NOT NULL,
  branch_id  uuid NOT NULL,
  PRIMARY KEY (user_id, branch_id),
  FOREIGN KEY (tenant_id, user_id)   REFERENCES app.users (tenant_id, id)    ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, branch_id) REFERENCES app.branches (tenant_id, id) ON DELETE CASCADE
);
-- Regla: los usuarios 'root' ven todas las sucursales sin filas aca (logica de app).

CREATE TABLE app.refresh_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid,                                   -- NULL para platform_users
  user_id     uuid NOT NULL,                          -- app.users o control.platform_users
  user_scope  text NOT NULL CHECK (user_scope IN ('tenant','platform')),
  token_hash  bytea NOT NULL UNIQUE,                  -- sha256 del token
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  replaced_by uuid REFERENCES app.refresh_tokens(id), -- rotacion encadenada
  user_agent  text,
  ip          inet,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_refresh_user ON app.refresh_tokens (user_scope, user_id);
```

### 3.2 CRM y catálogo

```sql
CREATE TABLE app.customers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES control.tenants(id),
  first_name      text NOT NULL,
  last_name       text,
  doc_type        text CHECK (doc_type IN ('ci','ruc','pasaporte')),
  doc_number      text,
  ruc_dv          text,
  email           citext,
  phone_e164      text,                    -- '+5959xxxxxxxx'
  birth_date      date,
  address         text,
  notes           text,
  notify_whatsapp boolean NOT NULL DEFAULT true,
  notify_email    boolean NOT NULL DEFAULT false,
  deleted_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK (phone_e164 IS NULL OR phone_e164 ~ '^\+[1-9][0-9]{6,14}$')
);
-- llaves de identificacion, unicas por tenant cuando existen
CREATE UNIQUE INDEX ux_customers_phone
  ON app.customers (tenant_id, phone_e164)
  WHERE phone_e164 IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX ux_customers_email
  ON app.customers (tenant_id, email)
  WHERE email IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX ux_customers_doc
  ON app.customers (tenant_id, doc_type, doc_number)
  WHERE doc_number IS NOT NULL AND deleted_at IS NULL;
-- busqueda difusa por nombre
CREATE INDEX ix_customers_name_trgm
  ON app.customers USING gin ((first_name || ' ' || coalesce(last_name,'')) gin_trgm_ops);

CREATE TABLE app.service_categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES control.tenants(id),
  name        text NOT NULL,
  sort_order  int NOT NULL DEFAULT 0,
  deleted_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);
CREATE UNIQUE INDEX ux_categories_name
  ON app.service_categories (tenant_id, lower(name)) WHERE deleted_at IS NULL;

CREATE TABLE app.services (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES control.tenants(id),
  category_id      uuid NOT NULL,
  name             text NOT NULL,
  description      text,
  price            bigint NOT NULL CHECK (price >= 0),
  currency         char(3) NOT NULL DEFAULT 'PYG',
  tax_rate         smallint NOT NULL DEFAULT 10 CHECK (tax_rate IN (0,5,10)),
  duration_min     int CHECK (duration_min > 0),
  bookable_by_bot  boolean NOT NULL DEFAULT true,
  is_active        boolean NOT NULL DEFAULT true,
  deleted_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, category_id) REFERENCES app.service_categories (tenant_id, id)
);
CREATE INDEX ix_services_tenant ON app.services (tenant_id, category_id)
  WHERE deleted_at IS NULL;
```

### 3.3 Agenda

```sql
CREATE TABLE app.appointments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES control.tenants(id),
  branch_id     uuid NOT NULL,
  customer_id   uuid NOT NULL,
  service_id    uuid,
  starts_at     timestamptz NOT NULL,
  ends_at       timestamptz NOT NULL,
  status        text NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','confirmed','completed','cancelled','no_show')),
  source        text NOT NULL DEFAULT 'panel' CHECK (source IN ('panel','bot')),
  confirmed_by  uuid,                       -- usuario que confirmo (si manual)
  confirmed_at  timestamptz,
  invoice_id    uuid,                       -- se setea al facturar la visita
  google_event_id text,
  notes         text,
  deleted_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, branch_id)   REFERENCES app.branches  (tenant_id, id),
  FOREIGN KEY (tenant_id, customer_id) REFERENCES app.customers (tenant_id, id),
  FOREIGN KEY (tenant_id, service_id)  REFERENCES app.services  (tenant_id, id),
  CHECK (ends_at > starts_at)
);
CREATE INDEX ix_appt_agenda ON app.appointments (tenant_id, branch_id, starts_at)
  WHERE deleted_at IS NULL;
CREATE INDEX ix_appt_customer ON app.appointments (tenant_id, customer_id, starts_at DESC)
  WHERE deleted_at IS NULL;
-- Nota: NO se impone exclusion de solapamiento a nivel DB en v1: una sucursal
-- atiende en paralelo (varios profesionales). La capacidad por franja se valida
-- en la aplicacion; el modelo de "recursos agendables" (empleados/boxes) es
-- extension prevista de fase 2 (tabla resources + resource_id en appointments).
```

### 3.4 Conversaciones y mensajes

```sql
CREATE TABLE app.conversations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES control.tenants(id),
  customer_id       uuid,                    -- NULL hasta identificar
  phone_e164        text NOT NULL,
  status            text NOT NULL DEFAULT 'bot_active'
                    CHECK (status IN ('bot_active','paused','agent','closed')),
  assigned_user_id  uuid,
  last_message_at   timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, phone_e164),            -- una conversacion viva por numero
  FOREIGN KEY (tenant_id, customer_id) REFERENCES app.customers (tenant_id, id)
);
CREATE INDEX ix_conv_inbox ON app.conversations (tenant_id, last_message_at DESC);

CREATE TABLE app.messages (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id       uuid NOT NULL,             -- denormalizado para RLS
  conversation_id uuid NOT NULL,
  direction       text NOT NULL CHECK (direction IN ('in','out')),
  sender_type     text NOT NULL CHECK (sender_type IN ('customer','bot','agent','system')),
  sender_user_id  uuid,                      -- agente humano, si aplica
  body            text NOT NULL,
  wa_message_id   text,                      -- id de Meta, para dedupe y estados
  status          text NOT NULL DEFAULT 'sent'
                  CHECK (status IN ('queued','sent','delivered','read','failed')),
  error_detail    text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, conversation_id)
    REFERENCES app.conversations (tenant_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX ux_messages_wa ON app.messages (wa_message_id)
  WHERE wa_message_id IS NOT NULL;           -- dedupe de webhooks de Meta
CREATE INDEX ix_messages_conv ON app.messages (conversation_id, id DESC);
-- Plan de crecimiento: cuando la tabla supere ~20M de filas o 20 GB,
-- migrar a particionamiento declarativo por rango mensual de created_at
-- (procedimiento en documento 07, fase de escala). El diseño ya lo permite:
-- ningun FK externo apunta a messages.
```

### 3.5 Facturación

```sql
CREATE TABLE app.invoices (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES control.tenants(id),
  branch_id         uuid NOT NULL,
  customer_id       uuid NOT NULL,
  doc_type          text NOT NULL DEFAULT 'factura'
                    CHECK (doc_type IN ('factura','nota_credito')),
  establishment     char(3),                 -- ej '001'
  expedition_point  char(3),                 -- ej '001'
  doc_number        char(7),                 -- correlativo por punto
  timbrado          text,
  cdc               text,                    -- 44 digitos al aprobar
  status            text NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','issuing','approved','rejected',
                                      'cancelled','credited')),
  sifen_response_code text,
  subtotal          bigint NOT NULL DEFAULT 0,
  tax_total         bigint NOT NULL DEFAULT 0,
  total             bigint NOT NULL DEFAULT 0,
  currency          char(3) NOT NULL DEFAULT 'PYG',
  cancel_reason     text,                    -- obligatorio al anular (regla de app)
  cancelled_by      uuid,
  issued_at         timestamptz,
  approved_at       timestamptz,
  cancelled_at      timestamptz,
  kude_pdf_key      text,
  related_invoice_id uuid,                   -- NC apunta a la factura original
  created_by        uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, branch_id)   REFERENCES app.branches  (tenant_id, id),
  FOREIGN KEY (tenant_id, customer_id) REFERENCES app.customers (tenant_id, id),
  FOREIGN KEY (tenant_id, related_invoice_id) REFERENCES app.invoices (tenant_id, id)
);
CREATE UNIQUE INDEX ux_invoices_cdc ON app.invoices (cdc) WHERE cdc IS NOT NULL;
CREATE UNIQUE INDEX ux_invoices_number
  ON app.invoices (tenant_id, establishment, expedition_point, doc_number, doc_type)
  WHERE doc_number IS NOT NULL;
CREATE INDEX ix_invoices_customer ON app.invoices (tenant_id, customer_id, issued_at DESC);
CREATE INDEX ix_invoices_status   ON app.invoices (tenant_id, status);
-- SIN deleted_at: las facturas jamas se borran; cambian de estado.

CREATE TABLE app.invoice_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,                 -- denormalizado para RLS
  invoice_id  uuid NOT NULL,
  service_id  uuid,                          -- NULL para item libre
  description text NOT NULL,
  quantity    numeric(10,2) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price  bigint NOT NULL CHECK (unit_price >= 0),
  tax_rate    smallint NOT NULL CHECK (tax_rate IN (0,5,10)),
  line_total  bigint NOT NULL,               -- congelado: dato fiscal
  FOREIGN KEY (tenant_id, invoice_id) REFERENCES app.invoices (tenant_id, id)
    ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, service_id) REFERENCES app.services (tenant_id, id)
);
CREATE INDEX ix_items_invoice ON app.invoice_items (invoice_id);

CREATE TABLE app.payments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,              -- denormalizado para RLS
  invoice_id     uuid NOT NULL,
  method         text NOT NULL CHECK (method IN ('efectivo','transferencia','tarjeta','qr','otro')),
  amount         bigint NOT NULL CHECK (amount > 0),
  paid_at        timestamptz NOT NULL DEFAULT now(),
  registered_by  uuid,
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, invoice_id) REFERENCES app.invoices (tenant_id, id)
);
CREATE INDEX ix_payments_invoice ON app.payments (invoice_id);
```

### 3.6 Bot, integraciones y notificaciones

```sql
CREATE TABLE app.bot_settings (
  tenant_id             uuid PRIMARY KEY REFERENCES control.tenants(id),
  enabled               boolean NOT NULL DEFAULT false,
  instructions_text     text,
  instructions_file_key text,        -- s3://bucket/tenants/<tenant_id>/bot/instructions.md
  access_catalog        boolean NOT NULL DEFAULT false,
  access_history        boolean NOT NULL DEFAULT false,
  access_customer_data  boolean NOT NULL DEFAULT false,
  access_calendar       boolean NOT NULL DEFAULT false,
  allow_booking         boolean NOT NULL DEFAULT false,
  auto_confirm_bookings boolean NOT NULL DEFAULT false,
  monthly_token_budget  int NOT NULL DEFAULT 500000,   -- control de costo IA
  updated_by            uuid,
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.integration_credentials (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES control.tenants(id),
  type              text NOT NULL CHECK (type IN
                     ('whatsapp','smtp','sifen','google_calendar','payment')),
  encrypted_payload bytea NOT NULL,     -- envelope encryption con KMS (doc 05)
  public_config     jsonb NOT NULL DEFAULT '{}',  -- phone_number_id, smtp host...
  is_active         boolean NOT NULL DEFAULT true,
  updated_by        uuid NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, type)
);
-- Acceso de lectura/escritura restringido a rol 'root' del tenant: se
-- refuerza en la capa de autorizacion (doc 04) y se audita SIEMPRE.

CREATE TABLE app.notification_emails (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES control.tenants(id),
  email      citext NOT NULL,
  label      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, email)
);

CREATE TABLE app.audit_log (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id      uuid NOT NULL,
  actor_user_id  uuid,
  actor_type     text NOT NULL DEFAULT 'user'
                 CHECK (actor_type IN ('user','bot','system','platform')),
  action         text NOT NULL,      -- 'invoice.cancel', 'settings.update', ...
  entity         text NOT NULL,
  entity_id      uuid,
  before         jsonb,
  after          jsonb,
  ip             inet,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_audit_tenant ON app.audit_log (tenant_id, created_at DESC);
CREATE INDEX ix_audit_entity ON app.audit_log (tenant_id, entity, entity_id);
```

---

## 4. Row Level Security

```sql
-- Se aplica a TODAS las tablas de app. Ejemplo con customers; repetir patron.
ALTER TABLE app.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.customers FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON app.customers
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());
```

Reglas del contrato RLS:

1. El rol de runtime (`app_rw`) **no** tiene `BYPASSRLS`; `FORCE` cubre incluso al dueño de la tabla.
2. Si `app.tenant_id` no está seteado en la sesión, `app.current_tenant()` devuelve NULL y **ninguna fila es visible**: fallar cerrado.
3. Los procesos de plataforma (panel admin global, worker de billing) usan un rol distinto `platform_ops` con políticas propias explícitas, jamás desactivando RLS "por conveniencia".
4. Los tests de aislamiento del documento 08 verifican estas políticas en cada suite de integración.

---

## 5. Triggers

```sql
-- updated_at en todas las tablas con esa columna
CREATE TRIGGER trg_customers_touch BEFORE UPDATE ON app.customers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
-- (repetir para cada tabla con updated_at)

-- Auditoria automatica de tablas sensibles
CREATE OR REPLACE FUNCTION app.row_audit() RETURNS trigger AS $$
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
    CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) END,
    CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) END
  );
  RETURN coalesce(NEW, OLD);
END $$ LANGUAGE plpgsql SECURITY DEFINER;

-- Aplicar a: users, customers, services, appointments, invoices,
-- bot_settings, integration_credentials (esta ultima con NEW.encrypted_payload
-- excluido del jsonb mediante to_jsonb(NEW) - 'encrypted_payload').
```

Nota: para `integration_credentials` el trigger usa una variante que remueve `encrypted_payload` del before y after; los secretos jamás tocan el audit log.

---

## 6. Vistas de consulta

```sql
-- Historial del cliente: visitas + que se facturo (la consulta del reclamo
-- "la semana pasada viniste pero solo te cortaste las uñas")
CREATE VIEW app.customer_history AS
SELECT a.tenant_id, a.customer_id, a.starts_at, a.status AS visit_status,
       s.name AS service_name, i.id AS invoice_id, i.total, i.status AS invoice_status
FROM app.appointments a
LEFT JOIN app.services s ON s.id = a.service_id
LEFT JOIN app.invoices i ON i.id = a.invoice_id
WHERE a.deleted_at IS NULL;
```

Las vistas heredan RLS de sus tablas base (con `security_invoker = on` en PG 16):

```sql
ALTER VIEW app.customer_history SET (security_invoker = on);
```

---

## 7. Estrategia de integridad, resumen ejecutivo

| Mecanismo | Dónde | Qué garantiza |
|---|---|---|
| FKs compuestas `(tenant_id, id)` | Todas las hijas de `app` | Una hija jamás referencia un padre de otro tenant, ni por bug |
| RLS con `FORCE` y fallo cerrado | Todas las tablas de `app` | Sin tenant en sesión no hay datos; con tenant, solo los suyos |
| Índices únicos parciales | emails, teléfonos, documentos, numeración de facturas | Unicidad real conviviendo con soft delete |
| CHECK constraints | estados, montos, tasas IVA, formatos | Estados inválidos no existen ni por SQL manual |
| Triggers de auditoría | tablas sensibles | Trazabilidad completa con before y after |
| Sin DELETE físico en fiscales | invoices, messages, audit_log | Cumplimiento y evidencia |
