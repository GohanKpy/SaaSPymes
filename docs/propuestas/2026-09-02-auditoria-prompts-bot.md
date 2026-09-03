# Auditoría de prompts del bot de WhatsApp — 2026-09-02

**Estado:** propuesta, pendiente de aprobación de Johan.
**Disparador:** "siento que está alucinando mucho, da respuestas que uno no
pregunta; hay muchas órdenes que podrían estar pisándose entre sí".
**Evidencia:** código real (`apps/api/src/conversations/bot.service.ts`,
`packages/botengine/src/index.ts`, `tools.ts`), prompt de sistema generado
para un tenant con todos los permisos, `app.bot_tool_calls` y `app.messages`
del 2026-09-02 (conversación de prueba de Massi con "Pelo 1").

## 1. Estado actual, medido

| Métrica | Valor |
|---|---|
| Prompt de sistema (tenant con todo activado) | 12.475 caracteres ≈ 3.500 tokens |
| Descripciones + schemas de las 10 herramientas | 7.022 caracteres ≈ 1.950 tokens |
| Tokens fijos por turno antes del historial | ≈ 5.400 |
| Viñetas de reglas que lee el modelo | 69 (11 seguridad + 34 guía estándar + contexto + herramientas) |
| Palabras en MAYÚSCULAS / "jamás-nunca" | 58 / 22 |
| Líneas más largas | 480, 450, 437, 432, 399 caracteres |
| Modelo efectivo | `gpt-4o-mini` (panel: `model = null` → default del código en `openai.ts`) |
| Debounce | 10 s (panel) |

### Recorrido de un mensaje (orden real)

1. Llega (webhook o `/chat`) y se guarda.
2. Debounce 10 s; los mensajes acumulados entran juntos al historial sin
   marca de "N nuevos".
3. Carga: conversación, `bot_settings`, tenant, sucursal, últimos 20
   mensajes, ficha del cliente.
4. `customerContext`: párrafo que ORDENA pedir el nombre en la primera
   respuesta, o lista datos faltantes.
5. Presupuesto mensual + tope horario (funciona bien).
6. `buildSystem`: fecha + calendario 9 días → 11 reglas de seguridad →
   HORARIOS → EQUIPO (solo si hay) → contexto del cliente → guía estándar (34
   reglas) → indicaciones del negocio (texto libre, sin filtro).
7. `buildBotTools`: hasta 10 herramientas, cada una con instrucciones de
   conversación en su description.
8. Runner: hasta 6 iteraciones, temp 0,1, timeout 30 s; los errores de tools
   vuelven al modelo como texto.
9. Supervisor anti-bucle (regex sobre la respuesta + reintento dirigido).
10. Se guarda y envía tal cual (sin limpiar Markdown ni formato).

### Repeticiones y contradicciones

| Tema | Lugares | Veces | Contradicción |
|---|---|---|---|
| Nombre / registro | 2 reglas seg., 4 guía, customerContext, 4 tools, supervisor | 9 | "pedile en tu primera respuesta" vs "JAMÁS es un requisito" |
| Disponibilidad en este mismo turno | 3 reglas seg. + 3 tools | 6 | misma idea, seis redacciones |
| Derivar a humano | 2 seg. + 1 guía + 1 tool | 4 | "en ese mismo turno" / "cuando prometas" / "si pide persona" |
| Confirmar antes de reservar | 1 seg. + 2 guía + 1 tool | 4 | hoy reservó sin que el cliente eligiera el servicio |
| Sin Markdown | guía (1) | 1 | se ignora; nadie limpia a la salida |

### Indicaciones del tenant "Pelo 1" (1.230 caracteres, plantilla pegada)

