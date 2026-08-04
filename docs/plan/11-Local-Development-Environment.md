# 11 · Local Development Environment
## Laboratorio local con paridad hacia AWS

**[DECISIÓN] El desarrollo de las fases 0 y 1 se hace íntegramente en un servidor local con Docker.** AWS se enciende recién cuando el proyecto necesita una URL pública estable y datos de piloto real (fase 2). Costo de infraestructura durante el desarrollo: cero.

La condición innegociable es la **paridad**: el pase a producción debe ser un cambio de variables de entorno, jamás una reescritura. Este documento define cómo se logra.

---

## 1. Equivalencias local ↔ AWS

| Componente en AWS (doc 06) | Equivalente local | Paridad |
|---|---|---|
| RDS PostgreSQL 16 | Contenedor `postgres:16` | **Total.** Mismo motor, misma versión, mismo DDL con RLS, roles y triggers del documento 03 |
| S3 | **MinIO** (API compatible S3) | Alta. Mismo SDK, solo cambia el endpoint |
| SQS | **ElasticMQ** (API compatible SQS) | Alta. Mismo SDK y semántica de colas y DLQ |
| SSM Parameter Store | Archivo `.env` local | Media. La app lee variables de entorno en ambos casos; en AWS un script las inyecta desde SSM |
| KMS (envelope encryption) | Clave simétrica local de desarrollo | Media. Interfaz `CryptoService` con dos implementaciones: local y KMS |
| CloudWatch Logs | Salida a stdout (más Dozzle si querés UI) | Alta. La app loguea JSON a stdout en ambos casos |
| Caddy / proxy | El mismo contenedor Caddy | **Total.** Misma imagen que en producción |
| SMTP de tenants | **Mailpit** (captura y muestra los correos) | Alta. Mismo Nodemailer, otro host |
| WhatsApp Cloud API | Servidor falso propio (`packages/wa/fake-server`) | Media. Ver sección 4 |
| SIFEN | `InvoicingProvider` en modo sandbox o fake | Media. Ver sección 4 |
| Claude API | La API real (el costo es despreciable en desarrollo) | Total |

## 2. Reglas de portabilidad (obligatorias, es lo que hace que el pase a AWS sea trivial)

1. **Todo cliente de AWS SDK con `endpoint` configurable por variable de entorno.** Local apunta a MinIO y ElasticMQ; en AWS la variable va vacía y el SDK usa los endpoints reales. Nunca hardcodear un endpoint, ni siquiera "temporalmente".
2. **Credenciales siempre por variable de entorno.** En local, credenciales de juguete; en AWS, el SDK toma las del rol IAM de la instancia sin cambio de código.
3. **Nombres de buckets y colas por variable.** Nunca fijos en el código (recordá que los nombres de bucket S3 son únicos a nivel mundial, documento 10).
4. **Las mismas imágenes Docker en local, staging y producción.** Lo único que cambia es el archivo de variables. Si algo funciona solo en local, es un bug.
5. **Nada de funciones exclusivas del emulador.** Si MinIO o ElasticMQ ofrecen algo que S3 o SQS no tienen, no se usa.
6. **Misma versión mayor de PostgreSQL (16) y el mismo DDL.** RLS, roles, triggers y FKs compuestas se prueban localmente igual que en producción: es el mismo motor, así que la suite de aislamiento del documento 08 corre completa en local.
7. **Cero estado en el filesystem del contenedor.** Todo archivo va a S3 o MinIO. Un contenedor debe poder morir y volver sin perder nada.
8. **Migraciones siempre por Prisma**, nunca cambios manuales a la base. La base local se debe poder reconstruir desde cero con un comando.
9. **Nada de `localhost` en el código.** Solo en archivos de configuración de desarrollo.

## 3. Composición del laboratorio

