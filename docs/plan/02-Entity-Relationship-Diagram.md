# 02 · Entity-Relationship Diagram (ERD)
## Modelo de datos conceptual

El modelo se divide en dos planos que viven en la misma instancia de PostgreSQL (ver documento 01, sección 6): el **plano de control** (esquema `control`, datos de la plataforma) y el **plano de aplicación** (esquema `app`, datos operativos de cada tenant). El DDL completo con tipos, índices y constraints está en el documento 03; acá se define el modelo y sus relaciones.

---

## 1. Plano de control (esquema `control`)

```mermaid
erDiagram
    PLANS ||--o{ PLAN_FEATURES : incluye
    FEATURES ||--o{ PLAN_FEATURES : participa
    PLANS ||--o{ SUBSCRIPTIONS : define
    TENANTS ||--o{ SUBSCRIPTIONS : contrata
    TENANTS ||--o{ TENANT_FEATURE_OVERRIDES : recibe
    FEATURES ||--o{ TENANT_FEATURE_OVERRIDES : ajusta
    TENANTS ||--o{ PLATFORM_INVOICES : es_facturado
    SUBSCRIPTIONS ||--o{ PLATFORM_INVOICES : genera
    PLATFORM_USERS ||--o{ PLATFORM_AUDIT_LOG : registra

    PLATFORM_USERS {
        uuid id PK
        text email UK
        text password_hash
        text role "admin | agent"
        bool totp_enabled
        timestamptz created_at
    }
    TENANTS {
        uuid id PK
        text legal_name
        text ruc UK
        text status "active | suspended | trial | closed"
        uuid current_plan_id FK
        jsonb branding
        timestamptz created_at
    }
    PLANS {
        uuid id PK
        text code UK
        text name
        bigint monthly_price
        char currency
        int max_users
        int max_branches
        bool is_active
    }
    FEATURES {
        uuid id PK
        text code UK "crm, bot, invoicing, scheduling, chat_inbox, catalog"
        text name
    }
    PLAN_FEATURES {
        uuid plan_id PK,FK
        uuid feature_id PK,FK
        jsonb limits
    }
    TENANT_FEATURE_OVERRIDES {
        uuid id PK
        uuid tenant_id FK
        uuid feature_id FK
        bool enabled
        bigint extra_fee
        text note "motivo del acuerdo manual"
        uuid created_by FK
    }
    SUBSCRIPTIONS {
        uuid id PK
        uuid tenant_id FK
        uuid plan_id FK
        text status "active | past_due | cancelled"
        bigint agreed_price "override de precio pactado"
        date current_period_start
        date current_period_end
    }
    PLATFORM_INVOICES {
        uuid id PK
        uuid tenant_id FK
        uuid subscription_id FK
        text status
        bigint total
        timestamptz issued_at
    }
    PLATFORM_AUDIT_LOG {
        bigint id PK
        uuid actor_id FK
        text action
        text entity
        uuid entity_id
        jsonb detail
        timestamptz created_at
    }
```

**Decisiones de modelado del plano de control**

- **Planes como datos, no como código [DECISIÓN]:** `plans`, `features`, `plan_features` y `tenant_feature_overrides` materializan tu requisito de que nada esté hardcodeado. Crear un plan nuevo o pactar un acuerdo a medida es un INSERT desde el panel admin, no un deploy. La resolución de acceso de un tenant a una feature es: override del tenant si existe, si no lo que diga su plan.
- **`limits` en JSONB:** los límites por feature (cantidad de usuarios, mensajes de bot por mes, facturas por mes) varían por feature; JSONB evita una tabla de límites por cada tipo. Se valida con esquema zod en la aplicación.
- **`agreed_price` en la suscripción:** el precio pactado vive en la suscripción para que cambiar el precio de lista de un plan no toque los acuerdos existentes.
- **Facturación de plataforma separada de la de tenants:** `platform_invoices` (lo que nosotros cobramos) es una entidad distinta de `app.invoices` (lo que los tenants facturan a sus clientes). Comparten conceptos pero no ciclo de vida ni normativa de acceso, y ambas terminan transmitiéndose a SIFEN por el mismo `InvoicingProvider`.

---

## 2. Plano de aplicación (esquema `app`)

Todas las entidades de este plano llevan `tenant_id` (omitido en el diagrama por legibilidad, salvo donde define la relación) y están protegidas por RLS.

