-- Recordatorios de turnos por WhatsApp (P1 replanteo 2026-08-26).
-- Config por tenant en bot_settings (mensajeria del negocio); el turno marca
-- reminder_sent_at para no repetir. Con envio real (live) fuera de la ventana
-- de 24 h, Meta exige plantilla aprobada: el tenant carga SU nombre de
-- plantilla; en laboratorio el mensaje queda en la conversacion igual.
ALTER TABLE app.appointments
  ADD COLUMN reminder_sent_at timestamptz;

ALTER TABLE app.bot_settings
  ADD COLUMN reminder_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN reminder_hours smallint NOT NULL DEFAULT 24
    CHECK (reminder_hours BETWEEN 1 AND 72),
  ADD COLUMN reminder_template text,
  ADD COLUMN reminder_template_lang text NOT NULL DEFAULT 'es';

-- Barrido eficiente: turnos vigentes sin recordatorio enviado.
CREATE INDEX appointments_reminder_idx ON app.appointments (tenant_id, starts_at)
  WHERE reminder_sent_at IS NULL AND deleted_at IS NULL
    AND status IN ('pending', 'confirmed');
