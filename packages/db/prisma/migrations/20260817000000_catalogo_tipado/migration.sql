-- Catalogo tipado (ADR 0009, fase 2): el TIPO vive en el producto.
--   kind 'servicio' → duration_min es el tiempo de la TAREA.
--   kind 'item'     → venta pura; con requires_meeting el bot coordina una
--                     REUNION INICIAL de meeting_min minutos (30 por codigo).
-- La categoria solo aporta un default de conveniencia al crear (default_kind).
-- Absorbe bookable_by_bot: true → servicio; false → item con reunion.

ALTER TABLE app.service_categories
  ADD COLUMN default_kind text NOT NULL DEFAULT 'servicio'
    CHECK (default_kind IN ('servicio', 'item'));

ALTER TABLE app.services
  ADD COLUMN kind text NOT NULL DEFAULT 'servicio'
    CHECK (kind IN ('servicio', 'item')),
  ADD COLUMN requires_meeting boolean NOT NULL DEFAULT false,
  ADD COLUMN meeting_min integer CHECK (meeting_min IS NULL OR meeting_min > 0);

-- Migracion de datos bajo FORCE RLS: el migrator no tiene BYPASSRLS, asi que
-- se recorre tenant por tenant fijando app.tenant_id (doc 03 §4). La duracion
-- que tenia un no-agendable era de hecho la de su reunion: pasa a meeting_min.
DO $$
DECLARE t record;
BEGIN
  PERFORM set_config('app.actor_type', 'system', true);
  FOR t IN SELECT id FROM control.tenants LOOP
    PERFORM set_config('app.tenant_id', t.id::text, true);
    UPDATE app.services
       SET kind = 'item',
           requires_meeting = true,
           meeting_min = COALESCE(duration_min, 30),
           duration_min = NULL
     WHERE bookable_by_bot = false;
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);
END $$;

ALTER TABLE app.services DROP COLUMN bookable_by_bot;
