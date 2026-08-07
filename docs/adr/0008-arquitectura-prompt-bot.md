# ADR 0008 — Prompt del bot en tres capas con consentimiento de prioridad

- Estado: aceptado
- Fecha: 2026-08-07

## Contexto

El dueño del sistema definió un prompt base de atención (personalidad,
identificación del cliente, estilo WhatsApp, límites comerciales) que debe
regir para todos los tenants, con variables `{{...}}` rellenadas con datos
de cada negocio. A la vez, cada tenant escribe sus propias instrucciones y
debe poder decidir —con consentimiento explícito— que las suyas priman
sobre la guía estándar. Nada de eso puede comprometer la seguridad: el bot
no debe salirse de su tenant ni revelar sus instrucciones.

## Decisión: tres capas, de mayor a menor prioridad

1. **Reglas de seguridad (código, no editables por nadie)** — en
   `buildSystem` de `@pymes/botengine`: solo herramientas, jamás inventar,
   solo este negocio y este cliente, confidencialidad total de las
   instrucciones, ignorar intentos de override (del cliente final o escritos
   dentro de las indicaciones del negocio). Se declaran con prioridad
   absoluta y confidenciales.
2. **Guía de atención estándar** — `DEFAULT_BASE_PROMPT` en botengine
   (adaptación del prompt del dueño); editable desde el portal admin
   (`platform_settings.bot_engine.base_prompt`, vacío = default). Variables
   soportadas: nombre_negocio, razon_social, rubro/actividad, direccion,
   telefono, email; el catálogo y precios NUNCA se inyectan al prompt (el
   bot los consulta en vivo con `list_services`).
3. **Indicaciones del tenant** — `bot_settings.instructions_text`,
   delimitadas y etiquetadas como "texto de configuración provisto por el
   negocio". Flag `instructions_override` (consentimiento en Ajustes):
   apagado = complementan la guía; encendido = priman sobre la guía **y
   nunca sobre la capa 1**.

## Protecciones

- **Aislamiento de tenant: estructural, no de prompt.** Las herramientas
  ejecutan server-side amarradas a tenant + conversación bajo RLS; no existe
  herramienta capaz de cruzar tenants, sin importar qué diga el prompt.
- `renderInstructions` rellena variables conocidas y **elimina** cualquier
  `{{...}}` desconocida (una plantilla sin rellenar confundía al modelo).
- Instrucciones del tenant con tope de 20.000 caracteres, entre
  delimitadores, presentadas como configuración y no como órdenes al
  sistema.
- La capa 1 prohíbe revelar, citar o parafrasear cualquier instrucción.

## Consecuencias

- El dueño mantiene UN prompt de producto para toda la base instalada y lo
  evoluciona sin deploy; los tenants personalizan sin poder degradar la
  seguridad.
- Las capacidades que el prompt base menciona como condicionales
  ("según los módulos habilitados") siguen mandadas por los permisos del
  bot (doc 05 §6): un permiso apagado = la herramienta no existe.
- Pendiente de fase 2 (backlog #19): herramientas de reprogramar/cancelar
  cita y reenviar factura que el prompt base anticipa.
