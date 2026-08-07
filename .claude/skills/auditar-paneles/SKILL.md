---
name: auditar-paneles
description: Auditoría de arquitectura de información de los paneles del SaaS PyMEs (portal de clientes y portal admin en apps/web). Mapea todas las páginas y secciones, detecta pantallas sobrecargadas u opciones mal ubicadas y propone reorganización en subpáginas con plan de migración. Usar cuando pidan revisar/organizar/reubicar los paneles, secciones o la navegación. Para estética visual (botoneras, espaciados, colores) usar estetica-dashboard.
---

# Auditoría de paneles: organización y navegación

Este skill produce un INFORME con propuesta. No mueve ninguna página sin que
Johan apruebe la propuesta — reorganizar navegación cambia URLs que él y sus
testers ya conocen.

## Alcance

Una sola app Next (`apps/web/app`) sirve dos portales (ADR 0004):

- **Portal de clientes** (contendor `web`, puerto 4300, client.inicia.com.py):
  `/app/*` — hoy: catalog, customers, inbox, invoices, schedule, settings, team.
  Más `/login` y `/chat` (simulador de laboratorio, fuera del alcance de UX).
- **Portal del dueño** (contenedor `webadmin`, puerto 4308, admin.inicia.com.py):
  `/platform/*` — hoy: login, tenants, tenants/[id]. `middleware.ts` decide qué
  portal sirve cada contenedor vía la env `PORTAL`.

## Método

1. **Mapa real.** `find apps/web/app -name "page.tsx"` y leer cada página con
   sus componentes. Para pantallas grandes conviene lanzar agentes Explore en
   paralelo (uno por página). De cada pantalla inventariar: secciones, cantidad
   de controles/acciones, tabs o sub-vistas embebidas, formularios, y a cuántos
   clics/scrolls queda cada opción.
2. **Diagnóstico.** Buscar señales concretas:
   - Páginas con más de una responsabilidad clara (ej. settings monolítico que
     mezcla negocio + bot + integraciones + notificaciones).
   - Opciones enterradas: acciones frecuentes a ≥3 interacciones de profundidad.
   - Listas y fichas mezcladas en una misma vista cuando ameritan detalle propio
     (patrón ya usado en `platform/tenants/[id]` — replicarlo donde falte).
   - Inconsistencias de navegación entre portales (mismo concepto, distinto lugar).
   - Crecimiento previsible: qué pantallas van a explotar cuando haya más datos
     o features (consultar docs/plan/07 roadmap).
3. **Propuesta.** Tabla `ruta actual → ruta propuesta` con justificación de una
   línea por movimiento, jerarquía nueva (subpáginas con layout de tabs o
   sidebar secundaria de Next: `layout.tsx` por grupo), y qué NO tocar (lo que
   ya funciona bien también se dice). Incluir impacto: links internos,
   redirecciones necesarias, `middleware.ts`, deep links que se rompen.
4. **Informe.** Escribir `docs/qa/paneles/<AAAA-MM-DD>-informe.md` y presentar a
   Johan el resumen: 3-5 movimientos de mayor impacto primero, cada uno con su
   porqué en una frase. Esperar su aprobación (puede aprobar parcialmente).
5. **Implementación (solo lo aprobado).** Mover páginas preservando URLs viejas
   con redirect cuando sean URLs que Johan ya usa. Al terminar recordar:
   - rebuild de `web` Y `webadmin` juntos (comparten imagen).
   - si cambió alguna URL visible, avisar a Johan que actualice su archivo de
     accesos (`D:\Proyectos\SaaS-Pymes\Docs\accesos-y-urls.txt`).

## Reglas

- Ningún host/puerto fijo en código (docs/plan/11); todo desvío de arquitectura
  requiere ADR en docs/adr (CLAUDE.md).
- `/platform` jamás debe quedar alcanzable desde el portal de clientes (ADR 0004):
  cualquier movimiento se verifica contra `middleware.ts`.
- No mezclar esta auditoría con cambios de lógica: mover ≠ refactorizar. Si al
  mover aparece un bug, se reporta aparte.
