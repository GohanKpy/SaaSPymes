import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { loadEnv } from '@pymes/shared';

import { createApp } from './app.factory';

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  const app = await createApp();
  // 0.0.0.0 para ser alcanzable desde fuera del contenedor.
  await app.listen({ port: env.API_PORT, host: '0.0.0.0' });
  Logger.log(`API escuchando en puerto ${env.API_PORT}`, 'Bootstrap');
}

void bootstrap();