Contradicen al sistema sin que nada lo frene: "Horario: 11 AM a 9 PM" (el
sistema atiende 08–18); "Solicitar nombre, teléfono, servicio y fecha/hora"
(registro opcional); "Servicios principales: … barbería y maquillaje" (no
están en el catálogo); "indicá que verificarás la información" (prohibido
prometer acciones futuras — el bot dijo textual "Voy a verificar la
disponibilidad"); "Informar formas de pago" (dato inexistente → inventar);
`[TELEFONO]` sin rellenar; ejemplo cortado.

## 2. Conversación del 2026-09-02 (Pelo 1) — fallas observadas

De 13 respuestas del bot, 7 con falla seria. Ninguna es un dato inventado de
la nada; todas son órdenes pisándose, formato sin limpiar o decisiones
tomadas por el modelo:

1. Listó horarios "para el corte de cabello" eligiendo un servicio sin
   preguntar (hay dama/caballero/infantil) + Markdown `**`.
2. Reservó "corte de caballero" a las 14:30 sin confirmación del servicio;
   cierre con muletilla prohibida.
3. Con "quiero cortarme con Marco": Marco aún no existía (creado 17:38; la
   tool respondió bien), pero ofreció "confirmar" un turno ya reservado.
4. Dos mensajes en la ventana de 10 s ("Mi nombre es…" + "quiero turno con
   carlos") → respondió solo al registro. Por dentro SÍ llamó
   `get_available_slots` (19:09:40, con resultados) y no los mostró; mandó
   "carlos" como service_id.
5. Tool devolvió `["08:00","12:00"]` → escribió "08:00 - 12:00" (se lee como
   rango); no dijo para qué servicio.
6. "Voy a verificar la disponibilidad para 14:30": promesa futura, calcada
   de las indicaciones del negocio.
7. "no tengo el ID correcto para el servicio": error interno filtrado al
   cliente (mandó `corte_de_pelo` sin consultar `list_services`).
8. "Corte de pelo y color" → decidió "corte de dama" + "tintura completa"
   sin preguntar.

Los tres avisos de respaldo de la primera sesión fueron por falta de crédito
en OpenAI (no es del prompt), pero quedaron en el historial que el modelo lee.

## 3. Causas raíz

1. La misma orden en muchos lugares con matices distintos (cada parche de
   cada batería sumó una versión).
2. Las descripciones de herramientas son un segundo manual (7 k chars).
3. Indicaciones del negocio sin red ni precedencia clara.
4. Cosas que deberían ser código y son súplicas al modelo: Markdown, errores
   internos filtrados, rangos, multi-mensaje, equipo vacío sin ancla, avisos
   de respaldo en el historial.
5. El supervisor anti-bucle es un parche de la causa 1 (doble costo).
6. Modelo `gpt-4o-mini` por default no elegido; `gpt-4.1-mini` sigue reglas
   notablemente mejor a precio similar.

## 4. Plan propuesto (≈ 2,5 días)

**Fase 1 — Un solo dueño por regla (~1 día).** Prompt de sistema en 5
bloques: identidad+fecha · datos del negocio (horarios, equipo o "sin
profesionales para elegir", videollamada, estado del cliente como dato) ·
uso de herramientas (8 reglas) · cómo conversar (8 reglas) · seguridad (5
reglas duras). Meta ≤ 25 viñetas, ≤ 5.500 chars, sin MAYÚSCULAS. Tool
descriptions reducidas al contrato (~3 k chars). Precedencia única y
explícita: datos del sistema > indicaciones (solo tono/políticas, con
override) > guía. La guía editable (ADR 0008) queda como bloque de
personalidad. Efecto: ~45 % menos tokens fijos por turno.

**Fase 2 — Barandas en código (~½ día).** Limpieza a la salida (Markdown,
horarios como lista); marcador "N mensajes nuevos desde tu última
respuesta"; equipo vacío explícito; avisos de respaldo fuera del historial
del modelo; supervisor → revisor con 3 chequeos (pide nombre otra vez ·
menciona id/herramienta/error · promete acción futura sin request_human) y
un reintento; se retira cuando la batería pase sin él.

**Fase 3 — Indicaciones con red (~½ día).** El campo de Ajustes explica qué
NO poner (horarios, precios, servicios, pedir datos, formas de pago) y avisa
en vivo si lo detecta. Limpiar Pelo 1: decisión de Johan.

**Fase 4 — Modelo y verificación (~½ día).** Fijar modelo en el panel y
probar `gpt-4.1-mini` con la batería; `testear-bot` ampliada con los 8
fallos de hoy como regresión; actualizar los 13 tests de contrato de
`botengine.test.ts`. Nada se despliega sin batería completa en verde.

**No cambia:** aislamiento, permiso apagado = tool inexistente, presupuesto,
tope horario, fallback, `bot_tool_calls`.

## 5. Decisiones pedidas

1. Aprobar fases 1 y 2 juntas (recomendado).
2. ¿Limpiar las indicaciones de "Pelo 1" o dejarlas como caso de prueba?
3. Probar `gpt-4.1-mini` como modelo fijo desde el panel (recomendado,
   reversible).
