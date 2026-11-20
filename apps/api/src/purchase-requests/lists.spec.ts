import type { INestApplication } from '@nestjs/common';
import { apiErrorSchema, type PurchaseRequest, purchaseRequestSchema } from '@levelpath/shared';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  deleteRowsTestsCreated,
  ownerClient,
  SEED,
  seededRequestsSnapshot,
  startApp,
} from '../../test/helpers.js';

// Spec criteria 6 and 7, over real HTTP against this run's database: GET
// /purchase-requests/mine and /to-decide, each only the caller's company, in order.

const A = SEED.acme;
const B = SEED.globex;
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

async function call(userId: string | undefined, method: 'GET' | 'POST', path: string) {
  const res = await fetch(`${url}${path}`, {
    method,
    headers: userId ? { 'X-User-Id': userId } : {},
  });
  return { status: res.status, body: (await res.json()) as unknown };
}

async function list(userId: string, path: string): Promise<PurchaseRequest[]> {
  const res = await call(userId, 'GET', path);
  expect(res.status).toBe(200);
  const requests = purchaseRequestSchema.array().parse(res.body);
  // A request never appears twice.
  expect(new Set(requests.map((r) => r.id)).size).toBe(requests.length);
  return requests;
}

async function createAs(userId: string, title: string): Promise<PurchaseRequest> {
  const res = await fetch(`${url}/purchase-requests`, {
    method: 'POST',
    headers: { 'X-User-Id': userId, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, amountCents: 1000, supplierId: A.suppliers[0] }),
  });
  expect(res.status).toBe(201);
  return purchaseRequestSchema.parse(await res.json());
}

async function submitAs(userId: string, id: string): Promise<void> {
  expect((await call(userId, 'POST', `/purchase-requests/${id}/submit`)).status).toBe(200);
}

const isGlobex = (id: string) => id.startsWith('b0000000-');

describe('GET /purchase-requests/mine (criterion 6)', () => {
  it('as Amir holds only what Amir created: nothing on the seed', async () => {
    expect(await list(A.approver, '/purchase-requests/mine')).toEqual([]);
  });

  it("as Alice holds her requests in every status, newest first, and none of Globex's", async () => {
    const p1 = await createAs(A.requester, 'List test P1');
    const p2 = await createAs(A.requester, 'List test P2');
    const mine = await list(A.requester, '/purchase-requests/mine');

    expect(mine[0].id).toBe(p2.id);
    expect(mine[1].id).toBe(p1.id);
    expect(mine.map((r) => r.id)).toEqual(expect.arrayContaining([...A.purchaseRequests]));
    expect(mine.some((r) => isGlobex(r.id))).toBe(false);
    expect(mine.every((r) => r.requester.id === A.requester)).toBe(true);
    for (let i = 1; i < mine.length; i++) {
      expect(mine[i].createdAt <= mine[i - 1].createdAt).toBe(true);
    }
  });

  it("includes a decided request's decision", async () => {
    const mine = await list(A.requester, '/purchase-requests/mine');
    const approved = mine.find((r) => r.id === A.purchaseRequests[2]);
    expect(approved?.status).toBe('approved');
    expect(approved?.decision).toEqual({
      decision: 'approved',
      comment: 'Within the facilities budget.',
      approver: { id: A.approver, name: 'Amir' },
      decidedAt: expect.any(String),
    });
    expect(mine.find((r) => r.id === A.purchaseRequests[0])?.decision).toBeNull();
  });

  it('as Bella holds only Globex ids', async () => {
    const mine = await list(B.requester, '/purchase-requests/mine');
    expect(mine.map((r) => r.id).sort()).toEqual([...B.purchaseRequests].sort());
  });

  it('answers 401 without X-User-Id (criterion 2)', async () => {
    const res = await call(undefined, 'GET', '/purchase-requests/mine');
    expect(res.status).toBe(401);
    expect(apiErrorSchema.parse(res.body)).toEqual({ message: 'Unauthorized', statusCode: 401 });
  });
});

describe('GET /purchase-requests/to-decide (criterion 7)', () => {
  it("as Amir holds Acme's submitted requests, oldest first", async () => {
    const toDecide = await list(A.approver, '/purchase-requests/to-decide');
    expect(toDecide.every((r) => r.status === 'submitted')).toBe(true);
    expect(toDecide.map((r) => r.id)).toContain(A.purchaseRequests[1]);
    expect(toDecide.some((r) => isGlobex(r.id))).toBe(false);
    for (let i = 1; i < toDecide.length; i++) {
      expect(toDecide[i].createdAt >= toDecide[i - 1].createdAt).toBe(true);
    }
  });

  it("as Boris holds only Globex's submitted request", async () => {
    const toDecide = await list(B.approver, '/purchase-requests/to-decide');
    expect(toDecide.map((r) => r.id)).toEqual([B.purchaseRequests[1]]);
  });

  it("includes the approver's own submitted request (criterion 15)", async () => {
    const own = await createAs(A.approver, 'List test own');
    await submitAs(A.approver, own.id);
    const toDecide = await list(A.approver, '/purchase-requests/to-decide');
    expect(toDecide.map((r) => r.id)).toContain(own.id);
    expect(toDecide.map((r) => r.id).at(-1)).toBe(own.id);
  });

  it('answers 403 to a requester', async () => {
    const res = await call(A.requester, 'GET', '/purchase-requests/to-decide');
    expect(res.status).toBe(403);
    expect(apiErrorSchema.parse(res.body)).toEqual({ message: 'Forbidden', statusCode: 403 });
  });

  it('answers 401 without X-User-Id (criterion 2)', async () => {
    const res = await call(undefined, 'GET', '/purchase-requests/to-decide');
    expect(res.status).toBe(401);
    expect(apiErrorSchema.parse(res.body)).toEqual({ message: 'Unauthorized', statusCode: 401 });
  });
});

describe('the seed (criterion 18)', () => {
  it('left the seeded requests unchanged', async () => {
    expect(await seededRequestsSnapshot(owner)).toEqual(seeded);
  });
});
