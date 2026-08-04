# ADR 0002 · Motor del bot multi-proveedor (OpenAI y Anthropic)

**Fecha:** 2026-08-04
**Estado:** aceptado (decision del negocio)

## Contexto

El doc 01 §4 decidio Claude (modelo economico, Haiku) como motor del bot.
El negocio decidio usar su cuenta de OpenAI para este proyecto (la de
Anthropic esta asignada a otros proyectos), y pidio que el sistema quede
preparado para operar con cualquiera de los dos proveedores.

## Decision

`packages/botengine` define las herramientas del bot de forma agnostica al
proveedor (nombre, descripcion, JSON Schema y ejecucion server-side) y dos
implementaciones del turno de conversacion:

- `anthropic`: Claude con tool use (tool runner del SDK oficial).
- `openai`: Chat Completions con function calling (SDK oficial `openai`).

La eleccion es configuracion, no codigo (regla del doc 11 §2):

- `BOT_PROVIDER` = `openai` | `anthropic`
- `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` segun corresponda
- `BOT_MODEL` opcional; por defecto el modelo economico de cada proveedor
  (`gpt-4o-mini` / `claude-haiku-4-5`)

## Consecuencias

- Las reglas de seguridad del doc 05 §6 no dependen del proveedor: los
  permisos tildados definen que herramientas existen, el scoping por
  tenant/conversacion vive en la API, y las instrucciones del tenant son
  datos. Cualquier proveedor nuevo debe implementar la misma interfaz.
- Cambiar de proveedor (o por tenant, a futuro) es cambiar variables.
- El presupuesto de tokens por tenant (pendiente en backlog) debera
  medirse por proveedor.
