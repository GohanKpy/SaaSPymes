-- Horarios de atencion por sucursal (pedido 2026-08-07): plantilla semanal
-- con hasta 2 franjas por dia (el hueco del mediodia = almuerzo) y fechas
-- cerradas puntuales. '{}' = horario por defecto del laboratorio (08-18).
ALTER TABLE app.branches
  ADD COLUMN schedule jsonb NOT NULL DEFAULT '{}';
