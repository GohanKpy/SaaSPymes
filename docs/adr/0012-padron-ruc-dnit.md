# ADR 0012 — Padrón RUC de la DNIT: copia local mensual en `control`

- Estado: aceptado
- Fecha: 2026-09-08
- Relacionado: docs/plan/03 (esquemas `control`/`app`), docs/plan/05
  (aislamiento), ADR 0003 (configuración operativa en el panel), ADR 0007
  (trabajo periódico in-process en la API hasta el pase a SQS)

## Contexto

Al cargar el RUC de un cliente (ficha, identidades fiscales, "Facturar a" en
una factura, RUC del propio negocio) el panel calculaba el dígito verificador
por módulo 11 pero la razón social había que tipearla a mano, y no había forma
de saber si el RUC existía o estaba activo. Un RUC con DV distinto al oficial
o cancelado es rechazo seguro de SIFEN. No existe una API pública y confiable
de la DNIT para consultas masivas.

Johan pidió replicar lo que ya funciona en Unbox (`be-unbox`, reporte técnico
del 2026-09-08): descargar el **padrón oficial completo** que la DNIT publica
como 10 ZIP (`ruc0.zip … ruc9.zip`, formato
`RUC|RAZON SOCIAL|DV|RUC_ANTERIOR|ESTADO|`, ~2 millones de filas, ~40 MB
comprimidos, publicación mensual los días 1-2) y consultarlo localmente.

## Decisión

1. **Dónde vive el dato: esquema `control`, tabla `ruc_contribuyentes`.**
   Es información pública y compartida por todos los tenants: no lleva
   `tenant_id`, ni RLS, ni entra en la suite de aislamiento (que cubre las
   tablas de `app`). La escribe `platform_ops` (cron de plataforma) y la lee
   `app_rw` (consulta de los tenants) por los grants por defecto del esquema.
   A diferencia de Unbox, la tabla **sí está en `schema.prisma` y nace por
   migración** (`20260908200000_padron_ruc_dnit`): acá toda tabla nace por
   migración (regla del proyecto) y así no hay drift.
2. **Actualización por upsert incremental, no por swap de tabla.** Cada
   corrida hace `INSERT … ON CONFLICT (ruc) DO UPDATE … WHERE … IS DISTINCT
   FROM` en lotes de 5.000 filas (arrays `unnest`, 5 parámetros por lote).
   La tabla nunca queda vacía ni a medio cargar (cada fila es válida en todo
   momento), `updated_at` marca el último cambio real de cada contribuyente y
   no hace falta renombrar tablas ni índices. Se conserva la protección de
   Unbox contra archivos truncados: cada archivo se parsea completo antes de
   tocar la base y si trae menos de 50.000 contribuyentes (lo normal son
   ~200.000) la corrida aborta sin escribir. Los RUC no desaparecen del
   padrón (pasan a `CANCELADO`), así que no hay borrados que reflejar.
3. **Cron in-process en la API** (`RucPadronService`, mismo patrón que la
   sync de Google Calendar): corrida **mensual el día 5 a las 03:00 de
   America/Asuncion** (configurable), con recuperación: si a la hora de la
   cita el proceso estaba caído, corre apenas arranca; si el padrón está
   vacío, la primera carga es inmediata. Una fila `running` reciente en
   `control.ruc_padron_runs` frena a una segunda instancia. El pase al worker
   con SQS sigue el camino de ADR 0007.
4. **Fuente:** se leen los enlaces `rucN.zip` de la página pública de la DNIT
   (los ids de documento cambian con cada publicación) y, si la página no
   responde o falta alguno, se usa la carpeta documental
   `https://www.dnit.gov.py/documents/20123/3434104/rucN.zip` (verificada
   2026-09). ZIP descomprimido en memoria con `zlib` (lector propio, sin
   binario `unzip` ni dependencia nueva).
5. **Operación desde el portal admin** (ADR 0003): página "Padrón RUC (DNIT)"
   con estado (contribuyentes cargados, última carga OK, próxima cita),
   calendario, URL de la página, botón "Descargar ahora" e historial de
   corridas. Config en `platform_settings` clave `ruc_padron`.
6. **Si falla, el padrón vigente queda intacto y se avisa por correo** a los
   padmin activos (`MailerService`, SMTP del sistema) indicando que el
   autocompletado sigue funcionando con el padrón anterior.
7. **Consulta:** `GET /api/v1/ruc/:ruc` para cualquier usuario autenticado
   (dato público, sin feature). Normaliza lo tipeado (`'80.012.345-6'` →
   `80012345`), devuelve `found`, `dv`, `razon_social`, `estado`,
   `ruc_anterior`; si el RUC no está, igual devuelve el DV por módulo 11. Si
   la lectura falla, degrada a `found: false` (nunca rompe el formulario).
8. **Autocompletado en el panel** (`apps/web/lib/ruc-lookup.tsx`): debounce
   de 500 ms desde 5 dígitos, se descartan respuestas viejas, el DV oficial
   manda, la razón social se pisa solo si el campo está vacío o tiene lo que
   el sistema completó antes (si el usuario escribió otra cosa se ofrece
   "Usar ese nombre"), y se muestra el estado (verde ACTIVO, ámbar/rojo si
   no). Aplicado en: alta de cliente, identidades fiscales de la ficha,
   "Facturar a" de la factura y RUC del negocio en Ajustes → Empresa.

## Consecuencias

- ~2 millones de filas / ~250 MB en la base de plataforma. Para backups y
  migraciones conviene excluir `control.ruc_contribuyentes` del dump
  (`pg_dump --exclude-table=control.ruc_contribuyentes`) y regenerarla desde
  el panel: es dato reconstruible.
- La API necesita salida HTTPS a `www.dnit.gov.py`; una corrida completa
  tarda unos minutos y corre en segundo plano.
- El bot de WhatsApp todavía no consulta el padrón; es la extensión natural
  cuando pida el RUC para facturar (tool `ruc_lookup`), fuera de este ADR.
