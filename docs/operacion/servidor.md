# Servidor del sistema — operación (runbook)

Entorno donde corre hoy el SaaS, detrás de
`https://client.inicia.com.py`, `https://admin.inicia.com.py` y
`https://api.inicia.com.py`. La decisión y su alcance están en
[ADR 0015](../adr/0015-servidor-propio-sin-docker.md). El análisis previo
(dimensionamiento, LIVE en Vercel + Supabase) está en
[la propuesta del 2026-09-22](../propuestas/2026-09-22-migracion-dev-servidor-y-live-vercel-supabase.md).

> **Fuera del repo (y así debe quedar):** IP, puerto y usuario de SSH, la
> llave privada, contraseñas y el `.env.local`. Todo eso está en
> `D:\Proyectos\SaaS-Pymes\Docs\accesos-y-urls.txt` de Johan (sección 12). El
> repositorio es **público**.

Actualizado: 2026-09-29.

---

## 1. Qué corre y dónde

| Pieza | Detalle |
|---|---|
| Máquina | Ubuntu Server 26.04.1 LTS, 4 vCPU, 7,2 GB RAM, 4 GB swap, disco 48 GB (servidor del proveedor) |
| Docker | **No se usa** (decisión de Johan, 2026-09-24). Todo nativo. |
| Usuario de la app | `dev`: sin sudo y sin SSH. Es dueño del código, del build y del `.env.local`. |
| Código | `/home/dev/pymes-saas`: repo git con `receive.denyCurrentBranch=updateInstead` (un push actualiza el árbol de trabajo). |
| Node / pnpm | Node 24 LTS con `fnm` (`/home/dev/.fnm/aliases/default/bin`), pnpm 10.34.5 con su instalador (no corepack). |
| PostgreSQL | 17 (repositorio oficial pgdg) en `127.0.0.1:4302`, solo localhost. `shared_buffers=1GB` en `/etc/postgresql/17/main/conf.d/pymes.conf`. Base `pymes` con locale `en_US.UTF-8`, que hubo que generar (`locale-gen`) porque el volcado del laboratorio lo exige. Roles `migrator` / `app_rw` / `platform_ops` sin BYPASSRLS, como en el laboratorio. Supabase queda para más adelante. |
| Servicios systemd | `pymes-dev-api` (4301, `node dist/main.js` en `apps/api`), `pymes-dev-web` (4300, `next start`, `PORTAL=client`), `pymes-dev-webadmin` (4308, `PORTAL=admin`) y `pymes-dev-mailpit` (SMTP `127.0.0.1:1025`, visor `127.0.0.1:4307`). Todos con `User=dev`, `EnvironmentFile=/home/dev/pymes-saas/.env.local` y `Restart=on-failure`. |
| Túnel | `cloudflared` (usuario `ubuntuserver`, servicio de usuario `cloudflared-pymes-test` con *linger*, arranca solo al bootear). Túnel `pymes-test` (id `06c082ae-9bcf-46fa-9757-969edbf38ffa`), **administrado localmente** en `/home/ubuntuserver/.cloudflared/config.yml`. |
| Firewall | ufw: entra solo SSH. Los puertos 4300–4308 no se exponen: todo sale por el túnel. |

**Nunca** arrancar `next start` con `-H 127.0.0.1`. El middleware arma la
redirección entre portales con `nextUrl` y sale `https://localhost:4300/...`
(verificado). Sin `-H` sale relativa, y los puertos igual quedan cerrados por
ufw.

## 2. Direcciones

| Host | Servicio local |
|---|---|
| `client.inicia.com.py` (y alias `test.inicia.com.py`) | `127.0.0.1:4300` portal de clientes (incluye `/chat`, el chat de prueba del bot) |
| `admin.inicia.com.py` (y alias `test-admin.inicia.com.py`) | `127.0.0.1:4308` portal admin de plataforma |
| `api.inicia.com.py` (y alias `test-api.inicia.com.py`) | `127.0.0.1:4301` API (`/health`) |

Variables del `.env.local` que dependen de las direcciones (el resto de sus
claves son secretos y no se documentan acá):

