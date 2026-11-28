import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ownerClient, testDb } from '../../test/helpers.js';
import {
  dropStaleTestDatabases,
  STALE_AFTER_MS,
  startedAt,
  testDatabaseName,
} from '../../test/test-databases.mjs';

// The test runs' own databases: a killed run can't drop its database, so the next run
// drops the ones nobody uses any more. Against real Postgres: CREATE and DROP DATABASE.

describe('test database names', () => {
  it('record when the run started', () => {
    const now = new Date('2026-11-28T09:30:12.345Z');
    const name = testDatabaseName(now);
    expect(name).toMatch(/^lp_20261128093012_[0-9a-f]{8}$/);
    expect(startedAt(name)?.toISOString()).toBe('2026-11-28T09:30:12.000Z');
  });

  it('date only the test databases this module named', () => {
    expect(startedAt('lp_43f41098ed00')).toBeNull(); // an older run's name: no time in it
    expect(startedAt('levelpath')).toBeNull();
    expect(startedAt('lp_20261128093012_cafe')).toBeNull();
  });
});

describe('dropStaleTestDatabases', () => {
  const now = new Date();
  const old = new Date(now.getTime() - STALE_AFTER_MS - 60_000);
  const left = testDatabaseName(old); // a killed run's, an hour ago
  const inUse = testDatabaseName(old); // as old, but someone is still connected
  const fresh = testDatabaseName(now); // a run in progress
  let owner: pg.Client;
  let holder: pg.Client;

  const exists = async (name: string) =>
    (await owner.query('select 1 from pg_database where datname = $1', [name])).rowCount === 1;

  beforeAll(async () => {
    owner = await ownerClient();
    for (const name of [left, inUse, fresh]) {
      await owner.query(`create database ${owner.escapeIdentifier(name)}`);
    }
    const db = testDb();
    holder = new pg.Client({ host: db.host, port: db.port, database: inUse, ...db.owner });
    await holder.connect();
  });

  afterAll(async () => {
    await holder.end();
    for (const name of [left, inUse, fresh]) {
      await owner.query(`drop database if exists ${owner.escapeIdentifier(name)} with (force)`);
    }
    await owner.end();
  });

  it('drops an old one that nobody uses, and keeps the rest', async () => {
    const dropped = await dropStaleTestDatabases(owner, now);
    expect(dropped).toContain(left);
    expect(dropped).not.toContain(inUse);
    expect(dropped).not.toContain(fresh);
    expect(await exists(left)).toBe(false);
    expect(await exists(inUse)).toBe(true);
    expect(await exists(fresh)).toBe(true);
    expect(await exists(testDb().database)).toBe(true); // this run's own, by the old rule too
  });
});
