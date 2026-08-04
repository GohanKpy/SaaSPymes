import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

// Carga el entorno del laboratorio si existe (en CI las variables ya vienen puestas).
try {
  process.loadEnvFile(fileURLToPath(new URL('../../.env.local', import.meta.url)));
} catch {
  // sin .env.local: entorno provisto por el runner
}

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    hookTimeout: 60000,
    testTimeout: 30000,
    // La suite comparte datos sembrados: un solo hilo, sin paralelismo.
    fileParallelism: false,
  },
});
