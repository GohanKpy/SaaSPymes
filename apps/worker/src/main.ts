import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { loadEnv } from '@pymes/shared';

import { AppModule } from './app.module';

const HEARTBEAT_MS = 60_000;

async function bootstrap(): Promise<void> {
  // Valida el entorno ANTES de levantar nada: sin config completa no hay arranque.
  loadEnv();

  await NestFactory.createApplicationContext(AppModule);
  const logger = new Logger('Worker');
  logger.log('Worker levantado. Consumidores SQS llegan en fase 2; por ahora solo heartbeat.');

  // Mantiene vivo el proceso hasta que existan consumidores de colas reales.
  setInterval(() => logger.debug('heartbeat'), HEARTBEAT_MS);
}

void bootstrap();
