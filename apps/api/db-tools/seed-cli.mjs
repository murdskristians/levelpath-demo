// `pnpm db:seed`: load db/seed.sql into POSTGRES_DB, as the owner. Safe to run twice.
import { dbConfig, seed } from './db-lib.mjs';

const cfg = dbConfig();
try {
  await seed({ cfg });
  console.log(`${cfg.database}: seeded (Acme Corp and Globex Corp)`);
} catch (err) {
  console.error(`db:seed failed: ${err instanceof Error ? err.message : String(err)}`);
  console.error('Is Postgres up, and migrated? Run `pnpm db:up`, then `pnpm db:migrate`.');
  process.exitCode = 1;
}
