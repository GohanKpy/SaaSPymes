# ADR 0003 · Configuracion del motor del bot gestionada desde el panel

**Fecha:** 2026-08-04
**Estado:** aceptado (decision del negocio)

## Contexto

El ADR 0002 dejo el motor del bot multi-proveedor, pero elegido por
variables de entorno: rotar una llave, cambiar de modelo o pasar de OpenAI
a Anthropic exigia editar `.env` y redeploy. El negocio pidio gestionarlo
desde el panel de plataforma con un usuario administrador.

## Decision

Nueva tabla `control.platform_settings` (clave-valor): `public_config`
para lo visible (proveedor, modelo) y `encrypted_payload` para secretos,
cifrados a nivel de aplicacion con el CryptoService (mismo patron que
`integration_credentials`, doc 05 §4.2). Primer registro: `bot_engine`,
con las llaves de ambos proveedores guardadas por separado para que el
cambio de proveedor no exija recargar llaves.

- API: `GET/PUT /platform/settings/bot`, solo `padmin`. El GET jamas
  devuelve llaves (solo si estan cargadas); el PUT acepta llaves opcionales
  (solo al rotar) y audita en `platform_audit_log`.
- El BotService lee la configuracion de la base con cache corto (30 s);
  las variables de entorno quedan como fallback para instalaciones nuevas
  y para el laboratorio.

## Consecuencias

- Rotacion de llave, cambio de modelo o de proveedor: efecto en <30 s sin
  deploy, con auditoria de quien y cuando.
- Un dump de la base no expone llaves (cifradas); el acceso queda
  restringido al rol padmin en la capa de autorizacion.
- La tabla queda disponible para futura configuracion operativa de la
  plataforma (sin abusar: lo estructural sigue en el plan).
