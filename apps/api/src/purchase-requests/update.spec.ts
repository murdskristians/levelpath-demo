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

// PATCH /purchase-requests/:id over real HTTP against this run's database: the
// requester who created a draft replaces its six fields. Anything the caller may not
// see is the same 404; a request that isn't a draft is a 409; every refusal changes nothing.

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

const NEW_VALUES = {
  title: 'Edited title',
  amountCents: 4250,
  currency: 'USD',
  supplierId: A.suppliers[1],
  category: 'software',
  description: 'Edited description',
};

async function patch(userId: string | undefined, id: string, body: unknown) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (userId) headers['X-User-Id'] = userId;
  const res = await fetch(`${url}/purchase-requests/${id}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(body),
  });
  return { status: res.status, text: await res.text() };
}

async function post(userId: string, path: string, body?: unknown) {
  return fetch(`${url}/purchase-requests${path}`, {
    method: 'POST',
    headers: { 'X-User-Id': userId, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function createAs(userId: string, supplierId = A.suppliers[0]): Promise<PurchaseRequest> {
  const res = await post(userId, '', {
    title: 'Edit test',
    amountCents: 1000,
    supplierId,
    category: 'other',
  });
  expect(res.status).toBe(201);
  return purchaseRequestSchema.parse(await res.json());
}

async function ownerRow(id: string) {
  const { rows } = await owner.query(
    `select title, amount_cents, currency, supplier_id, category, description, status,
            requester_id, tenant_id, created_at, updated_at
       from purchase_requests where id = $1`,
    [id],
  );
  return rows[0];
}

const NOT_FOUND = { message: 'Not Found', statusCode: 404 };

describe('PATCH /purchase-requests/:id, happy path (criteria 1 and 2)', () => {
  it('replaces all six fields of the own draft and keeps the rest', async () => {
    const draft = await createAs(A.requester);
    const res = await patch(A.requester, draft.id, NEW_VALUES);
    expect(res.status).toBe(200);
    const edited = purchaseRequestSchema.parse(JSON.parse(res.text));
    expect(edited).toMatchObject({
      id: draft.id,
      title: 'Edited title',
      amountCents: 4250,
      currency: 'USD',
      category: 'software',
      description: 'Edited description',
      status: 'draft',
      requester: draft.requester,
      createdAt: draft.createdAt,
    });
    expect(edited.supplier.id).toBe(A.suppliers[1]);
    expect(Date.parse(edited.updatedAt)).toBeGreaterThanOrEqual(Date.parse(draft.updatedAt));

    const { rows } = await owner.query(
      'select updated_at > created_at as later from purchase_requests where id = $1',
      [draft.id],
    );
    expect(rows).toEqual([{ later: true }]);

    const mine = await fetch(`${url}/purchase-requests/mine`, {
      headers: { 'X-User-Id': A.requester },
    });
    const list = (await mine.json()) as PurchaseRequest[];
    expect(list.find((r) => r.id === draft.id)).toMatchObject({ title: 'Edited title' });
  });

  it('defaults the currency to EUR and the description to empty when left out', async () => {
    const draft = await createAs(A.requester);
    const { currency, description, ...rest } = NEW_VALUES;
    void currency;
    void description;
    const res = await patch(A.requester, draft.id, rest);
    expect(res.status).toBe(200);
    expect(purchaseRequestSchema.parse(JSON.parse(res.text))).toMatchObject({
      currency: 'EUR',
      description: '',
    });
  });

  it('lets an approver edit their own draft', async () => {
    const draft = await createAs(A.approver);
    expect((await patch(A.approver, draft.id, NEW_VALUES)).status).toBe(200);
  });
});

describe('PATCH /purchase-requests/:id, what the caller may not see: 404 (criterion 3)', () => {
  it('answers the same 404 for every id the caller may not edit', async () => {
    const amirsDraft = await createAs(A.approver);
    const alicesDraft = await createAs(A.requester);
    const amirsBefore = await ownerRow(amirsDraft.id);
    const alicesBefore = await ownerRow(alicesDraft.id);
    const globexBefore = await ownerRow(B.purchaseRequests[0]);

    const answers = [
      await patch(A.requester, 'not-a-uuid', NEW_VALUES),
      await patch(A.requester, UNKNOWN, NEW_VALUES),
      await patch(A.requester, B.purchaseRequests[0], NEW_VALUES),
      await patch(A.requester, amirsDraft.id, NEW_VALUES),
      await patch(A.approver, alicesDraft.id, NEW_VALUES),
      await patch(B.requester, alicesDraft.id, NEW_VALUES),
    ];
    for (const res of answers) {
      expect(res.status).toBe(404);
      expect(apiErrorSchema.parse(JSON.parse(res.text))).toEqual(NOT_FOUND);
    }
    expect(new Set(answers.map((res) => res.text)).size).toBe(1);

    expect(await ownerRow(amirsDraft.id)).toEqual(amirsBefore);
    expect(await ownerRow(alicesDraft.id)).toEqual(alicesBefore);
    expect(await ownerRow(B.purchaseRequests[0])).toEqual(globexBefore);
  });
});

describe('PATCH /purchase-requests/:id, not a draft: 409 (criterion 4)', () => {
  it('answers 409 for a submitted and an approved request and changes nothing', async () => {
    for (const id of [A.purchaseRequests[1], A.purchaseRequests[2]]) {
      const before = await ownerRow(id);
      const res = await patch(A.requester, id, NEW_VALUES);
      expect(res.status).toBe(409);
      expect(apiErrorSchema.parse(JSON.parse(res.text)).statusCode).toBe(409);
      expect(await ownerRow(id)).toEqual(before);
    }
  });

  it('answers 409 for a draft after it was submitted', async () => {
    const draft = await createAs(A.requester);
    expect((await post(A.requester, `/${draft.id}/submit`)).status).toBe(200);
    const before = await ownerRow(draft.id);
    expect((await patch(A.requester, draft.id, NEW_VALUES)).status).toBe(409);
    expect(await ownerRow(draft.id)).toEqual(before);
  });
});

describe('PATCH /purchase-requests/:id, invalid bodies: 400 (criterion 5)', () => {
  it.each([
    ['an empty title', { title: '   ' }],
    ['a title over 200 characters', { title: 'x'.repeat(201) }],
    ['a negative amount', { amountCents: -1 }],
    ['a fractional amount', { amountCents: 10.5 }],
    ['a lowercase currency', { currency: 'eur' }],
    ['a supplier id that is no UUID', { supplierId: 'not-a-uuid' }],
    ['a category outside the list', { category: 'furniture' }],
    ['a description over 2000 characters', { description: 'x'.repeat(2001) }],
    ['a status', { status: 'approved' }],
    ['an id', { id: UNKNOWN }],
    ['a tenantId', { tenantId: B.tenant }],
    ['a requesterId', { requesterId: A.approver }],
  ])('answers 400 for %s and changes nothing', async (_what, change) => {
    const draft = await createAs(A.requester);
    const before = await ownerRow(draft.id);
    const res = await patch(A.requester, draft.id, { ...NEW_VALUES, ...change });
    expect(res.status).toBe(400);
    expect(JSON.parse(res.text).issues).toBeInstanceOf(Array);
    expect(await ownerRow(draft.id)).toEqual(before);
  });
});

describe('PATCH /purchase-requests/:id, another company’s supplier (criterion 6)', () => {
  it('answers 404 and leaves the draft unchanged', async () => {
    const draft = await createAs(A.requester);
    const before = await ownerRow(draft.id);
    const res = await patch(A.requester, draft.id, { ...NEW_VALUES, supplierId: B.suppliers[0] });
    expect(res.status).toBe(404);
    expect(await ownerRow(draft.id)).toEqual(before);
  });
});

describe('PATCH /purchase-requests/:id, no caller (criterion 7)', () => {
  it('answers 401 without X-User-Id', async () => {
    const res = await patch(undefined, A.purchaseRequests[0], NEW_VALUES);
    expect(res.status).toBe(401);
    expect(JSON.parse(res.text)).toEqual({ message: 'Unauthorized', statusCode: 401 });
  });
});

describe('the seed (criterion 8)', () => {
  it('left the seeded requests unchanged', async () => {
    expect(await seededRequestsSnapshot(owner)).toEqual(seeded);
  });
});