```
WEB_ORIGIN=https://client.inicia.com.py,https://admin.inicia.com.py,https://test.inicia.com.py,https://test-admin.inicia.com.py
NEXT_PUBLIC_API_URL=https://api.inicia.com.py      # se compila dentro del front: cambiarla exige rebuild --force
PUBLIC_API_URL=https://api.inicia.com.py           # arma las redirect_uri de Google y los links de los avisos
```

`client` va primero en `WEB_ORIGIN` porque se usa como destino por defecto
de algunas redirecciones.

### Cambiar o agregar un hostname

1. Agregar la regla `ingress` en `config.yml` (antes del `http_status:404`) y
   validarla con `cloudflared tunnel --config <config.yml> ingress validate`.
2. Apuntar el DNS al túnel del servidor:
   `cloudflared tunnel route dns --overwrite-dns pymes-test <host>` (como
   `ubuntuserver`, que tiene el `cert.pem` de la cuenta).
3. Si es un panel, sumarlo a `WEB_ORIGIN`.
4. Reiniciar: `systemctl --user restart cloudflared-pymes-test` (como
   `ubuntuserver`, con `XDG_RUNTIME_DIR=/run/user/1000`) y los servicios.
5. Actualizar `accesos-y-urls.txt` y este documento.

**Rollback** de `client` / `admin` / `api` al laboratorio de la PC (túnel
`pymes-lab`, administrado desde el panel de Cloudflare):
`cloudflared tunnel route dns --overwrite-dns 6129c401-ab6e-4b3d-badc-68be9e10e583 <host>`.

## 3. Desplegar una versión nueva

Desde la PC de trabajo (con el remoto `pymes-test` configurado, ver §8):

```bash
git push pymes-test main
ssh pymes-test 'sudo -n -u dev bash -lc "cd /home/dev/pymes-saas \
  && export PATH=/home/dev/.fnm/aliases/default/bin:\$PATH \
  && set -a && . ./.env.local && set +a \
  && pnpm install --frozen-lockfile \
  && pnpm turbo build --filter=@pymes/web --filter=@pymes/api --concurrency=2 \
  && pnpm --filter @pymes/db db:migrate" \
  && sudo systemctl restart pymes-dev-api pymes-dev-web pymes-dev-webadmin'
```

- El build tarda unos 80 s por app. `--concurrency=2` evita quedarse sin
  memoria.
- Si cambió una variable `NEXT_PUBLIC_*`, agregar `--force`: el front la
  compila adentro y la cache de turbo puede reusar el build viejo.
- Solo cambios de front: alcanza con `--filter=@pymes/web` y reiniciar
  `pymes-dev-web pymes-dev-webadmin`.

Verificación después de desplegar:

1. `curl -s https://api.inicia.com.py/health`, y `/login` en los dos portales.
2. `systemctl is-active pymes-dev-api pymes-dev-web pymes-dev-webadmin`.
3. Errores de la API: `sudo journalctl -u pymes-dev-api --since -10min`. Los
   logs vienen con colores ANSI: filtrarlos con `sed 's/\x1b\[[0-9;]*m//g'`
   antes de hacer grep.
4. Para una regresión completa, usar el skill `testear-servidor`
   (`.claude/skills/testear-servidor`).

## 4. Base de datos

- **Hoy:** es una COPIA del laboratorio del 2026-09-24 (`pg_dump -Fc` en
  caliente y `pg_restore --create`; las 53 tablas verificadas fila por fila).
  Usuarios y contraseñas son los del laboratorio. `CRYPTO_LOCAL_KEY_BASE64` es
  la del laboratorio, porque sin ella no se descifran los secretos guardados.
- **Volcados:** en `/var/backups/pymes/` del servidor (solo root) y en
  `~/respaldos-pymes/` de la WSL de Johan.
- **No hay respaldo automático todavía** (pendiente, ver
  `docs/estado/2026-09-29-estado.md`).
- **Recopiar el laboratorio** antes de pasar a uso real limpia los restos de
  QA. Hay que volver a aplicar los cortes de §5.
- Suite de aislamiento contra esta base: con el `.env.local` cargado,
  `pnpm test` en el servidor. Estaba en verde al desplegar.

## 5. Integraciones: qué está cortado a propósito

Con la copia se apagaron los efectos reales, para no duplicarlos con el
laboratorio:

