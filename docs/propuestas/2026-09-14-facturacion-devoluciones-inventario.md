# Facturación (anulación SIFEN), devoluciones e inventario — 2026-09-14

**Pedidos de Johan (2026-09-14):** (1) averiguar el plazo de SIFEN para
anular una factura emitida, botón de anular dentro del período hábil y todas
las implicancias (aviso, registros, motivo obligatorio) "para no incumplir
nada"; (2) devoluciones con gestión interna: el bot canaliza, se notifica y
una persona valida (cliente posiblemente frustrado); (3) inventario para la
venta de artículos con combos, "cubriendo lo que un sistema profesional debe
cumplir", y empezar el desarrollo.

**Estado:** fase 1 implementada el 2026-09-14. Decisiones y detalle en
[ADR 0013](../adr/0013-inventario-devoluciones-anulacion-sifen.md).

## Lo que dice SIFEN (resumen para el dueño)

| Tema | Regla | Fuente |
|---|---|---|
| Plazo para anular una factura | 48 horas corridas desde la **aprobación** del comprobante por SIFEN | RG 23/2019 art. 22; Manual Técnico v150 |
| Plazo para anular otros comprobantes (nota de crédito, etc.) | 168 horas (7 días) | Manual Técnico v150 |
| Motivo | Obligatorio en el evento de cancelación, 5 a 500 caracteres | Manual Técnico v150 (`mOtEve`) |
| Condiciones | El comprobante debe estar aprobado; si tiene notas de crédito/débito asociadas, primero se cancelan esas | RG 23/2019; FAQ e-Kuatia (DNIT) |
| Efecto | Definitivo; sin validez fiscal; se conserva intacto por el plazo de prescripción; el número no se reutiliza | FAQ e-Kuatia (DNIT) |
| Después del plazo | Nota de crédito electrónica (total o parcial), que también pasa por SIFEN | RG 23/2019 art. 22 |
| Avisar al receptor | No es obligatorio por norma; el receptor puede verificar por CDC. Buena práctica avisar, y necesario si ya pagó | FAQ e-Kuatia (DNIT) |

## Qué quedó implementado

- Anular con plazo real, motivo validado, respuesta de SIFEN guardada,
  reversión de stock, aviso al cliente y tarea si había pagos; bloqueo si hay
  NC asociada; KuDE "ANULADA".
- Nota de crédito total o parcial con reingreso opcional al stock, KuDE
  propio y aviso al cliente.
- Devoluciones: tool del bot + regla del prompt, tabla propia, tarea y
  correo al equipo, decisión con nota y aviso, cierre con reingreso/NC.
- Inventario fase 1: SKU/unidad/mínimo/costo promedio, combos con
  componentes, existencias por sucursal, kardex, ingresos, ajustes,
  traslados, validación y descuento al emitir, alertas de mínimo,
  disponibilidad para el bot.

## Cómo probar (tenant QA)

1. Catálogo → editar un ítem → "Controlar stock", mínimo 5 → Inventario →
   Ingresar 10 con costo → aparece con valor a costo.
2. Crear un combo con 2 × ese ítem → Inventario muestra "5 armables".
3. Facturar 1 combo → emitir → el ítem queda en 8; facturar 10 → "Sin stock
   suficiente".
4. Anular la factura (dentro de 48 h) con motivo → stock vuelve a 10, KuDE
   "ANULADA", tarea si tenía pagos, mensaje al cliente.
5. Factura vieja (más de 48 h): botón "Nota de crédito" parcial con "vuelven
   al stock" → NC aprobada, factura sigue aprobada; total → "acreditada".
6. WhatsApp: "quiero devolver el shampoo que compré ayer, vino roto" → el bot
   pregunta/registra y deriva; Facturación → Devoluciones → Aprobar con nota
   → el cliente recibe el aviso; Cerrar con reingreso.
