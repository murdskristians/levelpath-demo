import { sql } from 'kysely';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  databaseService,
  ownerClient,
  SEED,
  TENANT_TABLES,
  type TenantTable,
} from '../../test/helpers.js';
import type { TenantTransaction } from './database.service.js';

// Spec criteria 5 to 8: from tenant A's transaction, tenant B's rows can't be read,
// changed, deleted or created, on every tenant table, even by B's exact id.

const A = SEED.acme;
const B = SEED.globex;
const db = databaseService();
let owner: pg.Client;

beforeAll(async () => {
  owner = await ownerClient();
});
afterAll(async () => {
  await owner.end();
  await db.onModuleDestroy();
});

/** The column that says whose a row is. */
const TENANT_COLUMN: Record<TenantTable, string> = {
  tenants: 'id',
  users: 'tenant_id',
  suppliers: 'tenant_id',
  purchase_requests: 'tenant_id',
  approvals: 'tenant_id',
};
type Seeded = typeof A | typeof B;
/** One seeded row per table and tenant. */
const rowOf = (t: Seeded): Record<TenantTable, string> => ({
  tenants: t.tenant,
  users: t.requester,
  suppliers: t.suppliers[0],
  purchase_requests: t.purchaseRequests[1],
  approvals: t.approvals[0],
});

const RLS_VIOLATION = /violates row-level security policy/;
const PERMISSION_DENIED = /permission denied for table/;

describe.each(TENANT_TABLES)('%s: select (criterion 5)', (table) => {
  const read = (tenant: Seeded, other: Seeded) =>
    db.withTenant(tenant.tenant, async (trx) => ({
      owners: (
        await sql<{ owner: string }>`
          select ${sql.ref(TENANT_COLUMN[table])} as owner from ${sql.table(table)}`.execute(trx)
      ).rows.map((r) => r.owner),
      byOthersId: (
        await sql`select * from ${sql.table(table)} where id = ${rowOf(other)[table]}`.execute(trx)
      ).rows,
    }));

  it('tenant A sees its own rows only, and not B’s even by B’s id', async () => {
    const { owners, byOthersId } = await read(A, B);
    expect(owners.length).toBeGreaterThan(0);
    expect(new Set(owners)).toEqual(new Set([A.tenant]));
    expect(byOthersId).toEqual([]);
  });

  it('tenant B sees its own rows only, and not A’s', async () => {
    const { owners, byOthersId } = await read(B, A);
    expect(new Set(owners)).toEqual(new Set([B.tenant]));
    expect(byOthersId).toEqual([]);
  });
});

/** The tables the app may write, the text column the tests try to change, and a new row. */
const WRITABLE = {
  suppliers: {
    column: 'name',
    row: (t: Seeded) => ({ tenant_id: t.tenant, name: 'probe supplier' }),
  },
  purchase_requests: {
    column: 'title',
    row: (t: Seeded) => ({
      tenant_id: t.tenant,
      requester_id: t.requester,
      supplier_id: t.suppliers[0],
      title: 'probe request',
      amount_cents: 100,
    }),
  },
  approvals: {
    column: 'comment',
    row: (t: Seeded) => ({
      tenant_id: t.tenant,
      purchase_request_id: t.purchaseRequests[1],
      approver_id: t.approver,
      decision: 'approved' as const,
    }),
  },
} as const;
type WritableTable = keyof typeof WRITABLE;

function insert(trx: TenantTransaction, table: WritableTable, t: Seeded) {
  switch (table) {
    case 'suppliers':
      return trx
        .insertInto('suppliers')
        .values(WRITABLE.suppliers.row(t))
        .returning('id')
        .executeTakeFirstOrThrow();
    case 'purchase_requests':
      return trx
        .insertInto('purchase_requests')
        .values(WRITABLE.purchase_requests.row(t))
        .returning('id')
        .executeTakeFirstOrThrow();
    case 'approvals':
      return trx
        .insertInto('approvals')
        .values(WRITABLE.approvals.row(t))
        .returning('id')
        .executeTakeFirstOrThrow();
  }
}

async function ownerRow(
  table: TenantTable,
  id: string,
): Promise<Record<string, unknown> | undefined> {
  const { rows } = await owner.query(
    `select * from ${owner.escapeIdentifier(table)} where id = $1`,
    [id],
  );
  return rows[0];
}

describe.each(Object.keys(WRITABLE) as WritableTable[])('%s: writes', (table) => {
  const { column } = WRITABLE[table];
  const bId = rowOf(B)[table];

  it('update of B’s row from A affects 0 rows, and B’s row is unchanged (criterion 6)', async () => {
    const before = await ownerRow(table, bId);
    const result = await db.withTenant(A.tenant, (trx) =>
      sql`update ${sql.table(table)} set ${sql.ref(column)} = 'changed by A' where id = ${bId}`.execute(
        trx,
      ),
    );
    expect(result.numAffectedRows).toBe(0n);
    expect(await ownerRow(table, bId)).toEqual(before);
  });

  it('moving one of A’s own rows to B fails the WITH CHECK (criterion 6)', async () => {
    await expect(
      db.withTenant(A.tenant, (trx) =>
        sql`update ${sql.table(table)} set tenant_id = ${B.tenant} where id = ${rowOf(A)[table]}`.execute(
          trx,
        ),
      ),
    ).rejects.toThrow(RLS_VIOLATION);
  });

  it('delete of B’s row from A affects 0 rows, and B’s row still exists (criterion 7)', async () => {
    const result = await db.withTenant(A.tenant, (trx) =>
      sql`delete from ${sql.table(table)} where id = ${bId}`.execute(trx),
    );
    expect(result.numAffectedRows).toBe(0n);
    expect(await ownerRow(table, bId)).toBeDefined();
  });

  it('insert of a row for B from A fails; a row for A succeeds (criterion 8)', async () => {
    await expect(db.withTenant(A.tenant, (trx) => insert(trx, table, B))).rejects.toThrow(
      RLS_VIOLATION,
    );

    const id = await db.withTenant(A.tenant, async (trx) => {
      const { id } = await insert(trx, table, A);
      await trx.deleteFrom(table).where('id', '=', id).execute(); // leave the seed as it was
      return id;
    });
    expect(await ownerRow(table, id)).toBeUndefined();
  });
});

describe.each(['tenants', 'users'] as const)(
  '%s: the app can only read it (criteria 6 to 8)',
  (table) => {
    const ownId = rowOf(A)[table];

    it('update, even of A’s own row, is denied', async () => {
      await expect(
        db.withTenant(A.tenant, (trx) =>
          sql`update ${sql.table(table)} set name = name where id = ${ownId}`.execute(trx),
        ),
      ).rejects.toThrow(PERMISSION_DENIED);
    });

    it('delete, even of A’s own row, is denied', async () => {
      await expect(
        db.withTenant(A.tenant, (trx) =>
          sql`delete from ${sql.table(table)} where id = ${ownId}`.execute(trx),
        ),
      ).rejects.toThrow(PERMISSION_DENIED);
    });

    it('insert is denied', async () => {
      const attempt =
        table === 'tenants'
          ? (trx: TenantTransaction) =>
              trx.insertInto('tenants').values({ name: 'probe' }).execute()
          : (trx: TenantTransaction) =>
              trx
                .insertInto('users')
                .values({ tenant_id: A.tenant, name: 'probe', role: 'requester' })
                .execute();
      await expect(db.withTenant(A.tenant, attempt)).rejects.toThrow(PERMISSION_DENIED);
    });
  },
);
