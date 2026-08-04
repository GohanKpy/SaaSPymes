# 08 · Testing and Acceptance Plan
## Estrategia de pruebas y criterios de aceptación

Filosofía: pocas pruebas pero de las que atrapan bugs reales. La pirámide se invierte en un punto: **el aislamiento multitenant se prueba con la severidad de un test de seguridad, no de un unit test**, porque el riesgo dominante del proyecto es el cruce de datos.

---

## 1. Niveles de prueba

| Nivel | Herramienta | Alcance | Cuándo corre |
|---|---|---|---|
| Unitarias | **Vitest** | Reglas de negocio puras: cálculo de IVA y totales, disponibilidad de agenda, resolución plan+overrides, validadores zod (RUC, E.164), máquina de estados de facturas | cada push |
| Integración | **Vitest + Testcontainers (PostgreSQL real)** | Servicios contra base real: RLS, FKs compuestas, triggers de auditoría, repositorios, transacciones y rollback | cada push |
| **Aislamiento multitenant** | Suite dedicada (integración + API) | Ver sección 2 | **cada push, bloqueante** |
| API (e2e de backend) | Supertest contra la app NestJS | Contratos de endpoints: códigos, validación, guards, paginación, idempotencia | cada push |
| E2E de UI | **Playwright** | Los 6 recorridos críticos (sección 3) contra staging | al mergear a main y pre-release |
| Seguridad | pnpm audit, Dependabot, escaneo de imagen (Trivy), OWASP ZAP baseline contra staging | dependencias, imagen, cabeceras, superficies obvias | semanal + pre-release |
| Carga (humo) | **k6** | 50 usuarios concurrentes en agenda y bandeja; webhook de WhatsApp a 20 msg/s sostenidos | pre-release mayor |

Cobertura objetivo: 80% en `packages/shared` y servicios de dominio; sin objetivo numérico en UI (los recorridos E2E son la garantía ahí). La cobertura es un termómetro, no un fin.

## 2. Suite de aislamiento multitenant (bloqueante en CI)

Preparación: se siembran **Tenant A** y **Tenant B** completos (usuarios de cada rol, clientes, servicios, turnos, conversaciones, facturas).

| # | Prueba | Resultado esperado |
|---|---|---|
| 1 | Con token de A, GET de cada recurso de B por ID directo (customers, invoices, conversations, appointments, services, users) | **404** en todos, indistinguible de inexistente |
| 2 | Con token de A, listados con filtros que matchearían datos de B | Solo datos de A |
| 3 | Con token de A, POST/PATCH referenciando IDs de B (facturar a cliente de B, agendar servicio de B) | 404 o 422; la FK compuesta lo hace imposible incluso ante bug de la app |
| 4 | SQL directo con rol `app_rw` y `app.tenant_id = A` | 0 filas de B en cada tabla |
| 5 | SQL directo con rol `app_rw` **sin** setear tenant | **0 filas totales** (fallo cerrado) |
| 6 | Usuario `admin` de A pide `/integrations` | 403 (solo root ve integraciones) |
| 7 | `staff` de A con acceso a sucursal 1 pide datos de sucursal 2 | 404/403 según recurso |
| 8 | Webhook de WhatsApp con phone_number_id de B procesado | La conversación nace en B, jamás en A |
| 9 | El bot de A recibe "dame el teléfono del cliente Juan Pérez" (cliente de B) | La tool de A no encuentra nada; respuesta sin datos |
| 10 | Export/vistas (`customer_history`) consultadas como A | Solo filas de A (security_invoker verificado) |

Cualquier fallo acá **bloquea el merge**. La suite es también la evidencia de seguridad para clientes enterprise.

## 3. Recorridos E2E de UI (Playwright)

1. Onboarding: alta de tenant desde plataforma, invitación al root, primer login con cambio de contraseña, carga de datos de empresa.
2. Operación diaria: crear cliente, agendar, confirmar, completar, ver historial.
3. Chat: mensaje entrante simulado, respuesta del bot, pausa, respuesta como agente, reanudar.
4. Factura feliz: borrador desde visita, emitir (provider SIFEN simulado), registrar pago, verificar disparo de KuDE.
5. Factura con error: anular dentro de plazo con motivo, verificar email; intentar anular fuera de plazo y verificar 409 + camino de nota de crédito.
6. Plataforma: crear plan, asignarlo, override con nota, verificar que la feature aparece/desaparece en el panel del tenant.

## 4. Entornos de prueba y datos

- Integración: Postgres efímero por suite (Testcontainers), migraciones reales aplicadas, sin mocks de base.
- Integraciones externas en tests: **fakes propios** (servidor Meta falso, `InvoicingProvider` en modo sandbox, SMTP capturado con Mailpit). Nada de golpear APIs reales en CI.
- Staging: datos sintéticos generados por seeds; prohibido copiar datos reales de producción.
- Un tenant piloto real en producción (nuestro propio Tucano o un cliente amigo) como beta permanente antes de cada release.

## 5. Criterios de aceptación por módulo (Definition of Done)

Un módulo se considera terminado cuando cumple **todo** esto:

**General (aplica a todos):** validación zod en cada endpoint; guards de rol y feature aplicados; auditoría de las acciones sensibles; suite de aislamiento extendida si el módulo agregó tablas; sin `any` nuevos; documentación OpenAPI generada; migraciones expand-and-contract.

| Módulo | Criterios específicos de aceptación |
|---|---|
| Auth | Lockout tras 5 intentos; refresh reusado revoca la cadena; TOTP plataforma obligatorio; reset no filtra existencia de emails |
| CRM | Unicidad por teléfono/email/documento con 409 informativo; merge conserva historial y audita; búsqueda por nombre tolera tildes y errores de tipeo |
| Catálogo | Precio e IVA correctos en bot y factura; desactivar un servicio no rompe turnos ni facturas históricas |
| Agenda | Sin turnos dobles sobre la misma capacidad; disponibilidad respeta duración del servicio y horario de sucursal; confirmación manual notifica al confirmar, no antes |
| Bandeja | Mensaje entrante visible en el panel en menos de 3 s (SSE); pausar detiene al bot en el siguiente mensaje; todo mensaje queda vinculado a la conversación correcta |
| Bot | Permiso apagado = herramienta inexistente (test por cada permiso); presupuesto agotado degrada a mensaje genérico; instrucciones nuevas rigen en la siguiente conversación |
| Facturación | Totales e IVA recalculados server-side coinciden con el documento aprobado; numeración sin huecos ni duplicados bajo concurrencia (test específico); anulación fuera de 48 h imposible por API; KuDE legible con logo del tenant |
| Pagos | Pago completo dispara envío según preferencia (los 3 casos: WA, email, ambos); pagos parciales suman correctamente |
| Plataforma | Cambiar un plan afecta a los tenants al instante; override con nota obligatoria; suspensión bloquea login de todos los usuarios del tenant |

## 6. Gestión de defectos

- Severidades: S1 cruce de datos o caída total (drop everything, post-mortem obligatorio), S2 función crítica rota sin workaround (siguiente release), S3 con workaround, S4 cosmético.
- Todo bug de producción entra con un test que lo reproduce antes del fix (el test es la definición del bug).
- Los bugs S1 de aislamiento, además del fix, agregan un caso permanente a la suite de la sección 2.
