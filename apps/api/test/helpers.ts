import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'node:net';
import pg from 'pg';
import { inject } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { DatabaseService } from '../src/db/database.service.js';
import { DB_CONFIG, type DbConfig } from '../src/db/db-config.js';

// Helpers for the database and HTTP tests. They connect to this run's own database,
// which test/global-setup.mjs created and handed over as `testDb`.

interface Login {
  user: string;
  password: string;
}

export interface TestDb {
  host: string;
  port: number;
  database: string;
  owner: Login;
  app: Login;
}

declare module 'vitest' {
  export interface ProvidedContext {
    testDb: TestDb;
  }
}

/** The seeded rows the tests name (db/seed.sql). */
export const SEED = {
  acme: {
    tenant: 'a0000000-0000-4000-8000-000000000001',
    requester: 'a0000000-0000-4000-8000-000000000101',
    approver: 'a0000000-0000-4000-8000-000000000102',
    suppliers: ['a0000000-0000-4000-8000-000000000201', 'a0000000-0000-4000-8000-000000000202'],
    purchaseRequests: [
      'a0000000-0000-4000-8000-000000000301',
      'a0000000-0000-4000-8000-000000000302',
      'a0000000-0000-4000-8000-000000000303',
      'a0000000-0000-4000-8000-000000000304',
    ],
    approvals: ['a0000000-0000-4000-8000-000000000401', 'a0000000-0000-4000-8000-000000000402'],
  },
  globex: {
    tenant: 'b0000000-0000-4000-8000-000000000001',
    requester: 'b0000000-0000-4000-8000-000000000101',
    approver: 'b0000000-0000-4000-8000-000000000102',
    suppliers: ['b0000000-0000-4000-8000-000000000201', 'b0000000-0000-4000-8000-000000000202'],
    purchaseRequests: [
      'b0000000-0000-4000-8000-000000000301',
      'b0000000-0000-4000-8000-000000000302',
      'b0000000-0000-4000-8000-000000000303',
      'b0000000-0000-4000-8000-000000000304',
    ],
    approvals: ['b0000000-0000-4000-8000-000000000401', 'b0000000-0000-4000-8000-000000000402'],
  },
} as const;

export const TENANT_TABLES = [
  'tenants',
  'users',
  'suppliers',
  'purchase_requests',
  'approvals',
] as const;
export type TenantTable = (typeof TENANT_TABLES)[number];

export function testDb(): TestDb {
  return inject('testDb');
}

/** The API's settings for this run's database: the app role, never the owner. */
export function appDbConfig(overrides: Partial<DbConfig> = {}): DbConfig {
  const db = testDb();
  return { host: db.host, port: db.port, database: db.database, ...db.app, ...overrides };
}

/** A DatabaseService on this run's database, outside Nest. Call onModuleDestroy() when done. */
export function databaseService(overrides: Partial<DbConfig> = {}): DatabaseService {
  return new DatabaseService(appDbConfig(overrides));
}

async function connect(login: Login): Promise<pg.Client> {
  const db = testDb();
  const client = new pg.Client({ host: db.host, port: db.port, database: db.database, ...login });
  await client.connect();
  return client;
}

/** A raw owner connection, to look at rows as they really are (the owner is a superuser: no RLS). */
export function ownerClient(): Promise<pg.Client> {
  return connect(testDb().owner);
}

/** A raw app-role connection with nothing set up: what a query outside withTenant gets. */
export function appRoleClient(): Promise<pg.Client> {
  return connect(testDb().app);
}

/** The real app on a free port, pointed at this run's database. Close it when done. */
export async function startApp(): Promise<{ app: INestApplication; url: string }> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DB_CONFIG)
    .useValue(appDbConfig())
    .compile();
  const app = moduleRef.createNestApplication({ logger: false });
  await app.listen(0, '127.0.0.1');
  const { port } = app.getHttpServer().address() as AddressInfo;
  return { app, url: `http://127.0.0.1:${port}` };
}
