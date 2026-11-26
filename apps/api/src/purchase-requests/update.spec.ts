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

// PUT /purchase-requests/:id replaces the fields of the caller's own draft. Anything
// else the caller may not see is the same 404; a request that isn't a draft is a 409.

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

const VALID = {
  title: 'Edited title',
  amountCents: 4200,
  currency: 'USD',
  supplierId: A.suppliers[1],
  category: 'hardware',
  description: 'Edited description',
};

async function put(userId: string | undefined, id: string, body: unknown = VALID) {
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
      title: 'Update test',
      amountCents: 1000,
      supplierId: A.suppliers[0],
      category: 'other',
    }),
  });
  expect(res.status).toBe(201);
  return purchaseRequestSchema.parse(await res.json());
}

async function ownerRow(id: string) {
  const { rows } = await owner.query(
    `select status, title, amount_cents, currency, category, description, supplier_id, updated_at
       from purchase_requests where id = $1`,
    [id],
  );
  return rows[0];
}

const NOT_FOUND = { message: 'Not Found', statusCode: 404 };

describe('PUT /purchase-requests/:id, happy path (criterion 1)', () => {
  it("replaces the caller's own draft and keeps it a draft", async () => {
    const draft = await createAs(A.requester);
    const res = await put(A.requester, draft.id);
    expect(res.status).toBe(200);
    const updated = purchaseRequestSchema.parse(JSON.parse(res.text));
    expect(updated).toMatchObject({
      id: draft.id,
      status: 'draft',
      title: VALID.title,
      amountCents: VALID.amountCents,
      currency: VALID.currency,
      category: VALID.category,
      description: VALID.description,
      requester: draft.requester,
      createdAt: draft.createdAt,
    });
    expect(updated.supplier.id).toBe(VALID.supplierId);

    const mine = await fetch(`${url}/purchase-requests/mine`, {
      headers: { 'X-User-Id': A.requester },
    });
    const list = (await mine.json()) as PurchaseRequest[];
    expect(list.find((r) => r.id === draft.id)?.title).toBe(VALID.title);

    const { rows } = await owner.query(
      'select updated_at > created_at as later from purchase_requests where id = $1',
      [draft.id],
    );
    expect(rows).toEqual([{ later: true }]);
  });
});

describe('PUT /purchase-requests/:id, what the caller may not see: 404 (criteria 2 to 4)', () => {
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

describe('PUT /purchase-requests/:id, not a draft: 409 (criterion 5)', () => {
  it('answers 409 for a submitted and an approved request, and changes nothing', async () => {
    for (const id of [A.purchaseRequests[1], A.purchaseRequests[2]]) {
      const before = await ownerRow(id);
      const res = await put(A.requester, id);
      expect(res.status).toBe(409);
      expect(apiErrorSchema.parse(JSON.parse(res.text)).statusCode).toBe(409);
      expect(await ownerRow(id)).toEqual(before);
    }
  });

  it('answers 409 for a draft she submitted first', async () => {
    const draft = await createAs(A.requester);
    const submit = await fetch(`${url}/purchase-requests/${draft.id}/submit`, {
      method: 'POST',
      headers: { 'X-User-Id': A.requester },
    });
    expect(submit.status).toBe(200);
    const before = await ownerRow(draft.id);
    const res = await put(A.requester, draft.id);
    expect(res.status).toBe(409);
    expect(await ownerRow(draft.id)).toEqual(before);
  });
});

describe('PUT /purchase-requests/:id, a bad body (criterion 6)', () => {
  it.each([
    ['an empty title', { title: '' }],
    ['a negative amount', { amountCents: -1 }],
    ['a lowercase currency', { currency: 'eur' }],
    ['an invalid category', { category: 'nope' }],
    ['a long description', { description: 'x'.repeat(2001) }],
    ['a status key', { status: 'approved' }],
    ['an id key', { id: UNKNOWN }],
    ['a tenantId key', { tenantId: A.suppliers[0] }],
    ['a requesterId key', { requesterId: A.approver }],
  ])('answers 400 with issues for %s, and changes nothing', async (_name, change) => {
    const draft = await createAs(A.requester);
    const before = await ownerRow(draft.id);
    const res = await put(A.requester, draft.id, { ...VALID, ...change });
    expect(res.status).toBe(400);
    expect(apiErrorSchema.parse(JSON.parse(res.text)).issues?.length).toBeGreaterThan(0);
    expect(await ownerRow(draft.id)).toEqual(before);
  });

  it('answers 404 for a Globex supplier, and changes nothing', async () => {
    const draft = await createAs(A.requester);
    const before = await ownerRow(draft.id);
    const res = await put(A.requester, draft.id, { ...VALID, supplierId: B.suppliers[0] });
    expect(res.status).toBe(404);
    expect(JSON.parse(res.text)).toEqual(NOT_FOUND);
    expect(await ownerRow(draft.id)).toEqual(before);
  });
});

describe('PUT /purchase-requests/:id, no caller (criterion 7)', () => {
  it('answers 401 without X-User-Id', async () => {
    const res = await put(undefined, A.purchaseRequests[0]);
    expect(res.status).toBe(401);
    expect(JSON.parse(res.text)).toEqual({ message: 'Unauthorized', statusCode: 401 });
  });
});

describe('the seed (criterion 8)', () => {
  it('left the seeded requests unchanged', async () => {
    expect(await seededRequestsSnapshot(owner)).toEqual(seeded);
  });
});
