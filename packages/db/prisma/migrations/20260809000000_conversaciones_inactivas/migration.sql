-- Conversaciones inactivas con resumen al perfil (pedido 2026-08-07):
-- >2 h sin mensajes => status 'inactive'; si el tenant habilito los
-- resumenes (opt-in por costo de tokens), el cierre genera un resumen que
-- queda en la ficha del cliente para seguimiento.
ALTER TABLE app.conversations DROP CONSTRAINT conversations_status_check;
ALTER TABLE app.conversations ADD CONSTRAINT conversations_status_check
  CHECK (status IN ('bot_active','paused','agent','closed','inactive'));

ALTER TABLE app.bot_settings
  ADD COLUMN summaries_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE app.customers
  ADD COLUMN last_conversation_summary text,
  ADD COLUMN last_summary_at timestamptz;