| Integración | Estado en el servidor | Para encenderla |
|---|---|---|
| WhatsApp real (Meta) | **Apagado.** El webhook de Meta (`https://api.inicia.com.py/api/v1/webhooks/whatsapp`) ya llega acá, pero `META_APP_SECRET` es propio del servidor y la firma falla. Los envíos van a `WHATSAPP_API_URL=http://127.0.0.1:4000` (simulador). La integración E2E LAB quedó con `live=false`. | Cargar el `META_APP_SECRET` y el `META_VERIFY_TOKEN` reales en `.env.local`, apuntar `WHATSAPP_API_URL` a la Graph API, poner `live=true` en la integración y reiniciar la API. Johan decide cómo se carga el secreto. |
| Google Calendar (Tucano) | Integración con `is_active=false` | Reactivar desde el panel del cliente |
| Correo de plataforma | Se quitó la fila `smtp` de `control.platform_settings`: el correo cae en Mailpit (`DEFAULT_SMTP_PORT` 1025) | Configurar el SMTP en padmin → Sistema → Correo |
| IA del bot | La llave de OpenAI guardada es inválida: el navegador la había autocompletado con una contraseña (arreglado en 2afca24) | Cargar la llave real en padmin → Motor del bot |

**Entrar con Google:** el servidor manda
`redirect_uri=https://api.inicia.com.py/api/v1/auth/google/callback` (el
calendario usa `/api/v1/integrations/google/callback`). Las dos, y sus
equivalentes `test-api`, deben estar en "URIs de redireccionamiento
autorizados" del cliente OAuth en Google Cloud. Si no, Google responde
`Error 400: redirect_uri_mismatch`.

## 6. Diagnóstico rápido

| Síntoma | Causa probable | Qué mirar |
|---|---|---|
| Cloudflare **1033** en una dirección | Ningún túnel conectado para ese host | Si es `test*`/`client`/`admin`/`api`: el túnel del servidor (§1). Si el DNS quedó apuntando a `pymes-lab`, depende del Docker de la PC. |
| Cloudflare **502** en la API | La API respondió 502 o está caída | `systemctl status pymes-dev-api` y su journal |
| Cloudflare **1010** desde un script | El Browser Integrity Check bloquea agentes tipo `Python-urllib` | Mandar un User-Agent de navegador |
| La bandeja deja de actualizarse sola | Cloudflare corta el SSE inactivo a los ~125 s; a los ~17 min la reconexión da 401 porque el token de 15 min venció | Problema conocido, pendiente de arreglo |
| `systemctl --user` "no encuentra" el túnel | Se consultó con otro usuario o sin `XDG_RUNTIME_DIR` | `sudo -u ubuntuserver XDG_RUNTIME_DIR=/run/user/1000 systemctl --user status cloudflared-pymes-test` |

## 7. Salud de referencia (2026-09-28)

1,1 GB de RAM usados de 7,2 GB, disco al 23 %, base de 265 MB, 0 errores de
la API en 3 días y el túnel con 4 conexiones. El 27/09 a las 13:52 (hora de
Paraguay) hubo un corte de red de unos 17 s, y el túnel se recuperó solo.

## 8. Trabajar desde otra PC

1. Clonar `https://github.com/GohanKpy/SaaSPymes` y `pnpm install`.
2. Instalar la llave SSH de administrador y el bloque `Host pymes-test` en
   `~/.ssh/config` (datos en `accesos-y-urls.txt`). Probar con `ssh pymes-test`.
3. Remoto de despliegue:
   ```bash
   git remote add pymes-test pymes-test:/home/dev/pymes-saas
   git config remote.pymes-test.receivepack "sudo -n -u dev git-receive-pack"
   ```
4. El `.env.local` NO está en git. Para el laboratorio local hay que pedirlo
   o reconstruirlo desde `.env.local.example`. El del servidor vive solo en
   el servidor.
5. La memoria de Claude (`~/.claude/...`) no viaja entre PCs. Lo que hace
   falta para continuar está en este documento, en el
   [ADR 0015](../adr/0015-servidor-propio-sin-docker.md) y en
   [docs/estado/2026-09-29-estado.md](../estado/2026-09-29-estado.md).
