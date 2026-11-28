// @ts-check
/**
 * The API tests' own databases. Each test run creates one (test/global-setup.mjs) and
 * drops it when the run ends. A run that is killed never reaches that teardown: Ctrl+C,
 * a command timeout, or `pnpm -r test` stopping the API tests when another package's
 * tests failed (fixed with --no-bail, but any kill does the same). So every run first
 * drops the databases such runs left behind.
 */
import { randomBytes } from 'node:crypto';

/** A full API test run takes about 4 minutes; after an hour, nobody is using its database. */
export const STALE_AFTER_MS = 60 * 60 * 1000;

const NAME = /^lp_(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})_[0-9a-f]{8}$/;

/**
 * `lp_<UTC yyyymmddhhmmss>_<8 hex>`: the name records when the run started.
 * @param {Date} [now]
 */
export function testDatabaseName(now = new Date()) {
  const stamp = now.toISOString().replace(/\D/g, '').slice(0, 14);
  return `lp_${stamp}_${randomBytes(4).toString('hex')}`;
}

/**
 * When the test run that named this database started, or null for any other name
 * (the dev database, or an older `lp_<12 hex>` test database, which can't be dated).
 * @param {string} name
 * @returns {Date | null}
 */
export function startedAt(name) {
  const m = NAME.exec(name);
  if (!m) return null;
  const [year, month, day, hour, minute, second] = m.slice(1).map(Number);
  return new Date(Date.UTC(year, month - 1, day, hour, minute, second));
}

/**
 * Drop the test databases that killed runs left: named by testDatabaseName, older than
 * STALE_AFTER_MS, and with nobody connected. Any error is thrown: the run fails and says why.
 * @param {import('pg').Client} admin an owner client, on any database
 * @param {Date} [now]
 * @returns {Promise<string[]>} the dropped databases
 */
export async function dropStaleTestDatabases(admin, now = new Date()) {
  const { rows } = await admin.query(
    `select d.datname from pg_database d
      where not exists (select 1 from pg_stat_activity a where a.datname = d.datname)`,
  );
  const stale = rows
    .map((row) => String(row.datname))
    .filter((name) => {
      const started = startedAt(name);
      return started !== null && now.getTime() - started.getTime() > STALE_AFTER_MS;
    })
    .sort();
  for (const name of stale) {
    // No FORCE: nobody is connected, and if someone connected since, this fails loudly.
    await admin.query(`drop database if exists ${admin.escapeIdentifier(name)}`);
  }
  return stale;
}
