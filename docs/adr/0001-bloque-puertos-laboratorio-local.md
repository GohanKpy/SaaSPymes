# ADR 0001 · Bloque de puertos de host dedicado para el laboratorio local

**Fecha:** 2026-08-04
**Estado:** aceptado

## Contexto

El compose de referencia del doc 11 §3 mapea los servicios del laboratorio a sus
puertos canónicos en el host (3000, 3001, 5432, 9000/9001, 9324, 1025/8025).
En la máquina de desarrollo conviven otros proyectos activos que ya ocupan
varios de esos puertos (al primer arranque, un servidor Node de Windows tenía
tomado el 3000), y con Docker Desktop sobre WSL2 el conflicto ocurre del lado
Windows aunque WSL muestre el puerto libre.

## Decisión

El laboratorio expone en el host el bloque dedicado **4300–4307**:

| Servicio      | Host | Contenedor        |
| ------------- | ---- | ----------------- |
| web           | 4300 | 4300 (`PORT`)     |
| api           | 4301 | 4301 (`API_PORT`) |
| Postgres      | 4302 | 5432              |
| MinIO S3      | 4303 | 9000              |
| MinIO consola | 4304 | 9001              |
| ElasticMQ     | 4305 | 9324              |
| Mailpit SMTP  | 4306 | 1025              |
| Mailpit UI    | 4307 | 8025              |

- Las imágenes de terceros conservan sus puertos canónicos **dentro** de la red
  de Docker: las URLs entre contenedores (`db:5432`, `minio:9000`, `queue:9324`,
  `mail:1025`) no cambian y la paridad con AWS queda intacta.
- `web` y `api` toman su puerto de las variables `PORT` y `API_PORT`
  (regla de portabilidad del doc 11 §2: nada fijo en el código), de modo que
  tampoco colisionan al correr `pnpm dev` fuera de Docker.

## Consecuencias

- Cero interferencia con otros proyectos: todo lo de este repo vive en 4300–4307.
- Las URLs de host difieren de las del compose de referencia del doc 11 §3
  (que sigue siendo válido como arquitectura); este ADR es la fuente de verdad
  de los mapeos locales.
- En AWS nada cambia: allí no existen estos mapeos de host y los puertos de
  `web`/`api` se definen por variable de entorno por ambiente.