```yaml
# docker-compose.dev.yml (referencia)
services:
  db:
    image: postgres:16
    environment:
      POSTGRES_PASSWORD: devpass
      POSTGRES_DB: pymes
    ports: ["5432:5432"]
    volumes:
      - dbdata:/var/lib/postgresql/data
      - ./infra/local/init:/docker-entrypoint-initdb.d   # roles, schemas, RLS
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s

  minio:                      # equivalente de S3
    image: minio/minio
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: devkey
      MINIO_ROOT_PASSWORD: devsecret123
    ports: ["9000:9000", "9001:9001"]
    volumes: [miniodata:/data]

  queue:                      # equivalente de SQS
    image: softwaremill/elasticmq-native
    ports: ["9324:9324"]
    volumes:
      - ./infra/local/elasticmq.conf:/opt/elasticmq.conf

  mail:                       # captura de correos salientes
    image: axllent/mailpit
    ports: ["1025:1025", "8025:8025"]

  api:
    build: { context: ., dockerfile: apps/api/Dockerfile }
    env_file: .env.local
    depends_on:
      db: { condition: service_healthy }
    ports: ["3001:3001"]

  worker:
    build: { context: ., dockerfile: apps/worker/Dockerfile }
    env_file: .env.local
    depends_on:
      db: { condition: service_healthy }

  web:
    build: { context: ., dockerfile: apps/web/Dockerfile }
    env_file: .env.local
    ports: ["3000:3000"]

volumes:
  dbdata:
  miniodata:
```

Variables que cambian entre local y AWS (todo lo demás es idéntico):

```bash
# .env.local
DATABASE_URL=postgresql://app_rw:devpass@db:5432/pymes
S3_ENDPOINT=http://minio:9000          # en AWS: vacío
S3_FORCE_PATH_STYLE=true               # en AWS: false
SQS_ENDPOINT=http://queue:9324         # en AWS: vacío
AWS_ACCESS_KEY_ID=devkey               # en AWS: lo provee el rol IAM
AWS_SECRET_ACCESS_KEY=devsecret123     # en AWS: lo provee el rol IAM
CRYPTO_PROVIDER=local                  # en AWS: kms
SMTP_HOST=mail                         # en AWS: el SMTP del tenant
WHATSAPP_API_URL=http://wa-fake:4000   # en AWS: https://graph.facebook.com
INVOICING_PROVIDER=fake                # en AWS: sandbox o el proveedor real
```

El script de init de la base (`infra/local/init/01-schema.sql`) aplica exactamente lo del documento 03: extensiones, esquemas `control` y `app`, roles `migrator` y `app_rw` con `NOBYPASSRLS`, y la función `app.current_tenant()`. Sin eso, el aislamiento no se está probando de verdad.

## 4. Lo que no se puede probar localmente

| Limitación | Cómo se resuelve |
|---|---|
| **Webhooks entrantes de WhatsApp** (Meta necesita una URL pública HTTPS) | Servidor falso local para el desarrollo diario, y el **Cloudflare Tunnel de la sección 7** cuando hay que probar contra Meta de verdad |
| **SIFEN real** | Provider en modo fake para el desarrollo; el ambiente de pruebas del proveedor homologado o de la DNIT recién cuando el módulo esté completo |
| **Latencia y límites reales de RDS** | Se validan en el primer staging en AWS, antes del piloto |
| **Permisos IAM reales** | El emulador no valida permisos: los roles se prueban en el primer deploy a AWS |
| **Certificados y DNS** | Solo en AWS |

Ninguna de estas bloquea las fases 0 y 1.

## 5. Cuándo se enciende AWS

| Momento | Qué se enciende | Por qué |
|---|---|---|
| Fase 0 y 1 completas | Nada | Todo local; costo cero |
| Cierre de fase 1 | Instancia + RDS chicos (documento 06) | Primer staging público y demo comercial |
| Fase 2 | Se mantiene | El bot necesita webhook público estable de Meta |
| Piloto real | Producción | Datos reales, backups, monitoreo |

Con esto, el gasto de AWS empieza recién cuando hay algo que mostrar, y para entonces el Terraform del documento 06 aplica sobre infraestructura vacía sin sorpresas.

## 6. Checklist de "listo para subir a AWS"

