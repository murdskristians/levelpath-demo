import type { INestApplication } from '@nestjs/common';
import { apiErrorSchema, MAX_AMOUNT_CENTS, purchaseRequestSchema } from '@levelpath/shared';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  deleteRowsTestsCreated,
  ownerClient,
  SEED,
  seededRequestsSnapshot,
  startApp,
} from '../../test/helpers.js';

// Spec criteria 3, 4 and 5, over real HTTP against this run's database: POST
// /purchase-requests creates a draft for the caller, validates the body with the shared
// schema, and answers 404 for a supplier the caller's company doesn't have.

const A = SEED.acme;
const B = SEED.globex;
const UNKNOWN = 'c0000000-0000-4000-8000-000000000999';
let app: INestApplication;
let url: string;
let owner: pg.Client;
let seeded: unknown;
beforeAll(async () => {
  ({ app, url } = await startApp());
  owner = await ownerClient();
  seeded = await seededRequestsSnapshot(owner);
});
afterAll(async () => {
  await deleteRowsTestsCreated(owner);
  await owner.end();
  await app.close();
});

async function create(userId: string | undefined, body?: unknown) {
  const headers: Record<string, string> = {};
  if (userId) headers['X-User-Id'] = userId;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${url}/purchase-requests`, {
    method: 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, text: await res.text() };
}

async function requestCount(): Promise<number> {
  const { rows } = await owner.query('select count(*)::int as n from purchase_requests');
  return rows[0].n;
}

const valid = { title: 'x', amountCents: 100, supplierId: A.suppliers[0] };

describe('POST /purchase-requests, happy path (criterion 3)', () => {
  it('creates a draft for the caller, at the largest amount', async () => {
    const res = await create(A.requester, {
      title: '  Test chairs  ',
      amountCents: MAX_AMOUNT_CENTS,
      supplierId: A.suppliers[0],
    });
    expect(res.status).toBe(201);
    const created = purchaseRequestSchema.parse(JSON.parse(res.text));
    expect(created).toEqual({
      id: expect.any(String),
      title: 'Test chairs',
      amountCents: 10_000_000_000,
      currency: 'EUR',
      status: 'draft',
      supplier: { id: A.suppliers[0], name: 'Bright Office Supplies' },
      requester: { id: A.requester, name: 'Alice' },
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
      decision: null,
    });
    expect(typeof created.amountCents).toBe('number');
    expect([...A.purchaseRequests, ...B.purchaseRequests]).not.toContain(created.id);

    const { rows } = await owner.query(
      'select tenant_id, requester_id, amount_cents, status from purchase_requests where id = $1',
      [created.id],
    );
    expect(rows).toEqual([
      {
        tenant_id: A.tenant,
        requester_id: A.requester,
        amount_cents: '10000000000',
        status: 'draft',
      },
    ]);
  });

  it('keeps a currency the caller gives', async () => {
    const res = await create(A.approver, { ...valid, currency: 'USD' });
    expect(res.status).toBe(201);
    const created = purchaseRequestSchema.parse(JSON.parse(res.text));
    expect(created.currency).toBe('USD');
    expect(created.requester).toEqual({ id: A.approver, name: 'Amir' });
  });
});

describe('POST /purchase-requests, invalid body: 400 with issues (criterion 4)', () => {
  const cases: [string, unknown, string?][] = [
    ['an id', { ...valid, id: 'a0000000-0000-4000-8000-000000000999' }, ''],
    ['a tenantId', { ...valid, tenantId: B.tenant }, ''],
    ['a requesterId', { ...valid, requesterId: B.requester }, ''],
    ['a status', { ...valid, status: 'approved' }, ''],
    ['an empty title', { ...valid, title: '' }, 'title'],
    ['an amount over the cap', { ...valid, amountCents: MAX_AMOUNT_CENTS + 1 }, 'amountCents'],
    ['a fractional amount', { ...valid, amountCents: 1.5 }, 'amountCents'],
    ['a supplierId that is not a UUID', { ...valid, supplierId: 'not-a-uuid' }, 'supplierId'],
    ['no body at all', undefined, ''],
  ];

  it.each(cases)('rejects %s, and inserts nothing', async (_name, body, path) => {
    const before = await requestCount();
    const res = await create(A.requester, body);
    expect(res.status).toBe(400);
    const error = apiErrorSchema.parse(JSON.parse(res.text));
    expect(error.statusCode).toBe(400);
    expect(error.message).not.toBe('');
    expect(error.issues?.length).toBeGreaterThan(0);
    if (path !== undefined) expect(error.issues?.map((i) => i.path)).toContain(path);
    expect(await requestCount()).toBe(before);
  });
});

describe('POST /purchase-requests, a supplier the company lacks: 404 (criterion 5)', () => {
  it("answers 404 for Globex's supplier and for an unknown one, the same way", async () => {
    const before = await requestCount();
    const globex = await create(A.requester, { ...valid, supplierId: B.suppliers[0] });
    const unknown = await create(A.requester, { ...valid, supplierId: UNKNOWN });
    for (const res of [globex, unknown]) {
      expect(res.status).toBe(404);
      expect(apiErrorSchema.parse(JSON.parse(res.text))).toEqual({
        message: 'Not Found',
        statusCode: 404,
      });
    }
    expect(globex.text).toBe(unknown.text);
    expect(await requestCount()).toBe(before);
  });
});

describe('POST /purchase-requests, no caller (criterion 2)', () => {
  it('answers 401 without X-User-Id, and inserts nothing', async () => {
    const before = await requestCount();
    const res = await create(undefined, valid);
    expect(res.status).toBe(401);
    expect(JSON.parse(res.text)).toEqual({ message: 'Unauthorized', statusCode: 401 });
    expect(await requestCount()).toBe(before);
  });
});

describe('the seed (criterion 18)', () => {
  it('left the seeded requests unchanged', async () => {
    expect(await seededRequestsSnapshot(owner)).toEqual(seeded);
  });
});
