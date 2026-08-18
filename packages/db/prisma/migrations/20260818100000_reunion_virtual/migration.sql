-- Reunion virtual configurable por tenant (pedido 2026-08-17): el bot solo
-- ofrece videollamada si el negocio cargo su link (Meet/Zoom). NULL = la
-- modalidad virtual NO existe para ese negocio y el bot no la promete.
ALTER TABLE app.bot_settings ADD COLUMN virtual_meeting_link text;
