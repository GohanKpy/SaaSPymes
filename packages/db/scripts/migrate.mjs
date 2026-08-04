// Aplica las migraciones Prisma conectado como `migrator` (dueño de los
// objetos, doc 03 §1). El runtime jamas usa ese rol.
import { spawnSync } from 'node:child_process';

const url = process.env.MIGRATOR_DATABASE_URL;
if (!url) {
  console.error('Falta MIGRATOR_DATABASE_URL (ver .env.local.example).');
  process.exit(1);
}

const result = spawnSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
  stdio: 'inherit',
  env: { ...process.env, DATABASE_URL: url },
});
process.exit(result.status ?? 1);
