import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  appRoleClient,
  databaseService,
  ownerClient,
  SEED,
  TENANT_TABLES,
  testDb,
} from '../../test/helpers.js';
import { APPROVAL_DECISIONS, PURCHASE_REQUEST_STATUSES, USER_ROLES } from '@levelpath/shared';

// Spec criteria 1 to 4 and 9: the migrations, the seed, the app role's rights, and
// the composite foreign keys. Everything runs against real Postgres.

const MIGRATE_CLI = fileURLToPath(new URL('../../db-tools/migrate-cli.mjs', import.meta.url));
const SEED_CLI = fileURLToPath(new URL('../../db-tools/seed-cli.mjs', import.meta.url));
const MIGRATION_FILES = readdirSync(new URL('../../../../db/migrations/', import.meta.url))
  .filter((f) => f.endsWith('.sql'))
  .sort();
const A = SEED.acme;
const B = SEED.globex;
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The environment `pnpm db:migrate` / `pnpm db:seed` would see, aimed at `database`. */
function cliEnv(database: string, overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const db = testDb();
  return {
    ...process.env,
    POSTGRES_HOST: db.host,
    POSTGRES_PORT: String(db.port),
    POSTGRES_DB: database,
    POSTGRES_USER: db.owner.user,
    POSTGRES_PASSWORD: db.owner.password,
    APP_DB_USER: db.app.user,
    APP_DB_PASSWORD: db.app.password,
    ...overrides,
  };
}

/** Run a db-tools CLI against `database`; throws if it exits non-zero. */
function runCli(cli: string, database: string): string {
  return execFileSync(process.execPath, [cli], { encoding: 'utf8', env: cliEnv(database) });
}

let owner: pg.Client;
beforeAll(async () => {
  owner = await ownerClient();
});
afterAll(async () => {
  await owner.end();
});

describe('migrations (criterion 1)', () => {
  const scratch = `lp_${randomBytes(6).toString('hex')}_empty`;

  afterAll(async () => {
    await owner.query(`drop database if exists ${owner.escapeIdentifier(scratch)} with (force)`);
  });

  it('apply every file to an empty database, then nothing on a second run', async () => {
    await owner.query(`create database ${owner.escapeIdentifier(scratch)}`);

    const first = runCli(MIGRATE_CLI, scratch);
    expect(first.trim().split('\n')).toEqual(
      MIGRATION_FILES.map((f) => `${scratch}: applied ${f}`),
    );
    expect(runCli(MIGRATE_CLI, scratch).trim()).toBe(`${scratch}: nothing to apply`);
  });

  it('record each file once', async () => {
    const { rows } = await owner.query('select filename from schema_migrations order by filename');
    expect(rows.map((r) => r.filename)).toEqual(MIGRATION_FILES);
  });

  it('create only the five tenant tables and schema_migrations', async () => {
    const { rows } = await owner.query(
      "select tablename from pg_tables where schemaname = 'public' order by tablename",
    );
    expect(rows.map((r) => r.tablename)).toEqual([...TENANT_TABLES, 'schema_migrations'].sort());
  });
});

describe('row-level security (criterion 2)', () => {
  it('is enabled and forced on exactly the five tenant tables', async () => {
    const { rows } = await owner.query(`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity and c.relforcerowsecurity
      order by c.relname`);
    expect(rows.map((r) => r.relname)).toEqual([...TENANT_TABLES].sort());
  });

  it('has a policy with both USING and WITH CHECK on every one of them', async () => {
    const { rows } = await owner.query(`
      select tablename from pg_policies
      where schemaname = 'public' and policyname = 'tenant_isolation'
        and qual is not null and with_check is not null
      order by tablename`);
    expect(rows.map((r) => r.tablename)).toEqual([...TENANT_TABLES].sort());
  });
});

describe('the app role (criterion 3)', () => {
  let app: pg.Client;
  beforeAll(async () => {
    app = await appRoleClient();
  });
  afterAll(async () => {
    await app.end();
  });

  it('is not a superuser and cannot bypass RLS', async () => {
    const { rows } = await app.query(
      'select rolsuper, rolbypassrls from pg_roles where rolname = current_user',
    );
    expect(rows).toEqual([{ rolsuper: false, rolbypassrls: false }]);
  });

  it('owns no table', async () => {
    const { rows } = await app.query(
      "select tablename from pg_tables where schemaname = 'public' and tableowner = current_user",
    );
    expect(rows).toEqual([]);
  });

  it('may only read tenants and users, and read and write the other three', async () => {
    const { rows } = await app.query(`
      select table_name, string_agg(privilege_type, ',' order by privilege_type) as privileges
      from information_schema.role_table_grants
      where grantee = current_user and table_schema = 'public'
      group by table_name order by table_name`);
    const crud = 'DELETE,INSERT,SELECT,UPDATE';
    expect(rows).toEqual([
      { table_name: 'approvals', privileges: crud },
      { table_name: 'purchase_requests', privileges: crud },
      { table_name: 'suppliers', privileges: crud },
      { table_name: 'tenants', privileges: 'SELECT' },
      { table_name: 'users', privileges: 'SELECT' },
    ]);
  });

  it('cannot read schema_migrations or create a table', async () => {
    await expect(app.query('select * from schema_migrations')).rejects.toThrow(/permission denied/);
    await expect(app.query('create table x ()')).rejects.toThrow(/permission denied/);
  });

  it('cannot create a temporary table, which could shadow a real one on its pooled connection', async () => {
    const { rows } = await app.query(
      "select has_database_privilege(current_user, current_database(), 'TEMP') as temp",
    );
    expect(rows).toEqual([{ temp: false }]);
    await expect(app.query('create temp table suppliers (id uuid)')).rejects.toThrow(
      /permission denied/,
    );
  });
});

