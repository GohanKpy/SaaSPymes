-- Presupuestos formales (P1 replanteo 2026-08-26): quote → factura.
-- Espejo liviano de invoices SIN caracter fiscal: numeracion propia simple
-- por tenant (P-0001...), items congelados al crear y conversion a borrador
-- de factura que arranca el circuito fiscal normal.
CREATE TABLE app.quotes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES control.tenants(id),
  branch_id   uuid NOT NULL,
  customer_id uuid NOT NULL,
  number      integer NOT NULL,
  status      text NOT NULL DEFAULT 'draft'
              CHECK (status IN ('draft', 'sent', 'accepted', 'rejected', 'invoiced')),
  valid_until date,
  notes       text,
  subtotal    bigint NOT NULL DEFAULT 0,
  tax_total   bigint NOT NULL DEFAULT 0,
  total       bigint NOT NULL DEFAULT 0,
  currency    char(3) NOT NULL DEFAULT 'PYG',
  invoice_id  uuid,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, number),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES app.branches (tenant_id, id),
  FOREIGN KEY (tenant_id, customer_id) REFERENCES app.customers (tenant_id, id),
  FOREIGN KEY (tenant_id, invoice_id) REFERENCES app.invoices (tenant_id, id)
);
CREATE INDEX quotes_customer_idx ON app.quotes (tenant_id, customer_id, created_at DESC);

CREATE TABLE app.quote_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES control.tenants(id),
  quote_id    uuid NOT NULL,
  service_id  uuid,
  description text NOT NULL,
  quantity    numeric(10,2) NOT NULL DEFAULT 1,
  unit_price  bigint NOT NULL,
  tax_rate    smallint NOT NULL,
  line_total  bigint NOT NULL,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, quote_id) REFERENCES app.quotes (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, service_id) REFERENCES app.services (tenant_id, id)
);
CREATE INDEX quote_items_quote_idx ON app.quote_items (tenant_id, quote_id);

CREATE TRIGGER trg_quotes_updated BEFORE UPDATE ON app.quotes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS + auditoria: mismas reglas que toda tabla de app.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['quotes', 'quote_items'] LOOP
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
