// @ts-check
/**
 * The database tools: create the app role, apply the migrations, load the seed.
 *
 * They run as the OWNER (POSTGRES_USER), which the API never does: the API logs in
 * as the app role, which owns nothing, so row-level security always applies to it.
 * Used by `pnpm db:migrate`, `pnpm db:seed` and the test suite's global setup.
 *
 * Settings come from the process environment, with defaults that match
 * docker-compose.yml. `.env` is not read here.
 */
import { readdir, readFile } from 'node:fs/promises';
import pg from 'pg';

const REPO = new URL('../../../', import.meta.url);
const MIGRATIONS = new URL('db/migrations/', REPO);
const SEED = new URL('db/seed.sql', REPO);
const MIGRATION_FILE = /^\d{4}_[a-z0-9_]+\.sql$/;
const ROLE_NAME = /^[a-z_][a-z0-9_]*$/;
// Advisory-lock keys. The role lock is taken in the shared admin database, because
// advisory locks are per database and roles are per server.
const ROLE_LOCK = 'levelpath:ensure-app-role';
const MIGRATE_LOCK = 'levelpath:migrate';

/**
 * @typedef {{ user: string, password: string }} Login
 * @typedef {{ host: string, port: number, database: string, owner: Login, app: Login }} DbSettings
 */

/**
 * Connection settings, from the environment or the docker-compose defaults.
 * `database` is POSTGRES_DB: the dev database, and the admin database the tests
 * create their own databases from.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {DbSettings}
 */
export function dbConfig(env = process.env) {
  return {
    host: env.POSTGRES_HOST ?? 'localhost',
    port: Number(env.POSTGRES_PORT ?? 5432),
    database: env.POSTGRES_DB ?? 'levelpath',
    owner: {
      user: env.POSTGRES_USER ?? 'levelpath_owner',
      password: env.POSTGRES_PASSWORD ?? 'levelpath_dev_password',
    },
    app: {
      user: env.APP_DB_USER ?? 'levelpath_app',
      password: env.APP_DB_PASSWORD ?? 'levelpath_app_dev_password',
    },
  };
}

/**
 * A connected owner client for one database. The caller ends it.
 * @param {DbSettings} cfg
 * @param {string} database
 */
export async function ownerClient(cfg, database) {
  const client = new pg.Client({
    host: cfg.host,
    port: cfg.port,
    database,
    user: cfg.owner.user,
    password: cfg.owner.password,
  });
  await client.connect();
  return client;
}

/**
 * Create the app role if it doesn't exist: it can log in, and nothing else (not a
 * superuser, no BYPASSRLS, can't create databases or roles). An existing role is
 * left as it is, password included. Several test runs may call this at once:
 * roles are server-wide, so they queue on one lock in the shared admin database.
 * @param {DbSettings} [cfg]
 * @returns {Promise<boolean>} true when the role was created
 */
export async function ensureAppRole(cfg = dbConfig()) {
  if (!ROLE_NAME.test(cfg.app.user)) {
    throw new Error(`APP_DB_USER must match ${ROLE_NAME}, got ${JSON.stringify(cfg.app.user)}`);
  }
  const client = await ownerClient(cfg, cfg.database);
  try {
    await client.query('select pg_advisory_lock(hashtext($1))', [ROLE_LOCK]);
    const existing = await client.query(
      `select r.rolsuper, r.rolbypassrls, r.rolcreaterole, r.rolcreatedb, r.rolreplication,
              exists (select 1 from pg_auth_members m where m.member = r.oid) as member_of_roles
       from pg_roles r where r.rolname = $1`,
      [cfg.app.user],
    );
    if (existing.rowCount) {
      // An existing role is used as it is, so it must be as limited as one created here:
      // a superuser or BYPASSRLS role skips every policy, replication ignores it, the
      // others can widen the role, and a member of another role can SET ROLE to it.
      const r = existing.rows[0];
      const extra = [
        r.rolsuper && 'SUPERUSER',
        r.rolbypassrls && 'BYPASSRLS',
        r.rolcreaterole && 'CREATEROLE',
        r.rolcreatedb && 'CREATEDB',
        r.rolreplication && 'REPLICATION',
        r.member_of_roles && 'membership in another role',
      ].filter(Boolean);
      if (extra.length > 0) {
        throw new Error(
          `APP_DB_USER "${cfg.app.user}" already exists with ${extra.join(', ')}: ` +
            'row-level security would not hold for it. Point APP_DB_USER at a role without them.',
        );
      }
      return false;
    }
    await client.query(
      `create role ${client.escapeIdentifier(cfg.app.user)} login nosuperuser nocreatedb ` +
        `nocreaterole noreplication nobypassrls password ${client.escapeLiteral(cfg.app.password)}`,
    );
    return true;
  } finally {
    await client.end(); // ending the session releases the advisory lock
  }
}

/**
 * Apply, in filename order, every migration in db/migrations/ not yet recorded in
 * schema_migrations. Each file and its record go in one transaction. Creates the
 * app role first, because the migrations grant to it.
 * @param {{ database?: string, cfg?: DbSettings }} [options]
 * @returns {Promise<string[]>} the files applied now; empty when there was nothing to do
 */
export async function migrate({ cfg = dbConfig(), database = cfg.database } = {}) {
  await ensureAppRole(cfg);
  const files = (await readdir(MIGRATIONS)).filter((f) => MIGRATION_FILE.test(f)).sort();
  const client = await ownerClient(cfg, database);
  try {
    await client.query('select pg_advisory_lock(hashtext($1))', [MIGRATE_LOCK]);
    // Owned by the owner and never granted: the app role can't read or change it.
    await client.query(
      'create table if not exists public.schema_migrations ' +
        '(filename text primary key, applied_at timestamptz not null default now())',
    );
    const done = new Set(
      (await client.query('select filename from public.schema_migrations')).rows.map(
        (r) => r.filename,
      ),
    );
    const applied = [];
    for (const file of files) {
      if (done.has(file)) continue;
      const text = (await readFile(new URL(file, MIGRATIONS), 'utf8')).replaceAll(
        '{{app_role}}',
        client.escapeIdentifier(cfg.app.user),
      );
      await inTransaction(client, `migration ${file}`, async () => {
        await client.query(text);
        await client.query('insert into public.schema_migrations (filename) values ($1)', [file]);
      });
      applied.push(file);
    }
    return applied;
  } finally {
    await client.end();
  }
}

/**
 * Load db/seed.sql, in one transaction. It is idempotent: fixed ids, ON CONFLICT DO NOTHING.
 * @param {{ database?: string, cfg?: DbSettings }} [options]
 */
export async function seed({ cfg = dbConfig(), database = cfg.database } = {}) {
  const text = await readFile(SEED, 'utf8');
  const client = await ownerClient(cfg, database);
  try {
    await inTransaction(client, 'seed', () => client.query(text));
  } finally {
    await client.end();
  }
}

/**
 * Run `fn` between BEGIN and COMMIT; on failure roll back and rethrow with `what` in the message.
 * @param {pg.Client} client
 * @param {string} what
 * @param {() => Promise<unknown>} fn
 */
async function inTransaction(client, what, fn) {
  await client.query('begin');
  try {
    await fn();
    await client.query('commit');
  } catch (err) {
    await client.query('rollback').catch((rollbackErr) => {
      console.error(`${what}: rollback failed too: ${rollbackErr.message}`);
    });
    throw new Error(`${what} failed: ${err instanceof Error ? err.message : String(err)}`, {
      cause: err,
    });
  }
}
