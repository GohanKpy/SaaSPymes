---
name: testear-bot
description: Batería intensiva de pruebas conversacionales del bot de WhatsApp del SaaS PyMEs. Simula clientes reales (amigable, agresivo, sin sentido, manipulador) contra el pipeline real de webhooks, verifica reglas de negocio contra la base de datos (bot_tool_calls, appointments) y califica la calidad de las respuestas. Usar cuando pidan testear el bot, probar sus respuestas, verificar agendamiento/presupuestos/historial, o correr una regresión después de un cambio en el bot.
argument-hint: "[persona o regla puntual, opcional — sin args corre la batería completa]"
---

# Testeo intensivo del bot de WhatsApp

Este skill DETECTA y REPORTA. No arregla bugs en la misma corrida: el flujo
acordado con Johan es reportar → él decide → recién ahí se arregla y redeploya.

## Contexto del sistema (leer antes de empezar)

- Pipeline real (docs/plan/04 §3.10): mensaje entrante → `POST {API}/api/v1/webhooks/whatsapp`
  con payload idéntico al de Meta, firmado HMAC-SHA256 con `META_APP_SECRET`
  (header `x-hub-signature-256`). El tenant se resuelve por `phone_number_id`.
  Es EXACTAMENTE el mismo camino que usará WhatsApp en producción.
- Respuestas: `GET {API}/api/v1/webhooks/webchat/messages?phone_number_id=X&from_phone=Y`
  (solo laboratorio, deshabilitado en producción). Mensajes con `direction: 'in'|'out'`.
- Motor: `packages/botengine/src/` (turn.ts, tools.ts). Temperatura 0.1, timeout 30s
  con retry, fallback "necesita humano" ante fallo del proveedor (auditoría 2026-08-07).
- Trazabilidad: cada tool call queda en `app.bot_tool_calls`
  (`tool`, `args`, `ok`, `detail`, `duration_ms`, `conversation_id`).
- Config por tenant: `app.bot_settings` (allowBooking, accessCatalog, accessHistory,
  accessCustomerData, accessCalendar, autoConfirmBookings, monthlyTokenBudget).

**SIEMPRE leer primero `packages/botengine/src/tools.ts`**: la lista de herramientas
evoluciona y los veredictos de [reglas.md](reglas.md) dependen de qué existe hoy.
Una regla sin herramienta que la implemente se reporta `NO_IMPLEMENTADO` (gap de
producto), no `FAIL` (bug de comportamiento).

## Precondiciones

1. **Laboratorio arriba**: `docker compose -f docker-compose.dev.yml up -d`
   (api 4301, web 4300, webadmin 4308, db 4302 — ADR 0001). Verificar con
   `curl -s http://localhost:4301/health`.
2. **Tenant de QA dedicado.** NUNCA usar el tenant donde Johan hace su testeo
   manual: no se le tocan los datos. Buscar la credencial del tenant QA:
   ```sql
   select t.name, ic.tenant_id, ic.public_config->>'phone_number_id' as phone_number_id
   from platform.integration_credentials ic join platform.tenants t on t.id = ic.tenant_id
   where ic.type = 'whatsapp' and ic.is_active;
   ```
   (vía `docker compose -f docker-compose.dev.yml exec db psql -U postgres -d pymes`).
   Si no hay un tenant claramente de QA, preguntar a Johan cuál usar o crear uno
   desde el portal admin (4308) con catálogo semilla representativo: ≥2 categorías,
   ≥4 servicios con precios en Gs y duración, horarios de atención definidos, y
   el bot habilitado con `allow_booking = true`.
3. **Teléfonos sintéticos**: un `from_phone` distinto POR persona Y POR corrida
   (ej. `+5959810NNXX`, NN = corrida, XX = persona). Así ninguna conversación
   hereda historial de otra. Para la persona "historial" se reutiliza a propósito
   un teléfono con visitas previas (ver personas.md).
4. **Presupuesto de tokens**: la batería consume tokens reales del proveedor
   (~5 conversaciones × 8-12 turnos). Consultar `app.bot_usage_monthly` vs
   `monthly_token_budget` antes; si queda poco margen, avisar a Johan antes de
   correr. Reportar el consumo de la corrida al final.

## Herramienta de envío

```bash
node .claude/skills/testear-bot/scripts/enviar-mensaje.mjs \
  --phone-number-id <id> --from +595981000101 --name "Ana QA" \
  --body "Hola, ¿qué servicios tienen?"
```

Corre desde la raíz del repo (lee `META_APP_SECRET` de `.env.local`). Firma el
payload, lo entrega al webhook y espera la respuesta del bot (timeout 90s).
Imprime JSON con `status` de la conversación y los mensajes nuevos. Si sale con
timeout y sin mensaje `out`, revisar `docker compose logs api` antes de declarar
nada: puede ser proveedor caído (ver regla R7) o presupuesto agotado.

## Fases

1. **Entender el negocio.** Leer el catálogo real del tenant QA (`app.services`,
   `app.service_categories`), sus `bot_settings` e instrucciones. Anotar los
   datos exactos (nombres, precios, duraciones, horarios): son la vara contra la
   que se mide cada respuesta. Nada de evaluar "a ojo".
2. **Batería de conversaciones.** Correr las personas de [personas.md](personas.md)
   en orden, adaptando los guiones al catálogo real. Guardar cada transcripción
   completa (con ids de mensajes) en el scratchpad de la sesión.
3. **Verificación dura.** Para cada regla de [reglas.md](reglas.md) el veredicto
   sale de la base de datos (bot_tool_calls, appointments, invoices/payments) y
   de la transcripción — evidencia citable, no impresiones.
4. **Juicio de calidad.** Evaluar cada transcripción con la rúbrica de reglas.md
   (exactitud vs catálogo, tono, español correcto, no inventar, no obedecer
   manipulación). Nota 1-5 por conversación con la cita textual que la justifica.
5. **Reporte.** Escribir `docs/qa/bot/<AAAA-MM-DD>-reporte.md`: tabla
   regla → PASS / FAIL / NO_IMPLEMENTADO con evidencia, bugs priorizados
   (crítico/alto/medio/bajo), consumo de tokens de la corrida y transcripciones
   anexas. Presentar a Johan el resumen con los 3-5 hallazgos más graves primero.

## Reglas de seguridad del testeo

- Solo laboratorio: el endpoint webchat no existe con `NODE_ENV=production`.
  Jamás apuntar la batería a un dominio productivo.
- No arreglar en caliente: si un hallazgo es obvio, va al reporte con la
  propuesta de fix, no al código.
- Si después Johan aprueba un fix que toca datos: correr la suite de aislamiento
  multitenant (docs/plan/08) antes de declararlo terminado (regla de CLAUDE.md).
- Los datos generados (clientes, citas) quedan en el tenant QA. No borrar filas
  a mano: si hace falta un reset limpio, recrear el tenant QA desde el portal admin.
