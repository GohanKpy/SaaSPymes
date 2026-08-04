# Proyecto: SaaS de Gestion para PyMEs

La arquitectura aprobada esta en docs/plan. Es la fuente de verdad.
Antes de cualquier tarea, leer el documento relevante.

Reglas:
- Ninguna tarea que toque datos se declara terminada sin correr la suite
  de aislamiento multitenant (docs/plan/08).
- Nunca editar migraciones ya aplicadas.
- Todo desvio de la arquitectura requiere un ADR en docs/adr.
- Ningun endpoint, bucket, cola ni host va fijo en el codigo (docs/plan/11).
