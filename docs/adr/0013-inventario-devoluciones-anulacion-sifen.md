# ADR 0013 — Inventario de ítems, devoluciones con validación humana y anulación según SIFEN

- Estado: aceptado (fase 1 implementada)
- Fecha: 2026-09-14

## Contexto

Pedidos del dueño (2026-09-14):

1. **Anulación de facturas**: averiguar el plazo de SIFEN, poner un botón de
   anular dentro del período hábil y cumplir todo lo que implica (motivo,
   aviso, registros) "para no tener problemas".
2. **Devoluciones**: la gestión es interna; el bot puede canalizar al cliente
   pero hay que notificar y pedir intervención humana para validar. Es un
   caso crítico con un cliente posiblemente frustrado.
3. **Inventario** para la venta de artículos, con combos (varios ítems o
   varias unidades del mismo), cubriendo lo que un sistema profesional debe
   cumplir, y empezar el desarrollo.

## Qué dice SIFEN sobre anular (investigado el 2026-09-14)

Fuentes: Resolución General N° 23/2019 (SET), art. 22; Manual Técnico SIFEN
v150 (DNIT), sección de eventos; Preguntas frecuentes e-Kuatia (DNIT).

- **Evento de cancelación**: el emisor puede pedir la cancelación de una
  **Factura Electrónica hasta 48 horas** después de la fecha y hora de
  **aprobación** del DTE por SIFEN (no de la emisión). Para los demás DTE
  (nota de crédito, nota de débito, autofactura, etc.) el plazo es de **168
  horas** (7 días). Son horas corridas. (En e-Kuatia'i, el sistema gratuito
  para pequeños contribuyentes, la factura tiene 120 h; no aplica a este
  producto, que usa SIFEN por proveedor.)
- **Motivo obligatorio** en el evento (campo `mOtEve`, 5 a 500 caracteres).
- **Condiciones**: el DTE debe estar aprobado y almacenado en SIFEN; si la
  factura tiene notas de crédito o débito asociadas, **primero se cancelan
  esas**; los eventos del receptor (conformidad, disconformidad,
  desconocimiento, notificación de recepción) se registran del lado del
  receptor y no los emite nuestro sistema.
- **Efectos**: la cancelación es **definitiva**; el DTE cancelado no respalda
  débito ni crédito fiscal ni ingresos/costos; **debe conservarse intacto**
  por el plazo de prescripción; el número **no se reutiliza**.
- **Después del plazo**: **Nota de Crédito Electrónica** (total o parcial),
  que es un DTE propio con su numeración, referencia el CDC de la factura
  original y también pasa por SIFEN.
- **Aviso al receptor**: la normativa no lo exige; el receptor puede
  verificar el estado por el CDC en la consulta pública de la DNIT. Se
  considera buena práctica avisarle, y necesario si ya pagó.
- **Inutilización**: para números no usados (no aplica: numeramos al emitir).

## Decisión

### 1. Anulación

- `POST /invoices/:id/cancel { reason (5..500), notify_customer }`: plazo
  calculado desde `approved_at` (48 h factura, 168 h nota de crédito);
  409 `use-credit-note` fuera de plazo; 409 si hay NC aprobada asociada
  (anular la NC primero); evento al proveedor SIFEN con el motivo; se guarda
  `cancel_reason`, `cancelled_by/at`, `cancel_sifen_code`; el registro nunca
  se borra (auditoría por trigger); el KuDE imprime "ANULADA"; el stock
  descontado por la factura vuelve (`sale_reversal`); si tenía pagos, tarea
  al equipo para devolver o aplicar el dinero; aviso al cliente por su canal
  (`cancel_notified_at`). Anular una NC devuelve la factura original a
  `approved` y deshace su reingreso de stock.
- Panel: el botón **Anular** solo aparece dentro del plazo y muestra
  "anulable hasta dd/mm hh:mm"; pasado el plazo, el botón es **Nota de
  crédito**.

### 2. Nota de crédito electrónica

