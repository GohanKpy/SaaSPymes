-- Cuenta mensual, servicios recurrentes y ajustes del negocio (pedidos de
-- Johan 2026-09-07; docs/propuestas/2026-09-07-cuenta-mensual-recurrentes-formato.md).

-- 1. Preferencias del cliente: como se le factura y por donde recibe la factura.
ALTER TABLE app.customers
  ADD COLUMN billing_mode    text NOT NULL DEFAULT 'per_service' CHECK (billing_mode IN ('per_service', 'monthly')),
  ADD COLUMN invoice_channel text NOT NULL DEFAULT 'whatsapp'    CHECK (invoice_channel IN ('whatsapp', 'email'));

-- 2. Ajustes del negocio (una fila por tenant, patron bot_settings).
CREATE TABLE app.tenant_settings (
  tenant_id            uuid PRIMARY KEY REFERENCES control.tenants(id),
  monthly_close_day    smallint NOT NULL DEFAULT 1 CHECK (monthly_close_day BETWEEN 1 AND 28),
  monthly_auto_invoice boolean NOT NULL DEFAULT false,
  recurring_lead_days  smallint NOT NULL DEFAULT 7 CHECK (recurring_lead_days BETWEEN 1 AND 60),
  updated_by           uuid,
  updated_at           timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE app.tenant_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.tenant_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON app.tenant_settings
  USING (tenant_id = app.current_tenant()) WITH CHECK (tenant_id = app.current_tenant());
CREATE TRIGGER trg_tenant_settings_touch BEFORE UPDATE ON app.tenant_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_tenant_settings_audit AFTER INSERT OR UPDATE OR DELETE ON app.tenant_settings
  FOR EACH ROW EXECUTE FUNCTION app.row_audit_bot_settings();

-- 3. Servicios recurrentes.
CREATE TABLE app.recurring_bookings (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES control.tenants(id),
  customer_id       uuid NOT NULL,
  branch_id         uuid NOT NULL,
  employee_id       uuid,
  service_ids       uuid[] NOT NULL CHECK (cardinality(service_ids) BETWEEN 1 AND 10),
  frequency         text NOT NULL CHECK (frequency IN ('weekly', 'biweekly', 'monthly')),
  weekday           smallint CHECK (weekday BETWEEN 0 AND 6),
  day_of_month      smallint CHECK (day_of_month BETWEEN 1 AND 28),
  time_local        char(5) NOT NULL,
  duration_min      integer NOT NULL CHECK (duration_min BETWEEN 5 AND 720),
  starts_on         date NOT NULL,
  ends_on           date,
  is_active         boolean NOT NULL DEFAULT true,
  last_generated_on date,
  last_error        text,
  notes             text,
  created_by        uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, customer_id) REFERENCES app.customers (tenant_id, id),
  FOREIGN KEY (tenant_id, branch_id)   REFERENCES app.branches (tenant_id, id),
  FOREIGN KEY (tenant_id, employee_id) REFERENCES app.employees (tenant_id, id),
  CHECK ((frequency = 'monthly' AND day_of_month IS NOT NULL) OR (frequency <> 'monthly' AND weekday IS NOT NULL))
);
CREATE INDEX recurring_bookings_customer_idx ON app.recurring_bookings (tenant_id, customer_id);

ALTER TABLE app.appointments
  ADD COLUMN recurring_booking_id      uuid,
  ADD COLUMN confirmation_requested_at timestamptz,
  ADD FOREIGN KEY (tenant_id, recurring_booking_id) REFERENCES app.recurring_bookings (tenant_id, id);
CREATE INDEX appointments_confirmation_idx ON app.appointments (tenant_id, confirmation_requested_at)
  WHERE confirmation_requested_at IS NOT NULL;

-- 4. Consumos pendientes (cuenta corriente del cliente mensual).
CREATE TABLE app.customer_charges (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES control.tenants(id),
  customer_id    uuid NOT NULL,
  service_id     uuid,
  appointment_id uuid,
  description    text NOT NULL,
  quantity       numeric(10, 2) NOT NULL DEFAULT 1,
  unit_price     bigint NOT NULL,
  tax_rate       smallint NOT NULL CHECK (tax_rate IN (0, 5, 10)),
  line_total     bigint NOT NULL,
  source         text NOT NULL CHECK (source IN ('appointment', 'manual')),
  status         text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'invoiced', 'void')),
  invoice_id     uuid,
  charged_on     date NOT NULL DEFAULT CURRENT_DATE,
  notes          text,
  created_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, customer_id)    REFERENCES app.customers (tenant_id, id),
  FOREIGN KEY (tenant_id, service_id)     REFERENCES app.services (tenant_id, id),
  FOREIGN KEY (tenant_id, appointment_id) REFERENCES app.appointments (tenant_id, id),
  FOREIGN KEY (tenant_id, invoice_id)     REFERENCES app.invoices (tenant_id, id)
);
CREATE INDEX customer_charges_pending_idx ON app.customer_charges (tenant_id, customer_id, status);

-- 5. Resumen del mes por cliente (idempotencia del cierre automatico).
CREATE TABLE app.billing_statements (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES control.tenants(id),
  customer_id          uuid NOT NULL,
  period               char(7) NOT NULL,
  total                bigint NOT NULL,
  charges_count        integer NOT NULL,
  notified_customer_at timestamptz,
  notified_owner_at    timestamptz,
  invoice_id           uuid,
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, customer_id, period),
  FOREIGN KEY (tenant_id, customer_id) REFERENCES app.customers (tenant_id, id),
  FOREIGN KEY (tenant_id, invoice_id)  REFERENCES app.invoices (tenant_id, id)
);

-- 6. RLS fail-closed + auditoria (regla numero uno).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['recurring_bookings', 'customer_charges', 'billing_statements'] LOOP
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
CREATE TRIGGER trg_recurring_bookings_touch BEFORE UPDATE ON app.recurring_bookings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
