# ADR 0011 — Prompt del bot: una regla por tema y barandas en código

- Estado: aceptado
- Fecha: 2026-09-02
- Reemplaza parcialmente: ADR 0008 (mantiene sus tres capas; cambia cómo se
  escriben y quién garantiza cada cosa)

## Contexto

La auditoría del 2026-09-02 (`docs/propuestas/2026-09-02-auditoria-prompts-bot.md`)
midió el prompt que recibía el modelo: 12.475 caracteres de sistema + 7.022 en
descripciones de herramientas (≈ 5.400 tokens fijos por turno), 69 viñetas,
el tema "nombre del cliente" en 9 lugares con matices contradictorios, 58
palabras en MAYÚSCULAS. Cada batería anterior había agregado una regla-parche
por síntoma, y el modelo real era `gpt-4o-mini` (panel sin modelo → default
del código). Resultado observado en una conversación de prueba: 7 de 13
respuestas con falla seria, ninguna por inventar datos de la nada; todas por
órdenes pisándose, formato sin limpiar o decisiones tomadas por el modelo
ante reglas en conflicto.

## Decisión

1. **Un solo dueño por regla.** `buildSystem` se reescribe en bloques con
   cada tema en un único lugar: identidad y fecha · DATOS DEL NEGOCIO
   (horarios, equipo o "sin profesionales para elegir", videollamadas,
   estado del cliente como dato, mensajes pendientes) · COMO USAR LAS
   HERRAMIENTAS (8 reglas numeradas) · COMO CONVERSAR (la guía editable del
   ADR 0008, ahora solo personalidad y estilo) · INDICACIONES DEL NEGOCIO ·
   REGLAS DE SEGURIDAD (5, al final, para que nada las siga). Presupuesto
   vigilado por test: ≤ 25 reglas, < 8.000 caracteres, < 20 palabras en
   mayúsculas.
2. **Las descripciones de herramientas son contrato, no manual.** Dicen qué
   recibe y qué devuelve cada herramienta (< 5.000 caracteres en total, schemas incluidos; antes 7.022);
   cuándo y cómo usarlas vive en el bloque de herramientas del prompt.
3. **Precedencia explícita y única:** los datos del sistema (catálogo,
   horarios, equipo) mandan siempre sobre las indicaciones del negocio; con
   `instructions_override` el negocio prima sobre la guía solo en tono y
   políticas comerciales, nunca sobre seguridad ni sobre datos.
4. **Lo que no depende de que el modelo obedezca se garantiza en código:**
   - `aTextoPlano` a la salida (Markdown fuera; horarios sueltos en una misma
     línea se separan uno por línea). Compartida con el asistente de padmin.
   - Marcador `pendingMessages`: con ≥ 2 mensajes seguidos del cliente sin
     responder, el prompt se lo dice.
   - Equipo vacío se declara explícito (antes la sección faltaba y una regla
     la citaba).
   - Los avisos de respaldo y de presupuesto no entran al historial que lee
     el modelo.
   - **Revisor determinístico** (generaliza el supervisor anti-bucle del
     2026-08-17): tres chequeos sobre la respuesta — pide el nombre por
     segunda vez · menciona ids/herramientas/errores internos · promete una
     acción futura sin haber llamado `request_human` — y UN reintento
     dirigido. Nunca silencio: si el reintento falla, sale la original.
5. **El campo de indicaciones del negocio avisa** (en Ajustes) cuando el
   texto contiene horarios, precios, listas de servicios, pedidos de datos
   obligatorios, marcadores sin rellenar o "verificaré la información":
   cosas que el bot toma del sistema y que, duplicadas, lo confunden.
6. **El modelo se fija desde el panel** (`gpt-4.1-mini` como punto de
   partida) y se compara con la batería; el default del código deja de ser
   una elección implícita.

## Consecuencias

- Menos reglas y sin contradicciones → mejor obediencia del modelo chico;
  ~45 % menos tokens fijos por turno.
- Toda regla nueva del bot entra en UN bloque y desplaza o reemplaza a la
  anterior; agregar una viñeta-parche por síntoma vuelve a fallar el test de
  presupuesto del prompt a propósito.
- Los 13 tests de contrato de `botengine.test.ts` se reescribieron a la nueva
  estructura y suman el presupuesto del prompt y la sobriedad de las
  descripciones de herramientas.
- Los ocho fallos de la conversación del 2026-09-02 son casos de regresión de
  la batería `testear-bot`.
