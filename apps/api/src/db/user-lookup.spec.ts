import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appRoleClient, databaseService, ownerClient, SEED, testDb } from '../../test/helpers.js';

// Spec criterion 16 and the guard's lookup: the one thing that reads a user before a
// tenant is known gives one user's id, tenant and role, and opens nothing else.

const A = SEED.acme;
const B = SEED.globex;
const UNKNOWN = 'c0000000-0000-4000-8000-000000000999';

describe('app_resolve_user, as the app role', () => {
  let app: pg.Client;
  beforeAll(async () => {
    app = await appRoleClient();
  });
  afterAll(async () => {
    await app.end();
  });

  it('leaves RLS on users: with no tenant set, the table looks empty', async () => {
    const { rows } = await app.query('select * from users');
    expect(rows).toEqual([]);
  });

  it('returns one user’s id, tenant and role, and nothing more (no name)', async () => {
    const { rows } = await app.query('select * from app_resolve_user($1)', [A.requester]);
    expect(rows).toEqual([{ id: A.requester, tenant_id: A.tenant, role: 'requester' }]);
  });

  it('returns nothing for an unknown id', async () => {
    const { rows } = await app.query('select * from app_resolve_user($1)', [UNKNOWN]);
    expect(rows).toEqual([]);
  });

  it('is the only function of ours the app role can run, takes one id, and has a fixed search_path', async () => {
    const { rows } = await app.query(`
      select p.proname, pg_get_function_identity_arguments(p.oid) as args, p.prosecdef, p.proconfig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and has_function_privilege(current_user, p.oid, 'execute')`);
    expect(rows).toEqual([
      {
        proname: 'app_resolve_user',
        args: 'user_id uuid',
        prosecdef: true,
        proconfig: ['search_path=pg_catalog, pg_temp'],
      },
    ]);
  });

  it('cannot be run by other roles (PUBLIC has no EXECUTE)', async () => {
    const { rows } = await app.query(
      "select has_function_privilege('public', 'public.app_resolve_user(uuid)', 'execute') as allowed",
    );
    expect(rows).toEqual([{ allowed: false }]);
  });
});

describe('DatabaseService.resolveUser', () => {
  const db = databaseService();
  afterAll(async () => {
    await db.onModuleDestroy();
  });

  it('resolves a seeded user to id, tenant and role', async () => {
    expect(await db.resolveUser(A.requester)).toEqual({
      userId: A.requester,
      tenantId: A.tenant,
      role: 'requester',
    });
    expect(await db.resolveUser(B.approver)).toEqual({
      userId: B.approver,
      tenantId: B.tenant,
      role: 'approver',
    });
  });

  it('calls exactly app_resolve_user(uuid), not a look-alike planted for a text argument', async () => {
    // Without the ::uuid cast, Postgres resolves an untyped parameter to a text overload.
    const owner = await ownerClient();
    try {
      await owner.query(`
        create function public.app_resolve_user(user_id text)
        returns table (id uuid, tenant_id uuid, role text) language sql
        as $$ select user_id::uuid, '${B.tenant}'::uuid, 'approver'::text $$`);
      await owner.query(
        `grant execute on function public.app_resolve_user(text) to ${owner.escapeIdentifier(testDb().app.user)}`,
      );
      expect(await db.resolveUser(A.requester)).toEqual({
        userId: A.requester,
        tenantId: A.tenant,
        role: 'requester',
      });
    } finally {
      await owner.query('drop function if exists public.app_resolve_user(text)');
      await owner.end();
    }
  });

  it('returns undefined for an unknown or malformed id, without querying with it', async () => {
    expect(await db.resolveUser(UNKNOWN)).toBeUndefined();
    expect(await db.resolveUser('not-a-uuid')).toBeUndefined();
    expect(await db.resolveUser(`${A.requester}' or '1'='1`)).toBeUndefined();
  });
});
