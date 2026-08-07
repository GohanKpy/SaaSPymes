import 'reflect-metadata';

import fastifyCookie from '@fastify/cookie';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { loadEnv } from '@pymes/shared';

import { AppModule } from './app.module';
import { ProblemFilter } from './common/problem.filter';

// Montos bigint (guaranies) serializados como string en JSON (doc 04 §1).
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- parche global de serializacion
(BigInt.prototype as any).toJSON = function (this: bigint) {
  return this.toString();
};

async function bootstrap(): Promise<void> {
  // Valida el entorno ANTES de levantar nada: sin config completa no hay arranque.
  const env = loadEnv();

  // trustProxy: detras del tunel Cloudflare los requests llegan desde el
  // contenedor cloudflared; sin esto el bloqueo de login y la auditoria
  // registrarian esa IP interna para TODO el mundo (un lockout global).
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ trustProxy: true }),
    {
      rawBody: true, // firma X-Hub-Signature-256 de webhooks (doc 04 §3.10)
    },
  );

  await app.register(fastifyCookie);
  // CORS con credenciales: WEB_ORIGIN admite lista separada por comas; en
  // desarrollo tambien se acepta cualquier host de la LAN en el puerto del
  // panel (4300), para probar desde otras maquinas sin reconstruir.
  const allowedOrigins = env.WEB_ORIGIN.split(',').map((o) => o.trim());
  const devPanelOrigin = /^https?:\/\/[^/]+:430[08]$/; // 4300 clientes, 4308 admin
  app.enableCors({
    credentials: true,
    // @fastify/cors por defecto solo permite GET,HEAD,POST: sin esta lista
    // los PATCH/PUT/DELETE de los paneles mueren en el preflight.
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    origin: (origin, cb) => {
      const allowed =
        !origin ||
        allowedOrigins.includes(origin) ||
        (env.NODE_ENV !== 'production' && devPanelOrigin.test(origin));
      cb(null, allowed);
    },
  });
  // Base /api/v1 (doc 04 §1); /health queda fuera como liveness de infra.
  app.setGlobalPrefix('api/v1', { exclude: ['health'] });
  app.useGlobalFilters(new ProblemFilter());
  app.enableShutdownHooks();

  // 0.0.0.0 para ser alcanzable desde fuera del contenedor.
  await app.listen({ port: env.API_PORT, host: '0.0.0.0' });
  Logger.log(`API escuchando en puerto ${env.API_PORT}`, 'Bootstrap');
}

void bootstrap();
