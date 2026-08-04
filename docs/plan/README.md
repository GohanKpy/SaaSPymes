# Plan de Arquitectura y Diseño Técnico
## SaaS de Gestión Integral para PyMEs (Paraguay)

**Versión:** 1.0 (para revisión y aprobación)
**Fecha:** 31 de julio de 2026
**Estado:** pendiente de aprobación antes de iniciar la implementación
**Ubicación local sugerida:** `D:\projectos\Pymes SaaS\Plan`

---

## Propósito

Este plan define la arquitectura completa de la solución antes de escribir la primera línea de código de producción. El objetivo es que todas las decisiones estructurales (stack, base de datos, seguridad, infraestructura, orden de desarrollo) queden tomadas, justificadas y aprobadas acá, para no improvisar decisiones de arquitectura durante la marcha ni desarrollar componentes aislados.

## Documentos

| # | Documento | Contenido |
|---|-----------|-----------|
| 01 | [System Architecture Diagram](01-System-Architecture-Diagram.md) | Arquitectura general, diagrama de componentes, flujos de comunicación, stack tecnológico con justificación de cada elección |
| 02 | [Entity-Relationship Diagram](02-Entity-Relationship-Diagram.md) | ERD completo (plano de control y plano de aplicación), cardinalidades y decisiones de modelado |
| 03 | [Database Schema](03-Database-Schema.md) | DDL PostgreSQL comentado: tablas, tipos, llaves, índices, constraints, RLS, auditoría, soft delete, estrategia de normalización |
| 04 | [API Specification](04-API-Specification.md) | Convenciones REST, endpoints por módulo, métodos, parámetros, códigos de estado, reglas de negocio, autenticación y versionado |
| 05 | [Security Architecture](05-Security-Architecture.md) | Modelo de amenazas, aislamiento multitenant, cifrado, gestión de secretos, OWASP, auditoría, backups y respuesta a incidentes |
| 06 | [Infrastructure Deployment Diagram](06-Infrastructure-Deployment-Diagram.md) | Topología AWS fase inicial y fase de escala, ambientes, CI/CD, monitoreo, costos estimados |
| 07 | [Development Roadmap](07-Development-Roadmap.md) | Fases de implementación, orden por dependencias, estimaciones, entregables y estructura del repositorio |
| 08 | [Testing Acceptance Plan](08-Testing-Acceptance-Plan.md) | Estrategia de pruebas (unitarias, integración, e2e, seguridad, aislamiento multitenant) y criterios de aceptación por módulo |
| 09 | [Technical Risk Assessment](09-Technical-Risk-Assessment.md) | Riesgos técnicos identificados, probabilidad, impacto y mitigación |
| 10 | [AWS Account Organization](10-AWS-Account-Organization.md) | Convivencia de los dos proyectos en una misma cuenta AWS: VPC y CIDR, convención de nombres, tags y presupuestos, aislamiento IAM, y plan de separación futura en cuentas distintas |
| 11 | [Local Development Environment](11-Local-Development-Environment.md) | Laboratorio local en Docker para desarrollar sin costo de AWS: equivalencias de servicios, reglas de portabilidad, qué no se puede probar en local y cuándo se enciende AWS |

## Cómo leer este plan

1. **Para aprobar la arquitectura:** leer 01, 05 y 06 (qué se construye, cómo se protege, dónde corre), más el 10 (en qué cuenta de AWS vive y cómo convive con el otro proyecto).
2. **Para aprobar el modelo de datos:** leer 02 y 03 en ese orden.
3. **Para planificar el trabajo:** leer 07, 08 y 09. Para arrancar a desarrollar sin costo de AWS, leer el 11.
4. El documento 04 es la referencia de consulta permanente durante el desarrollo.

## Convenciones

- Las decisiones tomadas se marcan como **[DECISIÓN]** con su justificación.
- Los puntos que requieren definición del negocio se marcan como **[ABIERTO]**.
- Los diagramas están en formato Mermaid, embebido en los markdown: se renderizan en VS Code (con la extensión Markdown Preview Mermaid), GitHub, Obsidian y Claude Code.
- Montos en guaraníes se modelan sin decimales; el sistema soporta multi-moneda a nivel de esquema.
- Idioma del código: inglés para identificadores, español para documentación.

## Uso con Claude Code

Al iniciar el desarrollo, copiar esta carpeta dentro del repositorio como `/docs/plan`. En el `CLAUDE.md` del repo, referenciar estos documentos como fuente de verdad de la arquitectura. Cualquier desvío del plan durante el desarrollo debe registrarse como ADR (Architecture Decision Record) en `/docs/adr`.

## Decisiones que requieren tu aprobación explícita

1. Stack: TypeScript de punta a punta con Next.js (frontend), NestJS (API), Prisma y PostgreSQL 16 (documento 01).
2. Una sola instancia de base de datos con dos esquemas lógicos (control y app) y Row Level Security como segunda barrera de aislamiento (documentos 01 y 03).
3. WhatsApp Cloud API oficial de Meta como canal del bot (documento 01).
4. AWS SQS para colas y procesamiento asíncrono desde el día uno, sin Redis en la fase inicial (documentos 01 y 06).
5. SIFEN: arrancar la integración vía interfaz desacoplada, con decisión pendiente entre integración directa o proveedor homologado (documento 01, punto [ABIERTO]).
6. Calendario propio como fuente de verdad con sincronización opcional a Google Calendar por tenant (documento 01, sujeto a tu confirmación pendiente).
