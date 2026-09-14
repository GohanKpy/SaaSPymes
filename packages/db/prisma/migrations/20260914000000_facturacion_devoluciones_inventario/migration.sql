-- Pedidos de Johan 2026-09-14: anulacion SIFEN completa, devoluciones con
-- validacion humana e inventario de items (fase 1). ADR 0013.

-- 1) Anulacion: respuesta de SIFEN al evento de cancelacion y aviso al cliente.
ALTER TABLE app.invoices
  ADD COLUMN cancel_sifen_code   text,
  ADD COLUMN cancel_notified_at  timestamptz,
  -- Nota de credito: si sus items volvieron al stock.
  ADD COLUMN restocked_at        timestamptz;

-- 2) Devoluciones: el bot o el panel registran el pedido; una persona lo valida.
CREATE TABLE app.return_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES control.tenants(id),
  customer_id     uuid NOT NULL,
  conversation_id uuid,
  invoice_id      uuid,
  service_id      uuid,
  description     text NOT NULL,          -- que producto y que paso (palabras del cliente)
  reason          text,                   -- motivo resumido
  status          text NOT NULL DEFAULT 'requested'
                  CHECK (status IN ('requested', 'reviewing', 'approved', 'rejected', 'completed')),
  resolution      text,                   -- nota de quien decidio
  handled_by      uuid,
  decided_at      timestamptz,
  completed_at    timestamptz,
  credit_note_id  uuid,
  restocked_at    timestamptz,
  created_via     text NOT NULL DEFAULT 'panel' CHECK (created_via IN ('bot', 'panel')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, customer_id)     REFERENCES app.customers (tenant_id, id),
  FOREIGN KEY (tenant_id, conversation_id) REFERENCES app.conversations (tenant_id, id),
  FOREIGN KEY (tenant_id, invoice_id)      REFERENCES app.invoices (tenant_id, id),
  FOREIGN KEY (tenant_id, service_id)      REFERENCES app.services (tenant_id, id),
  FOREIGN KEY (tenant_id, credit_note_id)  REFERENCES app.invoices (tenant_id, id)
);
CREATE INDEX return_requests_status_idx ON app.return_requests (tenant_id, status, created_at DESC);
CREATE INDEX return_requests_customer_idx ON app.return_requests (tenant_id, customer_id);
ALTER TABLE app.return_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.return_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON app.return_requests
  USING (tenant_id = app.current_tenant()) WITH CHECK (tenant_id = app.current_tenant());
CREATE TRIGGER trg_return_requests_touch BEFORE UPDATE ON app.return_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_return_requests_audit AFTER INSERT OR UPDATE OR DELETE ON app.return_requests
  FOR EACH ROW EXECUTE FUNCTION app.row_audit();

-- 3) Inventario (fase 1): datos del item, combos, existencias por sucursal y
--    libro de movimientos (la verdad); stock_levels es el saldo materializado.
ALTER TABLE app.services
  ADD COLUMN sku         text,
  ADD COLUMN barcode     text,
  ADD COLUMN unit        text    NOT NULL DEFAULT 'unidad',
  ADD COLUMN track_stock boolean NOT NULL DEFAULT false,
  ADD COLUMN min_stock   numeric(12,2) NOT NULL DEFAULT 0,
  -- Costo promedio ponderado (guaranies) actualizado en cada ingreso con costo.
  ADD COLUMN cost        bigint  NOT NULL DEFAULT 0,
  ADD COLUMN is_combo    boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX services_sku_unique ON app.services (tenant_id, sku)
  WHERE sku IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE app.item_components (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES control.tenants(id),
  parent_service_id    uuid NOT NULL,
  component_service_id uuid NOT NULL,
  quantity             numeric(12,2) NOT NULL CHECK (quantity > 0),
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, parent_service_id, component_service_id),
  CHECK (parent_service_id <> component_service_id),
  FOREIGN KEY (tenant_id, parent_service_id)    REFERENCES app.services (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, component_service_id) REFERENCES app.services (tenant_id, id)
);
ALTER TABLE app.item_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.item_components FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON app.item_components
  USING (tenant_id = app.current_tenant()) WITH CHECK (tenant_id = app.current_tenant());
CREATE TRIGGER trg_item_components_audit AFTER INSERT OR UPDATE OR DELETE ON app.item_components
  FOR EACH ROW EXECUTE FUNCTION app.row_audit();

CREATE TABLE app.stock_levels (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES control.tenants(id),
  service_id uuid NOT NULL,
  branch_id  uuid NOT NULL,
  quantity   numeric(12,2) NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, service_id, branch_id),
  FOREIGN KEY (tenant_id, service_id) REFERENCES app.services (tenant_id, id),
  FOREIGN KEY (tenant_id, branch_id)  REFERENCES app.branches (tenant_id, id)
);
ALTER TABLE app.stock_levels ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.stock_levels FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON app.stock_levels
  USING (tenant_id = app.current_tenant()) WITH CHECK (tenant_id = app.current_tenant());

-- Libro de movimientos: solo se agrega, nunca se edita ni se borra.
CREATE TABLE app.stock_movements (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES control.tenants(id),
  service_id     uuid NOT NULL,
  branch_id      uuid NOT NULL,
  kind           text NOT NULL CHECK (kind IN ('initial', 'purchase', 'sale', 'sale_reversal', 'return', 'adjustment', 'transfer_in', 'transfer_out')),
  quantity       numeric(12,2) NOT NULL CHECK (quantity <> 0),   -- con signo
  unit_cost      bigint,                                          -- guaranies, en ingresos
  balance_after  numeric(12,2) NOT NULL,
  reference_type text CHECK (reference_type IN ('invoice', 'credit_note', 'return_request', 'manual')),
  reference_id   uuid,
  note           text,
  created_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, service_id) REFERENCES app.services (tenant_id, id),
  FOREIGN KEY (tenant_id, branch_id)  REFERENCES app.branches (tenant_id, id)
);
CREATE INDEX stock_movements_service_idx ON app.stock_movements (tenant_id, service_id, created_at DESC);
CREATE INDEX stock_movements_branch_idx  ON app.stock_movements (tenant_id, branch_id, created_at DESC);
CREATE INDEX stock_movements_ref_idx     ON app.stock_movements (tenant_id, reference_type, reference_id);
ALTER TABLE app.stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.stock_movements FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON app.stock_movements
  USING (tenant_id = app.current_tenant()) WITH CHECK (tenant_id = app.current_tenant());

ALTER TABLE app.tenant_settings
  ADD COLUMN allow_negative_stock boolean NOT NULL DEFAULT false,
  ADD COLUMN low_stock_alerts     boolean NOT NULL DEFAULT true;