describe('a login RLS would not apply to is refused', () => {
  it('by db:migrate, when APP_DB_USER names an existing superuser', () => {
    const owner = testDb().owner;
    const res = spawnSync(process.execPath, [MIGRATE_CLI], {
      encoding: 'utf8',
      env: cliEnv(testDb().database, { APP_DB_USER: owner.user, APP_DB_PASSWORD: owner.password }),
    });
    expect(res.status).toBe(1);
    // Every attribute the role db:migrate creates doesn't have (the owner is no member of a role).
    expect(res.stderr).toContain(
      'already exists with SUPERUSER, BYPASSRLS, CREATEROLE, CREATEDB, REPLICATION: ' +
        'row-level security would not hold for it',
    );
  });

  it('by the API at startup, when it would connect as the owner', async () => {
    const { owner: login } = testDb();
    const asOwner = databaseService({ ...login });
    try {
      // The image's owner trips every condition but membership, which has its own test,
      // so this one asserts the whole list: each branch of the check fires.
      await expect(asOwner.onModuleInit()).rejects.toThrow(
        new RegExp(
          `^refusing to run: the database login "${escapeRegExp(login.user)}" is a superuser, ` +
            'has BYPASSRLS, has REPLICATION, owns tables or schemas, ' +
            'can create schemas in this database, can create objects in a schema \\([^)]*\\), ' +
            'can create temporary tables \\(fix, [^)]*\\), can truncate a table, ' +
            'so row-level security would not hold',
        ),
      );
    } finally {
      await asOwner.onModuleDestroy();
    }
  });

  it('by both, when the login is a member of another role (it could SET ROLE to it)', async () => {
    const suffix = randomBytes(4).toString('hex');
    const group = `lp_probe_group_${suffix}`;
    const member = `lp_probe_${suffix}`;
    const password = randomBytes(12).toString('hex');
    const asMember = databaseService({ user: member, password });
    try {
      // Inside the try, so a failure here still drops what was created (roles outlive the database).
      await owner.query(`create role ${owner.escapeIdentifier(group)} nologin`);
      await owner.query(
        `create role ${owner.escapeIdentifier(member)} login password ${owner.escapeLiteral(password)} ` +
          `in role ${owner.escapeIdentifier(group)}`,
      );
      const res = spawnSync(process.execPath, [MIGRATE_CLI], {
        encoding: 'utf8',
        env: cliEnv(testDb().database, { APP_DB_USER: member, APP_DB_PASSWORD: password }),
      });
      expect(res.status).toBe(1);
      expect(res.stderr).toMatch(/already exists with membership in another role/);
      await expect(asMember.onModuleInit()).rejects.toThrow(/is a member of another role/);
    } finally {
      await asMember.onModuleDestroy();
      await owner.query(`drop role if exists ${owner.escapeIdentifier(member)}`);
      await owner.query(`drop role if exists ${owner.escapeIdentifier(group)}`);
    }
  });

  it('by the API at startup, when the app role may create temporary tables after all', async () => {
    const { database, app } = testDb();
    const target = owner.escapeIdentifier(database);
    const grantee = owner.escapeIdentifier(app.user);
    await owner.query(`grant temporary on database ${target} to ${grantee}`);
    const asApp = databaseService();
    try {
      await expect(asApp.onModuleInit()).rejects.toThrow(/can create temporary tables/);
    } finally {
      await asApp.onModuleDestroy();
      await owner.query(`revoke temporary on database ${target} from ${grantee}`);
    }
  });

  it.each([
    [
      'create objects in schema public',
      'grant create on schema public to',
      'revoke create on schema public from',
      /can create objects in a schema/,
    ],
    [
      'truncate a table (RLS doesn’t apply to TRUNCATE)',
      'grant truncate on public.suppliers to',
      'revoke truncate on public.suppliers from',
      /can truncate a table/,
    ],
  ])('by the API at startup, when the app role may %s', async (_what, grant, revoke, problem) => {
    const grantee = owner.escapeIdentifier(testDb().app.user);
    await owner.query(`${grant} ${grantee}`);
    const asApp = databaseService();
    try {
      await expect(asApp.onModuleInit()).rejects.toThrow(problem);
    } finally {
      await asApp.onModuleDestroy();
      await owner.query(`${revoke} ${grantee}`);
    }
  });

  it('but not when it connects as the app role', async () => {
    const asApp = databaseService();
    try {
      await expect(asApp.onModuleInit()).resolves.toBeUndefined();
    } finally {
      await asApp.onModuleDestroy();
    }
  });
});

