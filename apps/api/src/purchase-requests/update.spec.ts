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

// PUT /purchase-requests/:id over real HTTP against this run's database: the caller's
// own draft gets every create-form field replaced. Anything else the caller may not
// see is the same 404; a request that isn't a draft is a 409.

const A = SEED.acme;
const B = SEED.globex;
const UNKNOWN = 'c0000000-0000-4000-8000-000000000999';
const NOT_FOUND = { message: 'Not Found', statusCode: 404 };
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

const valid = {
  title: 'New',
  amountCents: 500,
  supplierId: A.suppliers[1],
  category: 'software',
  description: 'd',
};

async function put(userId: string | undefined, id: string, body: unknown = valid) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (userId) headers['X-User-Id'] = userId;
  const res = await fetch(`${url}/purchase-requests/${id}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(body),
  });
  return { status: res.status, text: await res.text() };
}

async function createAs(userId: string): Promise<PurchaseRequest> {
  const res = await fetch(`${url}/purchase-requests`, {
    method: 'POST',
    headers: { 'X-User-Id': userId, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'Edit test',
      amountCents: 1000,
      currency: 'USD',
      supplierId: A.suppliers[0],
      category: 'other',
      description: 'before',
    }),
  });
  expect(res.status).toBe(201);
  return purchaseRequestSchema.parse(await res.json());
}

async function ownerRow(id: string) {
  const { rows } = await owner.query('select * from purchase_requests where id = $1', [id]);
  return rows[0];
}

describe('PUT /purchase-requests/:id, happy path', () => {
  it("replaces every field of the caller's own draft", async () => {
    const draft = await createAs(A.requester);
    const res = await put(A.requester, draft.id);
    expect(res.status).toBe(200);
    const updated = purchaseRequestSchema.parse(JSON.parse(res.text));
    expect(updated).toMatchObject({
      id: draft.id,
      title: 'New',
      amountCents: 500,
      currency: 'EUR',
      category: 'software',
      description: 'd',
      status: 'draft',
      createdAt: draft.createdAt,
    });
    expect(updated.supplier.id).toBe(A.suppliers[1]);
    expect(updated.requester).toEqual(draft.requester);

    const { rows } = await owner.query(
      'select updated_at > created_at as later, requester_id, tenant_id from purchase_requests where id = $1',
      [draft.id],
    );
    const before = await ownerRow(draft.id);
    expect(rows[0].later).toBe(true);
    expect(rows[0].requester_id).toBe(before.requester_id);
    expect(before.tenant_id).toBe(rows[0].tenant_id);

    const mine = await fetch(`${url}/purchase-requests/mine`, {
      headers: { 'X-User-Id': A.requester },
    });
    const list = (await mine.json()) as PurchaseRequest[];
    expect(list.find((r) => r.id === draft.id)).toEqual(updated);
  });

  it('sets currency EUR and an empty description when they are left out', async () => {
    const draft = await createAs(A.requester);
    const { title, amountCents, supplierId, category } = valid;
    const res = await put(A.requester, draft.id, { title, amountCents, supplierId, category });
    expect(res.status).toBe(200);
    expect(purchaseRequestSchema.parse(JSON.parse(res.text))).toMatchObject({
      currency: 'EUR',
      description: '',
    });
  });
});

describe('PUT /purchase-requests/:id, what the caller may not see: 404', () => {
  it('answers the same 404 for a non-UUID, an unknown id, a Globex request and another requester’s draft', async () => {
    const amirsDraft = await createAs(A.approver);
    const globexBefore = await ownerRow(B.purchaseRequests[0]);
    const amirsBefore = await ownerRow(amirsDraft.id);

    const answers = [];
    for (const id of ['not-a-uuid', UNKNOWN, B.purchaseRequests[0], amirsDraft.id]) {
      answers.push(await put(A.requester, id));
    }
    for (const res of answers) {
      expect(res.status).toBe(404);
      expect(apiErrorSchema.parse(JSON.parse(res.text))).toEqual(NOT_FOUND);
    }
    expect(new Set(answers.map((res) => res.text)).size).toBe(1);
    expect(await ownerRow(B.purchaseRequests[0])).toEqual(globexBefore);
    expect(await ownerRow(amirsDraft.id)).toEqual(amirsBefore);
  });

  it("answers 404 to Amir for Alice's seeded draft", async () => {
    const before = await ownerRow(A.purchaseRequests[0]);
    const res = await put(A.approver, A.purchaseRequests[0]);
    expect(res.status).toBe(404);
    expect(JSON.parse(res.text)).toEqual(NOT_FOUND);
    expect(await ownerRow(A.purchaseRequests[0])).toEqual(before);
  });
});

describe('PUT /purchase-requests/:id, not a draft: 409', () => {
  it('answers 409 for a submitted and an approved request, and changes nothing', async () => {
    for (const id of [A.purchaseRequests[1], A.purchaseRequests[2]]) {
      const before = await ownerRow(id);
      const res = await put(A.requester, id);
      expect(res.status).toBe(409);
      expect(apiErrorSchema.parse(JSON.parse(res.text)).statusCode).toBe(409);
      expect(await ownerRow(id)).toEqual(before);
    }
  });
});

describe('PUT /purchase-requests/:id, invalid body: 400, unknown supplier: 404', () => {
  const cases: [string, Record<string, unknown>][] = [
    ['an empty title', { title: '' }],
    ['a negative amount', { amountCents: -1 }],
    ['a lowercase currency', { currency: 'eur' }],
    ['a category outside the list', { category: 'furniture' }],
    ['a description over 2000 characters', { description: 'x'.repeat(2001) }],
    ['a missing supplierId', { supplierId: undefined }],
    ['an extra status', { status: 'approved' }],
    ['an extra tenantId', { tenantId: B.tenant }],
    ['an extra id', { id: UNKNOWN }],
    ['an extra requesterId', { requesterId: A.approver }],
  ];

  it.each(cases)('answers 400 for %s and changes nothing', async (_what, change) => {
    const draft = await createAs(A.requester);
    const before = await ownerRow(draft.id);
    const res = await put(A.requester, draft.id, { ...valid, ...change });
    expect(res.status).toBe(400);
    expect(await ownerRow(draft.id)).toEqual(before);
  });

  it('answers 404 for a Globex supplier and changes nothing', async () => {
    const draft = await createAs(A.requester);
    const before = await ownerRow(draft.id);
    const res = await put(A.requester, draft.id, { ...valid, supplierId: B.suppliers[0] });
    expect(res.status).toBe(404);
    expect(await ownerRow(draft.id)).toEqual(before);
  });
});

describe('PUT /purchase-requests/:id, no caller', () => {
  it('answers 401 without X-User-Id', async () => {
    const res = await put(undefined, A.purchaseRequests[0]);
    expect(res.status).toBe(401);
    expect(JSON.parse(res.text)).toEqual({ message: 'Unauthorized', statusCode: 401 });
  });
});

describe('PUT /purchase-requests/:id, tenant isolation', () => {
  it("keeps Globex's requester out of an Acme draft, and Alice out of a Globex draft", async () => {
    const acmeDraft = await createAs(A.requester);
    const acmeBefore = await ownerRow(acmeDraft.id);
    const globexBefore = await ownerRow(B.purchaseRequests[0]);

    const globexEdit = await put(B.requester, acmeDraft.id, {
      ...valid,
      supplierId: B.suppliers[0],
    });
    expect(globexEdit.status).toBe(404);
    expect(JSON.parse(globexEdit.text)).toEqual(NOT_FOUND);
    expect(await ownerRow(acmeDraft.id)).toEqual(acmeBefore);

    const aliceEdit = await put(A.requester, B.purchaseRequests[0]);
    expect(aliceEdit.status).toBe(404);
    expect(JSON.parse(aliceEdit.text)).toEqual(NOT_FOUND);
    expect(await ownerRow(B.purchaseRequests[0])).toEqual(globexBefore);
  });
});

describe('the seed', () => {
  it('left the seeded requests unchanged', async () => {
    expect(await seededRequestsSnapshot(owner)).toEqual(seeded);
  });
});
