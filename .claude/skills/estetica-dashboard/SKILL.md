---
name: estetica-dashboard
description: Orden y estética visual de los dashboards del SaaS PyMEs (apps/web, portales cliente y admin) — jerarquía visual, agrupación de opciones, botoneras, divisiones/separadores, consistencia de espaciados y colores, contraste, estados vacíos. Usar cuando pidan mejorar el aspecto, ordenar opciones, unificar botones o "que se vea mejor" un panel. Para reubicar páginas o reorganizar la navegación usar auditar-paneles.
---

# Estética y orden visual del dashboard

A diferencia de auditar-paneles (que propone y espera aprobación), acá los
ajustes de bajo riesgo — solo clases Tailwind, orden de elementos dentro de la
misma pantalla, agrupación visual — se pueden aplicar directamente. Cambios que
alteren flujo o lógica, o rediseños enteros de una pantalla: propuesta primero.

## Paso 1 — Inventario del sistema de diseño de facto

Antes de tocar nada, relevar qué "sistema" existe hoy en `apps/web`:

- Botones: grep de variantes (`bg-slate-900`, `bg-blue-`, `rounded-`, tamaños de
  padding). Listar cuántas variantes distintas de botón primario conviven.
- Tarjetas/secciones, tablas, formularios (labels, inputs, mensajes de error —
  los errores van en rojo con detalle de campo: decisión ya tomada, commit 7f40e05),
  títulos de página y de sección.
- Componentes compartidos: si los patrones viven copiados y pegados en cada
  página, proponer extraer los 3-4 más repetidos (Button, Card/Section, tabla)
  a una carpeta de componentes compartidos ANTES de retocar página por página —
  si no, la unificación se desunifica sola en un mes.

## Paso 2 — Checklist por pantalla

- **Jerarquía**: UNA acción primaria por pantalla, visualmente dominante. Lo
  secundario, secundario (outline/ghost). Si todo grita, nada se ve.
- **Botoneras**: orden consistente en todo el producto (primaria siempre en el
  mismo extremo); acciones destructivas separadas del resto y en rojo, nunca
  pegadas a la primaria; agrupar por afinidad, no por orden de llegada al código.
- **Agrupación y divisiones**: opciones relacionadas juntas bajo un título de
  sección; separar con espacio y jerarquía tipográfica antes que con bordes —
  divider solo cuando el espacio no alcanza. Nada de formularios-sábana: dividir
  en secciones con título.
- **Consistencia**: mismos espaciados (escala 4/8), mismos radios, misma paleta
  slate + un solo color de acento en ambos portales. Mismo concepto = mismo
  aspecto en portal cliente y admin.
- **Contraste**: texto legible sobre su fondo SIEMPRE, en ambos portales. Ya
  pasó: labels `text-slate-700` invisibles sobre `bg-slate-800` en el login del
  admin (commit 3925f85). Ante fondo oscuro, verificar cada clase de texto.
- **Estados**: vacío (con guía de qué hacer, no una tabla en blanco), cargando,
  error. Un dashboard nuevo sin datos es la primera impresión del cliente.
- **Densidad**: tablas con muchas columnas → priorizar columnas clave y mandar
  el resto al detalle; números en Gs alineados a la derecha con separador de
  miles (formato ya acordado: `150.000`).

## Paso 3 — Verificación visual

No declarar terminado un cambio estético sin verlo renderizado: levantar el
laboratorio (`docker compose -f docker-compose.dev.yml up -d`, web 4300 y
webadmin 4308) y usar el skill `run` para capturas de las pantallas tocadas,
en ambos portales. El JSX puede "leerse bien" y verse mal.

## Entrega

- Cambios aplicados: lista de pantallas tocadas con antes/después (capturas) y
  qué regla del checklist motivó cada cambio.
- Cambios propuestos (los de mayor riesgo): en `docs/qa/paneles/` junto a los
  informes de auditar-paneles, para decidirlos con Johan.
- Recordar al cerrar: rebuild de `web` Y `webadmin` juntos; este skill no toca
  datos ni lógica — si un cambio necesita tocar lógica, frenar y avisar.
