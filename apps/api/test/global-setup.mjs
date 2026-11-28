// @ts-check
/**
 * Vitest global setup: give this test run its own database.
 *
 * Every run (yours, a factory job's, an ADW's, in parallel worktrees) shares one
 * Postgres server but gets a fresh `lp_<start time>_<random>` database, migrated and
 * seeded as the owner, so runs never see each other's rows. It is dropped when the run
 * ends, passed or failed. A killed run can't drop its own, so each run first drops those
 * (test/test-databases.mjs). The tests reach it as the app role through
 * `inject('testDb')` (test/helpers.ts).
 *
 * Without Postgres the run fails, loudly, and says how to fix it. Database tests
 * are never skipped.
 */
import { dbConfig, migrate, ownerClient, seed } from '../db-tools/db-lib.mjs';
import { dropStaleTestDatabases, testDatabaseName } from './test-databases.mjs';

/** @param {import('vitest/node').TestProject} project */
export default async function setup(project) {
  const cfg = dbConfig();
  let admin;
  try {
    admin = await ownerClient(cfg, cfg.database);
  } catch (err) {
    throw new Error(
      `The API tests need Postgres at ${cfg.host}:${cfg.port} (database ${cfg.database}). ` +
        `Run \`pnpm db:up\` first. (${reason(err)})`,
      { cause: err },
    );
  }
  const database = testDatabaseName();
  try {
    const left = await dropStaleTestDatabases(admin);
    if (left.length > 0) {
      console.log(
        `levelpath: dropped ${left.length} test database(s) left by runs that never finished: ${left.join(', ')}`,
      );
    }
    await admin.query(`create database ${admin.escapeIdentifier(database)}`);
  } finally {
    await admin.end();
  }

  try {
    await migrate({ cfg, database });
    await seed({ cfg, database });
  } catch (err) {
    await drop(cfg, database);
    throw err;
  }

  project.provide('testDb', {
    host: cfg.host,
    port: cfg.port,
    database,
    owner: cfg.owner,
    app: cfg.app,
  });

  return async function teardown() {
    await drop(cfg, database);
  };
}

/**
 * Why a connection failed. Node reports `localhost` refusing on both IPv6 and IPv4
 * as an AggregateError with an empty message, so its inner errors are listed.
 * @param {unknown} err
 * @returns {string}
 */
function reason(err) {
  if (err instanceof AggregateError) return err.errors.map(reason).join('; ');
  if (err instanceof Error) return err.message || err.name;
  return String(err);
}

/**
 * @param {import('../db-tools/db-lib.mjs').DbSettings} cfg
 * @param {string} database
 */
async function drop(cfg, database) {
  const admin = await ownerClient(cfg, cfg.database);
  try {
    // FORCE ends any connection a test left open.
    await admin.query(`drop database if exists ${admin.escapeIdentifier(database)} with (force)`);
  } finally {
    await admin.end();
  }
}
