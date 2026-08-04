import { Global, Module } from '@nestjs/common';
import { loadEnv } from '@pymes/shared';

/** Token de inyeccion del entorno validado (unica lectura de process.env). */
export const ENV = 'ENV';

@Global()
@Module({
  providers: [{ provide: ENV, useFactory: () => loadEnv() }],
  exports: [ENV],
})
export class EnvModule {}
