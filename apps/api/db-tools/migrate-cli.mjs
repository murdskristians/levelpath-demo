// `pnpm db:migrate`: apply the pending migrations to POSTGRES_DB, as the owner.
import { dbConfig, migrate } from './db-lib.mjs';

const cfg = dbConfig();
try {
  const applied = await migrate({ cfg });
  if (applied.length === 0) console.log(`${cfg.database}: nothing to apply`);
  for (const file of applied) console.log(`${cfg.database}: applied ${file}`);
} catch (err) {
  console.error(`db:migrate failed: ${err instanceof Error ? err.message : String(err)}`);
  console.error('Is Postgres up? Run `pnpm db:up`.');
  process.exitCode = 1;
}
