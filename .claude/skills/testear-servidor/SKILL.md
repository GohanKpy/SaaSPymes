---
name: testear-servidor
description: Batería intensiva de pruebas de punta a punta del SaaS PyMEs contra un entorno desplegado (el servidor, vía el túnel público). Recorre todos los módulos de la API (~218 pruebas), todas las pantallas y pestañas de los dos portales en un navegador real (escritorio y celular) y, opcionalmente, la bandeja en vivo durante 18 minutos. Usar cuando pidan "pruebas intensivas", verificar que todas las funciones estén operativas después de un despliegue o migración, o una regresión general del sistema.
argument-hint: "[api | ui | bandeja — sin args corre api y ui]"
---

# Batería de pruebas del servidor

Este skill DETECTA y REPORTA. No arregla bugs en la misma corrida: el flujo
acordado con Johan es reportar → él decide → recién ahí se arregla y redeploya
(ver `docs/operacion/servidor.md`).

## Qué hace cada script (`scripts/`)

| Script | Qué prueba | Duración |
|---|---|---|
| `bateria-api.py` | Crea SU PROPIO negocio QA (`QA Servidor <MMDDHHMM>`), su plan y un agente de soporte, y recorre por la API pública: portal admin (planes, negocios, usuarios, ajustes, auditoría), acceso y sesión, empleados, catálogo e inventario, clientes (contactos, RUCs, actividades), agenda y turnos, presupuestos y facturación SIFEN simulada (emitir, anular, nota de crédito), cobros, bandeja y chat de prueba, bot, seguridad (aislamiento 404, roles, bloqueo de intentos) y cierre de sesión. | 4–6 min |
| `recorrido-ui.js` | Con el negocio QA de la última corrida: entra a los dos portales en Chromium y visita todas las pantallas y cada pestaña (`role=tab`); marca errores de JavaScript, llamadas a la API fallidas y pantallas de error; después repite en tamaño celular buscando desborde horizontal. Guarda capturas. | 3–5 min |
| `bandeja-larga.js` | Abre la bandeja y la deja quieta 18 minutos: registra cada reconexión del stream (SSE) y al final manda un mensaje por el chat de prueba para ver si aparece sin recargar. | 19 min |

**No toca los negocios reales:** todo se crea dentro del negocio QA. Quedan
como restos (a propósito, para poder mirarlos): el negocio, su plan
`qa-srv-<ts>` y el agente `qa.agente<ts>@pymes.local` (desactivado). Se
limpian al volver a copiar la base o borrándolos desde el portal admin.

## Requisitos

- Python 3 (solo biblioteca estándar) para `bateria-api.py`.
- Node ≥ 22 con `playwright` y Chromium para los `.js`
  (`npx playwright install chromium` la primera vez).
- Un usuario **admin** del portal de plataforma para la corrida (hoy
  `qa.claude@pymes.local`; su contraseña está en el archivo de accesos de
  Johan, NUNCA en el repo).

## Variables de entorno

| Variable | Default | Para qué |
|---|---|---|
| `QA_PADMIN_EMAIL` / `QA_PADMIN_PASS` | — (obligatorias) | Admin de plataforma que crea el negocio QA |
| `QA_API` | `https://api.inicia.com.py/api/v1` | API a probar |
| `QA_WEB` | `https://client.inicia.com.py` | Portal de clientes |
| `QA_ADMIN_WEB` | `https://admin.inicia.com.py` | Portal admin |
| `QA_SALIDA` | `~/.cache/pymes-qa` | Resultados y capturas. FUERA del repo: el JSON lleva la clave del dueño QA creado |
| `QA_AJENO` | uuid al azar | Id de un cliente de OTRO negocio, para que la prueba de aislamiento sea real (sin él, solo prueba el 404 de un id inexistente) |

## Cómo correrlo

```bash
export QA_PADMIN_EMAIL=qa.claude@pymes.local QA_PADMIN_PASS='<de accesos-y-urls.txt>'
python3 .claude/skills/testear-servidor/scripts/bateria-api.py
node .claude/skills/testear-servidor/scripts/recorrido-ui.js
node .claude/skills/testear-servidor/scripts/bandeja-larga.js   # opcional, 19 min
```

El resumen final de `bateria-api.py` lista cada falla con su detalle; el JSON
completo queda en `$QA_SALIDA/qa_resultado_<ts>.json`.

## Cómo leer los resultados (trampas conocidas)

- **Cloudflare delante de todo.** El script se identifica como navegador
  porque el Browser Integrity Check bloquea `Python-urllib` (error 1010). Un
  bloqueo o página de Cloudflare cuenta SIEMPRE como falla ("BLOQUEO
  CLOUDFLARE"), nunca como la respuesta esperada. Un 502 de la API también
  llega como página de Cloudflare.
- **Sin llave de IA válida** fallan 2 pruebas: el asistente del portal admin
  (502) y "la IA respondió con el precio real". El bot igual deriva a una
  persona (eso sí debe pasar). No es un bug del código: falta cargar la llave
  en padmin → Motor del bot.
- **Emitir / anular facturas devuelven 202** (proceso asíncrono), no 200.
- **Reprogramar un turno** cancela el viejo y devuelve el turno NUEVO (otro
  id): lo que se completa después es el nuevo.
- **Bandeja larga:** Cloudflare corta el SSE inactivo cada ~125 s y el
  navegador reconecta. Si a los ~17 min la reconexión da 401 (token de 15 min
  vencido) y el mensaje no aparece sin recargar, es el problema conocido
  pendiente (ver `docs/estado/2026-09-29-estado.md`).
- **Desborde en celular:** medirlo cargando la página directamente en
  390 px. Si se achica una página cargada en tamaño escritorio, da falsos
  positivos.

Tras cambios que toquen datos, además de esta batería corre la suite de
aislamiento (`pnpm test`, regla de CLAUDE.md).
