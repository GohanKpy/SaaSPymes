import { fileURLToPath } from 'node:url';

import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Carga el entorno del laboratorio si existe (en CI las variables ya vienen puestas).
try {
  process.loadEnvFile(fileURLToPath(new URL('../../.env.local', import.meta.url)));
} catch {
  // sin .env.local: entorno provisto por el runner
}

// El .env.local esta escrito para los contenedores (hostname interno `db`);
// el test corre FUERA de Docker, asi que las URLs de runtime se derivan de
// MIGRATOR_DATABASE_URL (localhost), igual que la suite de packages/db.
if (process.env.MIGRATOR_DATABASE_URL) {
  const derive = (role: string): string => {
    const url = new URL(process.env.MIGRATOR_DATABASE_URL as string);
    url.username = role;
    return url.toString();
  };
  process.env.DATABASE_URL = derive('app_rw');
  process.env.PLATFORM_DATABASE_URL = derive('platform_ops');
}

export default defineConfig({
  // esbuild no emite metadata de decoradores y la DI de Nest la necesita:
  // los tests se transpilan con SWC (misma receta que la doc oficial de Nest).
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['test/**/*.test.ts'],
    hookTimeout: 120000,
    testTimeout: 60000,
    // La app y los datos sembrados se comparten: un solo hilo.
    fileParallelism: false,
  },
});
