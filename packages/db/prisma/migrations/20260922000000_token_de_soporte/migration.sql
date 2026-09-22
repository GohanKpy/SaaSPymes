-- Token de soporte por cliente (pedido de Johan 2026-09-22, ADR 0014): el
-- cliente lo genera y se lo da al soporte; sin token nadie de la plataforma
-- entra a su panel. Se guarda hasheado (sha256 con el id del tenant como
-- sal); el valor solo se muestra al generarlo.
ALTER TABLE control.tenants
  ADD COLUMN support_token_hash       text,
  ADD COLUMN support_token_expires_at timestamptz,
  ADD COLUMN support_token_created_at timestamptz,
  ADD COLUMN support_token_created_by uuid;

-- Por ahora (decision de Johan): todos los clientes arrancan con el token
-- inicial 1111, sin vencimiento, hasta que generen uno propio.
UPDATE control.tenants
   SET support_token_hash = encode(sha256(convert_to(id::text || ':' || '1111', 'UTF8')), 'hex'),
       support_token_created_at = now();
