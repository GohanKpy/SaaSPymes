-- Padron de contribuyentes de la DNIT (ADR 0012, pedido de Johan 2026-09-08).
-- Copia local del listado publico de RUC que la DNIT publica en 10 archivos
-- (ruc0.zip .. ruc9.zip, formato ruc|razon social|dv|ruc anterior|estado|).
-- Es dato publico y compartido: vive en `control`, sin tenant_id ni RLS.
-- Lo mantiene un cron in-process de la API (RucPadronService) y lo consultan
-- los formularios de clientes y facturas para completar razon social y DV
-- al tipear el RUC.

CREATE TABLE control.ruc_contribuyentes (
  ruc           text PRIMARY KEY,           -- sin DV; puede traer letra final (ej. 1023860A)
  dv            char(1) NOT NULL,
  razon_social  text NOT NULL,
  ruc_anterior  text,
  estado        text NOT NULL,              -- ACTIVO | SUSPENSION TEMPORAL | BLOQUEADO | CANCELADO | CANCELADO DEFINITIVO
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Historial de corridas (manual desde el panel o cron): lo muestra el padmin.
CREATE TABLE control.ruc_padron_runs (
  id            bigserial PRIMARY KEY,
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  status        text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'ok', 'error')),
  triggered_by  text NOT NULL CHECK (triggered_by IN ('cron', 'manual', 'startup')),
  actor_id      uuid REFERENCES control.platform_users(id),
  files_ok      integer NOT NULL DEFAULT 0,
  rows_read     integer NOT NULL DEFAULT 0,
  rows_changed  integer NOT NULL DEFAULT 0,
  error         text
);

CREATE INDEX ruc_padron_runs_started_idx ON control.ruc_padron_runs (started_at DESC);