- [ ] La aplicación arranca sin ninguna variable con valor por defecto de desarrollo
- [ ] Ningún endpoint, bucket, cola ni host aparece fijo en el código
- [ ] La base se reconstruye desde cero con migraciones Prisma, sin pasos manuales
- [ ] La suite de aislamiento multitenant (documento 08) pasa en local
- [ ] Las imágenes Docker se construyen multi-arch (amd64 y arm64, porque producción es Graviton)
- [ ] Los logs salen a stdout en JSON, sin archivos locales
- [ ] `CryptoService` tiene la implementación KMS probada, no solo la local
- [ ] Terraform del documento 06 aplicado en una cuenta vacía y validado
- [ ] Prueba de restore de la base hecha al menos una vez (documento 05)

## 7. Acceso remoto al laboratorio

**[DECISIÓN] El laboratorio se expone a internet con Cloudflare Tunnel, no abriendo puertos en el router.**

Un agente liviano (`cloudflared`) corre como un servicio más del compose y abre una conexión **saliente** hacia Cloudflare, que recibe el tráfico público y lo entrega por ese túnel. Beneficios sobre la redirección de puertos: no expone la IP ni la red donde vive el server, funciona con IP dinámica sin DDNS, resuelve HTTPS con certificado automático, y permite poner Cloudflare Access adelante para que solo entren emails autorizados.

Requisito: un dominio gestionado por Cloudflare (alcanza un subdominio de uno existente, por ejemplo `dev.<dominio>`). El túnel en sí no tiene costo.

### 7.1 Configuración

1. En el panel de Zero Trust (`one.dash.cloudflare.com`): **Networks → Tunnels → Create a tunnel → Cloudflared**, y darle un nombre reconocible en los logs.
2. En la pantalla de instalación del conector, elegir **Docker** y copiar el **token**. Se muestra una sola vez: si se pierde, hay que regenerarlo.
3. Guardar el token en `.env.local` como `TUNNEL_TOKEN`. **Nunca al repositorio:** `.env.local` va en `.gitignore`.
4. Agregar el servicio al compose:

```yaml
  tunnel:
    image: cloudflare/cloudflared:2026.6.1   # version fija, nunca :latest
    restart: unless-stopped
    command: tunnel --no-autoupdate run --token ${TUNNEL_TOKEN}
    depends_on: [web]
```

5. En la pestaña **Public Hostname** del túnel, mapear `dev.<dominio>` a `http://web:3000`. El destino es el **nombre del servicio en la red de Docker**, no `localhost`: `cloudflared` alcanza a los demás contenedores por nombre, y todos deben compartir la misma red del compose.
6. Proteger el acceso con **Cloudflare Access**: política de lista de emails permitidos con código de un solo uso. Un desarrollo a medio hacer no debe quedar visible para cualquiera que descubra la URL.

### 7.2 Reglas de exposición

- **Solo sale la aplicación web (puerto 3000).** Postgres, la consola de MinIO, Mailpit y ElasticMQ nunca se mapean a un hostname público. Las credenciales del laboratorio son de juguete: la consola de MinIO expuesta entrega todo el almacenamiento, y Mailpit expuesto muestra cada correo que genera el sistema.
- El ambiente local **nunca** contiene datos reales de clientes finales (ver sección 4 del documento 08).
- Cuando llegue el módulo del bot, el mismo túnel provee la URL pública HTTPS que Meta necesita para los webhooks, con una ruta específica sin Access adelante (Meta no puede autenticarse) pero con verificación de firma `X-Hub-Signature-256` obligatoria (documento 04).
- `restart: unless-stopped` para que el conector se recupere solo. Si el conector cae, Cloudflare deja de rutear a esos hostnames en segundos y vuelve solo al reconectarse.

## 8. Nota sobre el trabajo con Claude Code

El laboratorio local es también el ambiente donde corre Claude Code. Recomendaciones para que rinda:

- El repositorio completo en el server local, con `CLAUDE.md` en la raíz apuntando a `docs/plan` como fuente de verdad.
- Los comandos frecuentes (`docker compose up`, migraciones, tests, suite de aislamiento) definidos como scripts en `package.json` para que sean invocables de forma consistente.
- Regla para el agente: ninguna tarea que toque datos se declara terminada sin correr la suite de aislamiento.
