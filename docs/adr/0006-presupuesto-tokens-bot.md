# ADR 0006 — Presupuesto mensual de IA: ledger de consumo y corte

- Estado: aceptado
- Fecha: 2026-08-05

## Contexto

`bot_settings.monthly_token_budget` existe desde el doc 03 y el doc 05 §6.4
define el comportamiento ("al agotar presupuesto, el bot pasa a mensaje
genérico y avisa al panel"), pero no había ni registro de consumo ni corte.
Además el presupuesto era editable por el propio tenant, lo que anula el
control de costos del dueño del sistema (doc 09 R9).

## Decisión

1. **Ledger `app.bot_usage_monthly`** (tenant_id, period YYYY-MM en la zona
   del tenant, input_tokens, output_tokens, turns) con RLS ENABLE+FORCE y la
   misma política `tenant_isolation`. Upsert por turno del bot; se registra
   aunque el modelo no produzca texto (los tokens ya se gastaron).
   Migración `20260807000000_bot_usage_y_audit_users`.
2. **Corte**: si el consumo del período ≥ presupuesto, el bot no llama al
   proveedor; responde UNA vez un aviso genérico (sin repetirlo mensaje a
   mensaje) y deja la conversación al personal. Queda warn en logs.
3. **El presupuesto lo edita solo el dueño del sistema** desde la ficha del
   tenant (`PUT /platform/tenants/:id/bot-budget`, auditado). Se quitó del
   PATCH de ajustes del tenant. El tenant ve su consumo y su límite en
   Ajustes (solo lectura).

## Consecuencias

- El panel de plataforma tiene la base del "margen por tenant" (doc 09 R9):
  consumo real por mes ya consultable.
- La misma migración corrige la auditoría de `app.users` para excluir
  `password_hash`/`totp_secret` del audit log (mismo criterio que
  bot_settings y credentials) y limpia lo ya registrado.