- `POST /invoices/:id/credit-note { reason, items?, restock, notify_customer }`:
  DTE `nota_credito` con `related_invoice_id`, mismo receptor (snapshot
  fiscal copiado), numeración propia por tipo y mismo timbrado; total o
  parcial (cantidad por ítem, sin exceder lo no acreditado); se emite por el
  mismo `issue()`; la factura pasa a `credited` cuando lo acreditado cubre su
  total; `restock` reingresa los ítems físicos al stock de la sucursal
  (`return`); el KuDE dice "NOTA DE CREDITO ELECTRONICA" y la factura
  asociada con su CDC; aviso al cliente con el link público al comprobante.

### 3. Devoluciones

- `app.return_requests` (cliente, conversación, factura, ítem, descripción,
  motivo, estado requested → reviewing → approved|rejected → completed,
  resolución, quién decidió, NC vinculada, reingreso). RLS + auditoría.
- Bot: tool **`request_return`** siempre disponible (como `request_human`):
  registra el pedido con las palabras del cliente y marca la conversación
  "necesita humano"; regla 9 del prompt: escuchar, no prometer nada, pedir
  producto/fecha/qué pasó, derivar. El equipo recibe **tarea + correo**.
- Panel: Facturación → **Devoluciones**: aprobar/rechazar/en revisión con
  nota obligatoria y aviso al cliente por WhatsApp o email; cerrar con
  reingreso al stock y/o nota de crédito vinculada.

### 4. Inventario (fase 1)

- `services` (ítems): `sku` (único por negocio), `barcode`, `unit`,
  `track_stock`, `min_stock`, `cost` (promedio ponderado), `is_combo`.
- `item_components`: componentes de un combo con cantidad por unidad (sin
  combos anidados). Un combo no controla stock propio: su disponibilidad es
  el mínimo de `floor(stock_componente / cantidad)`.
- `stock_levels`: saldo por ítem y sucursal (materializado, con lock de fila
  en cada movimiento).
- `stock_movements`: libro append-only con tipo (`initial`, `purchase`,
  `sale`, `sale_reversal`, `return`, `adjustment`, `transfer_in`,
  `transfer_out`), cantidad con signo, costo unitario, saldo posterior,
  referencia (factura, NC, devolución, manual), nota y usuario. Un error se
  corrige con otro movimiento, nunca editando.
- Ventas: al **emitir** una factura se valida el stock (409
  `insufficient-stock` con el detalle, salvo `allow_negative_stock`) antes de
  llamar a SIFEN, y al aprobarse se descuenta en la sucursal de la factura
  (combos expandidos). Anular dentro del plazo revierte; la NC con `restock`
  reingresa.
- Costo promedio ponderado en cada ingreso con costo; valor del inventario =
  cantidad × costo.
- Alertas: al cruzar por debajo del mínimo se avisa por correo al negocio
  (`low_stock_alerts`); la pantalla lista "bajo mínimo" y "sin stock".
- Bot: `list_services` expone `disponible` (true/false) en ítems con stock
  controlado y combos; el prompt le indica decirlo y ofrecer avisar.
- Panel: Catálogo → **Inventario** (existencias por sucursal, valor a costo,
  ingresar, ajustar con motivo, trasladar, kardex) y en el producto: SKU,
  código de barras, unidad, "Controlar stock", mínimo, "Es un combo" con sus
  componentes.

## Fases siguientes (no implementadas)

2. Proveedores y órdenes de compra (recepción parcial, costo por proveedor),
   lectura de código de barras en Facturación, exportar kardex/inventario a
   CSV, reservas de stock en presupuestos, conteo físico guiado.
3. Lotes y vencimientos, números de serie, múltiples depósitos por sucursal,
   valuación FIFO opcional, reportes de rotación y quiebres.

## Consecuencias

- Cinco tablas/columnas nuevas bajo RLS con su caso en la suite de
  aislamiento (39 tablas en `app`).
- `issue()` puede fallar por stock: el panel muestra el detalle y sugiere
  ingresar mercadería o permitir stock negativo.
- La anulación deja de ser "un botón": exige motivo válido, respeta las
  reglas de SIFEN y deja rastro (auditoría, aviso, tarea por pagos).
