-- Criticos de la auditoria del bot (2026-08-07), autorizados por el dueño:
-- 1) Trazabilidad persistente de las herramientas del bot: hasta ahora cada
--    tool call quedaba solo en los logs del contenedor y se perdia con el
--    redeploy. Cada llamada (nombre, argumentos, resultado o error, duracion)
--    queda consultable por tenant para diagnosticar reservas fallidas.
CREATE TABLE app.bot_tool_calls (
  id              bigserial PRIMARY KEY,
  tenant_id       uuid NOT NULL REFERENCES control.tenants(id),
  conversation_id uuid NOT NULL,
  tool            text NOT NULL,
  args            jsonb NOT NULL DEFAULT '{}'::jsonb,
  ok              boolean NOT NULL,
  -- Resultado (ok) o mensaje de error (no ok), truncado por la aplicacion.
  detail          text,
  duration_ms     int NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, conversation_id) REFERENCES app.conversations (tenant_id, id)
);
CREATE INDEX bot_tool_calls_conv_idx
  ON app.bot_tool_calls (tenant_id, conversation_id, id DESC);

ALTER TABLE app.bot_tool_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.bot_tool_calls FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON app.bot_tool_calls
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

-- 2) Marca "necesita humano": si el proveedor de IA falla, el bot deja un
--    aviso predefinido y la bandeja muestra la conversacion marcada hasta
--    que un humano responda (o el bot vuelva a responder con exito).
ALTER TABLE app.conversations
  ADD COLUMN needs_human boolean NOT NULL DEFAULT false;