```mermaid
erDiagram
    TENANTS ||--o{ BRANCHES : tiene
    TENANTS ||--o{ USERS : emplea
    BRANCHES ||--o{ USER_BRANCH_ACCESS : habilita
    USERS ||--o{ USER_BRANCH_ACCESS : accede
    TENANTS ||--o{ CUSTOMERS : administra
    TENANTS ||--o{ SERVICE_CATEGORIES : organiza
    SERVICE_CATEGORIES ||--o{ SERVICES : agrupa
    CUSTOMERS ||--o{ APPOINTMENTS : reserva
    BRANCHES ||--o{ APPOINTMENTS : aloja
    SERVICES ||--o{ APPOINTMENTS : motiva
    CUSTOMERS ||--o{ CONVERSATIONS : conversa
    CONVERSATIONS ||--o{ MESSAGES : contiene
    USERS ||--o{ MESSAGES : "envia (como agente)"
    CUSTOMERS ||--o{ INVOICES : recibe
    BRANCHES ||--o{ INVOICES : emite
    INVOICES ||--o{ INVOICE_ITEMS : detalla
    SERVICES ||--o{ INVOICE_ITEMS : referencia
    INVOICES ||--o{ PAYMENTS : cobra
    INVOICES ||--o| CREDIT_NOTES : corrige
    APPOINTMENTS }o--o| INVOICES : factura
    TENANTS ||--|| BOT_SETTINGS : configura
    TENANTS ||--o{ INTEGRATION_CREDENTIALS : conecta
    TENANTS ||--o{ NOTIFICATION_EMAILS : avisa
    TENANTS ||--o{ AUDIT_LOG : traza

    BRANCHES {
        uuid id PK
        uuid tenant_id FK
        text name
        text address
        bool is_main
        timestamptz deleted_at
    }
    USERS {
        uuid id PK
        uuid tenant_id FK
        text email
        text password_hash
        text role "root | admin | staff"
        bool totp_enabled
        timestamptz deleted_at
    }
    USER_BRANCH_ACCESS {
        uuid user_id PK,FK
        uuid branch_id PK,FK
    }
    CUSTOMERS {
        uuid id PK
        uuid tenant_id FK
        text first_name
        text last_name
        text doc_type "ci | ruc | pasaporte"
        text doc_number
        text ruc_dv
        text email
        text phone_e164
        bool notify_whatsapp
        bool notify_email
        text notes
        timestamptz deleted_at
    }
    SERVICE_CATEGORIES {
        uuid id PK
        uuid tenant_id FK
        text name
        int sort_order
        timestamptz deleted_at
    }
    SERVICES {
        uuid id PK
        uuid tenant_id FK
        uuid category_id FK
        text name
        bigint price
        char currency
        smallint tax_rate "10 | 5 | 0"
        int duration_min
        bool bookable_by_bot
        timestamptz deleted_at
    }
    APPOINTMENTS {
        uuid id PK
        uuid tenant_id FK
        uuid branch_id FK
        uuid customer_id FK
        uuid service_id FK
        timestamptz starts_at
        timestamptz ends_at
        text status "pending | confirmed | completed | cancelled | no_show"
        text source "panel | bot"
        uuid confirmed_by FK
        uuid invoice_id FK
        text google_event_id
        timestamptz deleted_at
    }
    CONVERSATIONS {
        uuid id PK
        uuid tenant_id FK
        uuid customer_id FK "null hasta identificar"
        text phone_e164
        text status "bot_active | paused | agent | closed"
        uuid assigned_user_id FK
        timestamptz last_message_at
    }
    MESSAGES {
        bigint id PK
        uuid conversation_id FK
        text direction "in | out"
        text sender_type "customer | bot | agent | system"
        uuid sender_user_id FK
        text body
        text wa_message_id UK
        text status "sent | delivered | read | failed"
        timestamptz created_at
    }
    INVOICES {
        uuid id PK
        uuid tenant_id FK
        uuid branch_id FK
        uuid customer_id FK
        text doc_type "factura | nota_credito"
        text establishment "3 digitos"
        text expedition_point "3 digitos"
        text doc_number "7 digitos"
        text timbrado
        text cdc UK "44 digitos SIFEN"
        text status "draft | issuing | approved | rejected | cancelled | credited"
        text sifen_response_code
        bigint subtotal
        bigint tax_total
        bigint total
        char currency
        text cancel_reason
        timestamptz issued_at
        timestamptz approved_at
        timestamptz cancelled_at
        text kude_pdf_key "ruta S3"
    }
    INVOICE_ITEMS {
        uuid id PK
        uuid invoice_id FK
        uuid service_id FK "nullable"
        text description
        numeric quantity
        bigint unit_price
        smallint tax_rate
        bigint line_total
    }
    PAYMENTS {
        uuid id PK
        uuid invoice_id FK
        text method "efectivo | transferencia | tarjeta | qr"
        bigint amount
        timestamptz paid_at
        uuid registered_by FK
    }
    CREDIT_NOTES {
        uuid id PK
        uuid invoice_id FK
        uuid credit_invoice_id FK "la NC es tambien un doc en invoices"
        text reason
        timestamptz created_at
    }
    BOT_SETTINGS {
        uuid tenant_id PK,FK
        bool enabled
        text instructions_text
        text instructions_file_key "ruta S3 con ID fijo del tenant"
        bool access_catalog
        bool access_history
        bool access_customer_data
        bool access_calendar
        bool allow_booking
        bool auto_confirm_bookings
        int monthly_token_budget
    }
    INTEGRATION_CREDENTIALS {
        uuid id PK
        uuid tenant_id FK
        text type "whatsapp | smtp | sifen | google_calendar | payment"
        bytea encrypted_payload "cifrado con KMS envelope"
        jsonb public_config "datos no sensibles: phone_number_id, host smtp"
        uuid updated_by FK
        timestamptz updated_at
    }
    NOTIFICATION_EMAILS {
        uuid id PK
        uuid tenant_id FK
        text email
        text label
    }
    AUDIT_LOG {
        bigint id PK
        uuid tenant_id FK
        uuid actor_user_id FK
        text action
        text entity
        uuid entity_id
        jsonb before
        jsonb after
        inet ip
        timestamptz created_at
    }
```

