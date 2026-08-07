-- Consentimiento de prioridad del prompt del tenant (ADR 0008): con true,
-- las indicaciones del negocio priman sobre la guia estandar del sistema
-- (nunca sobre las reglas de seguridad, que viven en el codigo).
ALTER TABLE app.bot_settings
  ADD COLUMN instructions_override boolean NOT NULL DEFAULT false;
