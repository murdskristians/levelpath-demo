import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  appRoleClient,
  databaseService,
  ownerClient,
  SEED,
  TENANT_TABLES,
  testDb,
} from '../../test/helpers.js';

// Spec criteria 10 to 12: outside withTenant nothing is visible, a pooled connection
// never carries a tenant into the next use, and withTenant checks its input and sets
// the tenant before anything else.

const A = SEED.acme;
const B = SEED.globex;

describe('outside withTenant (criterion 10)', () => {
  let app: pg.Client;
  beforeAll(async () => {
    app = await appRoleClient();
  });
  afterAll(async () => {
    await app.end();
  });

  it.each(TENANT_TABLES)('a plain app-role connection sees no %s', async (table) => {
    const { rows } = await app.query(
      `select count(*)::int as n from ${app.escapeIdentifier(table)}`,
    );
    expect(rows[0].n).toBe(0);
  });

  it('an empty tenant setting matches nothing, without an error', async () => {
    await app.query('begin');
    try {
      await app.query("select set_config('app.tenant_id', '', true)");
      const { rows } = await app.query('select count(*)::int as n from suppliers');
      expect(rows[0].n).toBe(0);
    } finally {
      await app.query('commit');
    }
  });
});

describe('the pooled connection (criterion 11)', () => {
  // One connection: every withTenant and every plain query below reuses it.
  const db = testDb();
  const pool = new pg.Pool({
    host: db.host,
    port: db.port,
    database: db.database,
    ...db.app,
    max: 1,
  });
  const service = databaseService({ pool });
  afterAll(async () => {
    await service.onModuleDestroy(); // ends the pool too
  });

  const setting = async () =>
    (await pool.query("select current_setting('app.tenant_id', true) as v")).rows[0].v ?? '';
  const visibleSuppliers = async () =>
    (await pool.query('select count(*)::int as n from suppliers')).rows[0].n;
  const tenantsOfSuppliers = (tenantId: string) =>
    service.withTenant(tenantId, (trx) =>
      trx.selectFrom('suppliers').select('tenant_id').execute(),
    );

  it('goes back to the pool with no tenant after a commit', async () => {
    expect((await tenantsOfSuppliers(A.tenant)).map((r) => r.tenant_id)).toEqual([
      A.tenant,
      A.tenant,
    ]);
    expect(pool.totalCount).toBe(1);
    expect(await visibleSuppliers()).toBe(0);
    expect(await setting()).toBe('');
  });

  it('serves the next tenant only its own rows', async () => {
    expect((await tenantsOfSuppliers(B.tenant)).map((r) => r.tenant_id)).toEqual([
      B.tenant,
      B.tenant,
    ]);
    expect(pool.totalCount).toBe(1);
  });

  it('goes back clean and usable after fn throws (rolled back)', async () => {
    await expect(
      service.withTenant(A.tenant, async (trx) => {
        await trx.selectFrom('suppliers').selectAll().execute();
        throw new Error('fn failed');
      }),
    ).rejects.toThrow('fn failed');
    expect(await visibleSuppliers()).toBe(0);
    expect(await setting()).toBe('');
    expect(pool.totalCount).toBe(1);
  });

  it('survives Postgres ending its connection, in use or idle, and reconnects', async () => {
    // What this guards against would crash the API: a dying connection emits 'error',
    // and with nobody listening Node exits. Here that would surface as an unhandled
    // error, which fails the test run.
    const owner = await ownerClient();
    const terminate = (pid: number) => owner.query('select pg_terminate_backend($1)', [pid]);
    const pidOf = async (client: pg.PoolClient) =>
      (await client.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0].pid;
    try {
      // In use: a request holds the connection when Postgres ends it.
      const busy = await pool.connect();
      const ended = new Promise<void>((resolve) => busy.once('end', () => resolve()));
      await terminate(await pidOf(busy));
      await ended;
      busy.release(true); // a dead connection doesn't go back into the pool

      // Idle: the connection sits in the pool when Postgres ends it.
      const idle = await pool.connect();
      const idlePid = await pidOf(idle);
      idle.release();
      await terminate(idlePid);
      await waitFor(() => pool.totalCount === 0);

      // The next request gets a fresh connection, scoped as usual.
      expect((await tenantsOfSuppliers(B.tenant)).map((r) => r.tenant_id)).toEqual([
        B.tenant,
        B.tenant,
      ]);
    } finally {
      await owner.end();
    }
  });
});

async function waitFor(condition: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`condition not met within ${timeoutMs} ms`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe('withTenant itself (criterion 12)', () => {
  const statements: string[] = [];
  const service = databaseService({ log: (sql) => statements.push(sql) });
  afterAll(async () => {
    await service.onModuleDestroy();
  });

  it.each(['not-a-uuid', '', `${A.tenant}' or true --`])(
    'refuses tenant id %j before any query runs',
    async (tenantId) => {
      statements.length = 0;
      await expect(service.withTenant(tenantId, async () => 'ran')).rejects.toThrow(/UUID/);
      expect(statements).toEqual([]);
    },
  );

  it('sets the tenant as the first statement of its transaction', async () => {
    statements.length = 0;
    await service.withTenant(A.tenant, (trx) => trx.selectFrom('tenants').select('name').execute());
    const first = statements.findIndex((s) => s.includes('set_config'));
    // Only the transaction's own BEGIN may come before it.
    expect(statements.slice(0, first).every((s) => /^begin\b/i.test(s.trim()))).toBe(true);
    expect(first).toBeLessThanOrEqual(1);
    expect(statements[first]).toBe("select set_config('app.tenant_id', $1, true)");
    expect(statements.slice(first + 1).some((s) => s.includes('"tenants"'))).toBe(true);
  });
});