describe('the seed (criterion 4)', () => {
  async function counts() {
    const { rows } = await owner.query(`
      select (select count(*)::int from tenants) as tenants,
             (select count(*)::int from users) as users,
             (select count(*)::int from suppliers) as suppliers,
             (select count(*)::int from purchase_requests) as purchase_requests,
             (select count(*)::int from approvals) as approvals`);
    return rows[0];
  }

  it('loads both companies, and running it again changes nothing', async () => {
    const before = await counts();
    runCli(SEED_CLI, testDb().database);
    expect(await counts()).toEqual(before);
    expect(before).toEqual({
      tenants: 2,
      users: 4,
      suppliers: 4,
      purchase_requests: 8,
      approvals: 4,
    });
  });

  it('gives each tenant a purchase request in every status, and an approval for each decided one', async () => {
    const { rows } = await owner.query(`
      select pr.tenant_id, pr.status, count(a.id)::int as approvals
      from purchase_requests pr left join approvals a on a.purchase_request_id = pr.id
      group by pr.tenant_id, pr.status order by pr.tenant_id, pr.status`);
    const expected = (tenant: string) =>
      ['approved', 'draft', 'rejected', 'submitted'].map((status) => ({
        tenant_id: tenant,
        status,
        approvals: status === 'approved' || status === 'rejected' ? 1 : 0,
      }));
    expect(rows).toEqual([...expected(A.tenant), ...expected(B.tenant)]);
  });

  it('has the fixed ids the docs and tests use', async () => {
    const ids = [A.tenant, A.requester, A.approver, B.tenant, B.requester, B.approver];
    const { rows } = await owner.query(
      `select id from tenants where id = any($1::uuid[])
       union all select id from users where id = any($1::uuid[])`,
      [ids],
    );
    expect(rows.map((r) => r.id).sort()).toEqual([...ids].sort());
  });
});

describe('cross-tenant references (criterion 9)', () => {
  // As the owner, which bypasses RLS: only the composite foreign keys stand in the way.
  const FK_VIOLATION = { code: '23503' };

  it('reject a purchase request of A that names B’s supplier or B’s requester', async () => {
    const insert = (requester: string, supplier: string) =>
      owner.query(
        `insert into purchase_requests (tenant_id, requester_id, supplier_id, title, amount_cents)
         values ($1, $2, $3, 'cross-tenant', 100)`,
        [A.tenant, requester, supplier],
      );
    await expect(insert(A.requester, B.suppliers[0])).rejects.toMatchObject(FK_VIOLATION);
    await expect(insert(B.requester, A.suppliers[0])).rejects.toMatchObject(FK_VIOLATION);
  });

  it('reject an approval of A that names B’s purchase request or B’s approver', async () => {
    const insert = (purchaseRequest: string, approver: string) =>
      owner.query(
        `insert into approvals (tenant_id, purchase_request_id, approver_id, decision)
         values ($1, $2, $3, 'approved')`,
        [A.tenant, purchaseRequest, approver],
      );
    await expect(insert(B.purchaseRequests[1], A.approver)).rejects.toMatchObject(FK_VIOLATION);
    await expect(insert(A.purchaseRequests[1], B.approver)).rejects.toMatchObject(FK_VIOLATION);
  });
});

describe('the value lists in values.ts', () => {
  it('are exactly what the database CHECK constraints accept', async () => {
    await owner.query('begin');
    try {
      for (const role of USER_ROLES) {
        await owner.query(`insert into users (tenant_id, name, role) values ($1, 'probe', $2)`, [
          A.tenant,
          role,
        ]);
      }
      for (const status of PURCHASE_REQUEST_STATUSES) {
        await owner.query(
          `insert into purchase_requests (tenant_id, requester_id, supplier_id, title, amount_cents, status)
           values ($1, $2, $3, 'probe', 1, $4)`,
          [A.tenant, A.requester, A.suppliers[0], status],
        );
      }
      for (const decision of APPROVAL_DECISIONS) {
        await owner.query(
          `insert into approvals (tenant_id, purchase_request_id, approver_id, decision)
           values ($1, $2, $3, $4)`,
          [A.tenant, A.purchaseRequests[1], A.approver, decision],
        );
      }
    } finally {
      await owner.query('rollback');
    }
    const CHECK_VIOLATION = { code: '23514' };
    await expect(
      owner.query(`insert into users (tenant_id, name, role) values ($1, 'probe', 'admin')`, [
        A.tenant,
      ]),
    ).rejects.toMatchObject(CHECK_VIOLATION);
    await expect(
      owner.query(
        `insert into purchase_requests (tenant_id, requester_id, supplier_id, title, amount_cents, status)
         values ($1, $2, $3, 'probe', 1, 'paid')`,
        [A.tenant, A.requester, A.suppliers[0]],
      ),
    ).rejects.toMatchObject(CHECK_VIOLATION);
  });
});
