import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { loadEnv } from '@pymes/shared';

import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  // Valida el entorno ANTES de levantar nada: sin config completa no hay arranque.
  const env = loadEnv();

  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter());

  // 0.0.0.0 para ser alcanzable desde fuera del contenedor.
  await app.listen({ port: env.API_PORT, host: '0.0.0.0' });
  Logger.log(`API escuchando en puerto ${env.API_PORT}`, 'Bootstrap');
}

void bootstrap();
