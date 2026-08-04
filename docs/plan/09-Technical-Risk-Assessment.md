# 09 · Technical Risk Assessment
## Riesgos técnicos, probabilidad, impacto y mitigación

Escala: probabilidad y impacto en Alta / Media / Baja. La exposición (P×I) ordena la tabla. Cada riesgo tiene dueño de mitigación y señal temprana definida: un riesgo sin señal de alerta es un riesgo que se descubre tarde.

---

## 1. Tabla de riesgos

| # | Riesgo | P | I | Mitigación | Señal temprana |
|---|---|---|---|---|---|
| R1 | **Cruce de datos entre tenants** por bug de scoping o RLS mal aplicada | Media | **Crítico** (mata el negocio) | Las 4 barreras del doc 05; suite de aislamiento bloqueante en cada PR; RLS con fallo cerrado; revisión obligatoria de todo SQL crudo | Cualquier fallo de la suite; 404 anómalos en logs |
| R2 | **SIFEN: homologación, certificados y cambios normativos** demoran o rompen la facturación | Alta | Alto | Opción B (proveedor homologado) para salir rápido; interfaz `InvoicingProvider` desacoplada; trámites iniciados en Fase 0; monitoreo de resoluciones DNIT; estados `rejected` con reintento manual | Rechazos de documentos crecientes; anuncios DNIT |
| R3 | **WhatsApp Cloud API:** cambios de precio por conversación, políticas o bloqueo de números de tenants | Media | Alto | API oficial (no libs grises); tokens propios de cada tenant (un bloqueo afecta a uno, no a todos); el sistema entero funciona sin bot (módulo opcional); costos por conversación trasladados al pricing | Avisos de Meta; tasa de mensajes `failed` |
| R4 | **Prompt injection o respuestas indebidas del bot** (datos que no debe dar, promesas que no debe hacer) | Media | Alto | Permisos = herramientas server-side; scoping duro por conversación; plantillas para confirmaciones; bandeja con pausa inmediata; presupuesto de tokens; persistencia total para auditar | Quejas de tenants; revisión semanal de muestras de conversaciones |
| R5 | **Single-AZ / instancia única** en fase 1: una falla de AZ tira el servicio | Baja | Alto | Riesgo aceptado y documentado por costo; RTO 4 h con Terraform + backups PITR; multi-AZ es el primer gasto al haber ingresos | Incidentes AWS en la región; crecimiento de facturación |
| R6 | **Backups no restaurables** cuando se los necesita | Baja | **Crítico** | Prueba de restore trimestral obligatoria con acta; snapshot manual pre-migración; S3 versioning + réplica | Fallo o salto de una prueba trimestral |
| R7 | **Crecimiento de `messages`** degrada la bandeja y los backups | Media | Medio | Índices correctos desde el día 1; plan de particionamiento mensual documentado (doc 03) con gatillo a 20M filas; `bigint` PK ya elegido | Tamaño de tabla y p95 de la bandeja en CloudWatch |
| R8 | **Dependencia de una sola persona** (bus factor 1) en desarrollo y operación | Alta | Alto | Este plan + ADRs + runbooks como memoria externa; CLAUDE.md para que cualquier dev (o Claude Code) retome; infraestructura como código; credenciales en SSM, no en cabezas | Vos de vacaciones y algo se rompe: ensayarlo antes |
| R9 | **Costos variables por tenant** (tokens IA, conversaciones Meta, documentos SIFEN) superan lo cobrado | Media | Medio | `monthly_token_budget` por tenant; métricas de consumo por tenant desde el día 1 (doc 06); revisión de pricing con datos reales al mes 3 | Margen por tenant en el panel plataforma |
| R10 | **Bloqueo con la pasarela de pagos** (integración Bancard u otra se demora) | Media | Medio | La fase 3 la aísla: hasta entonces se cobra por transferencia con conciliación manual en el panel; decisión de pasarela con demos reales antes de fase 3 | Respuesta de los proveedores en fase 0 |
| R11 | **Scope creep técnico:** construir la fase de escala antes de tener clientes | Media | Medio | Gatillos métricos explícitos (doc 06 sección 2); backlog visible de "después"; regla: nada de Redis, multi-AZ ni microservicios sin gatillo cumplido | PRs de infraestructura sin métrica que los justifique |
| R12 | **Emails de tenants a spam** (SMTP propio mal configurado: SPF/DKIM) | Alta | Bajo | Verificación guiada al configurar SMTP (prueba de envío + chequeo de SPF/DKIM con aviso); documentación para el cliente; reintento y aviso en panel ante rebotes | Tasa de fallos de envío por tenant |

## 2. Los dos riesgos que gobiernan el proyecto

**R1 (aislamiento)** no se gestiona: se elimina por diseño. Por eso las cuatro barreras son redundantes a propósito y la suite es bloqueante. Es el único punto del proyecto donde la sobre-ingeniería es la decisión correcta.

**R2 (SIFEN)** es el riesgo de calendario: no depende solo de nosotros. La jugada es no ponerlo en el camino crítico: la Fase 1 vende sin facturación, los trámites arrancan en Fase 0, y la opción B compra tiempo. Si el proveedor homologado decepciona, la interfaz permite cambiar de proveedor o ir a la opción A sin tocar el resto.

## 3. Supuestos que, si cambian, obligan a revisar este plan

1. Volumen inicial: menos de 50 tenants y menos de 200 usuarios concurrentes el primer año (dimensiona la fase 1).
2. Solo Paraguay y solo guaraníes en v1 (multimoneda queda preparada, no activada).
3. WhatsApp como único canal del bot (Instagram/Telegram no están en el diseño v1).
4. Un solo desarrollador principal asistido por Claude Code (afecta estimaciones del doc 07).
5. La opción B de SIFEN tiene al menos un proveedor con API razonable y costo por documento compatible con el pricing (verificar en Fase 0 con cotizaciones reales).

Cualquiera de estos que cambie dispara una revisión del documento afectado más un ADR.
