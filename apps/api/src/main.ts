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

  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
    rawBody: true, // firma X-Hub-Signature-256 de webhooks (doc 04 §3.10)
  });

  await app.register(fastifyCookie);
  app.enableCors({ origin: env.WEB_ORIGIN, credentials: true });
  // Base /api/v1 (doc 04 §1); /health queda fuera como liveness de infra.
  app.setGlobalPrefix('api/v1', { exclude: ['health'] });
  app.useGlobalFilters(new ProblemFilter());
  app.enableShutdownHooks();

  // 0.0.0.0 para ser alcanzable desde fuera del contenedor.
  await app.listen({ port: env.API_PORT, host: '0.0.0.0' });
  Logger.log(`API escuchando en puerto ${env.API_PORT}`, 'Bootstrap');
}

void bootstrap();