---

## 3. Cardinalidades clave explicadas

| Relación | Cardinalidad | Nota de diseño |
|---|---|---|
| Tenant → Branches | 1 a N | Todo tenant nace con una sucursal `is_main`; el caso de un emprendedor solo es simplemente un tenant con una sucursal. Así el modelo de cadena y el de individuo son el mismo. |
| Users ↔ Branches | N a M vía `user_branch_access` | Un empleado puede atender en dos sucursales; el root ve todas sin filas explícitas (regla en la app). |
| Customer → Conversations | 1 a N (nullable) | Una conversación nace con el teléfono y `customer_id` NULL; se vincula al identificar por teléfono, email, cédula o RUC. El teléfono es la llave primaria de identificación; los demás son llaves secundarias de unificación. |
| Appointments ↔ Invoices | N a 1 opcional | Varias visitas pueden facturarse juntas; una visita puede no facturarse. El historial "qué se hizo y qué se facturó" sale de este vínculo más `invoice_items`. |
| Invoice → Credit Notes | 1 a 0..1 (extensible a N) | La NC es a su vez un documento electrónico: `credit_invoice_id` apunta a otra fila de `invoices` con `doc_type = nota_credito`. Reutiliza toda la maquinaria SIFEN. |
| Tenant → Bot settings | 1 a 1 | Fila creada al activar la feature; PK = tenant_id. |
| Tenant → Integration credentials | 1 a N (única por tipo) | Constraint único `(tenant_id, type)`: un solo WhatsApp, un solo SMTP por tenant en v1. |

## 4. Decisiones de modelado transversales

- **UUID como PK** en entidades de negocio (generación distribuida, no revelan volumen); `bigint` autoincremental solo en tablas de alto volumen append-only (`messages`, `audit_log`) donde el orden natural y el tamaño del índice importan.
- **Soft delete (`deleted_at`)** en entidades editables por el usuario (customers, services, appointments, branches, users). **Nunca** en `invoices`, `messages` ni `audit_log`: las facturas se anulan por estado y los mensajes y auditoría son inmutables.
- **Dinero en `bigint`** (guaraníes sin decimales) con `currency` explícita. Nada de floats, jamás.
- **Normalización 3FN como base**, con desnormalizaciones puntuales y justificadas: `line_total` en items y `subtotal/tax_total/total` en facturas se persisten (son datos fiscales congelados al emitir, no derivables si el precio del servicio cambia después). `last_message_at` en conversaciones evita un MAX() por fila en la bandeja.
- **Multimoneda preparada, no activada:** todo monto lleva moneda; la v1 opera solo PYG.
- **Identidad del cliente final:** unicidad parcial por tenant sobre `phone_e164`, `email` y `(doc_type, doc_number)` cuando no son NULL y no está borrado. La unificación de duplicados es una operación explícita del panel (merge), nunca automática silenciosa.
