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
// own draft gets new field values and stays a draft. Anything the caller may not see is
// the same 404; a request that isn't a draft is a 409; a bad body is a 400.

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
  amountCents: 4200,
  currency: 'USD',
  supplierId: A.suppliers[1],
  category: 'software',
  description: 'Edited description',
};

function headers(userId: string | undefined): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (userId) h['X-User-Id'] = userId;
  return h;
}

async function put(userId: string | undefined, id: string, body: unknown) {
  const res = await fetch(`${url}/purchase-requests/${id}`, {
    method: 'PUT',
    headers: headers(userId),
    body: JSON.stringify(body),
  });
  return { status: res.status, text: await res.text() };
}

async function post(userId: string, path: string, body?: unknown) {
  const res = await fetch(`${url}/purchase-requests${path}`, {
    method: 'POST',
    headers: headers(userId),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, text: await res.text() };
}

async function createAs(userId: string): Promise<PurchaseRequest> {
  const res = await post(userId, '', {
    title: 'Edit test',
    amountCents: 1000,
    supplierId: A.suppliers[0],
    category: 'other',
  });
  expect(res.status).toBe(201);
  return purchaseRequestSchema.parse(JSON.parse(res.text));
}

async function ownerRow(id: string) {
  const { rows } = await owner.query('select * from purchase_requests where id = $1', [id]);
  return rows[0];
}

const NOT_FOUND = { message: 'Not Found', statusCode: 404 };

describe('PUT /purchase-requests/:id, happy path', () => {
  it("edits the caller's own draft and keeps it a draft", async () => {
    const draft = await createAs(A.requester);
    const res = await put(A.requester, draft.id, NEW_VALUES);
    expect(res.status).toBe(200);
    const edited = purchaseRequestSchema.parse(JSON.parse(res.text));
    expect(edited).toMatchObject({
      id: draft.id,
      status: 'draft',
      title: 'Edited title',
      amountCents: 4200,
      currency: 'USD',
      category: 'software',
      description: 'Edited description',
      createdAt: draft.createdAt,
    });
    expect(edited.supplier.id).toBe(A.suppliers[1]);
    expect(edited.requester).toEqual(draft.requester);
    expect(Date.parse(edited.updatedAt)).toBeGreaterThan(Date.parse(draft.updatedAt));

    const mine = await fetch(`${url}/purchase-requests/mine`, { headers: headers(A.requester) });
    const list = (await mine.json()) as PurchaseRequest[];
    expect(list.find((r) => r.id === draft.id)).toEqual(edited);
  });

  it('defaults the currency to EUR when it is left out', async () => {
    const draft = await createAs(A.requester);
    const withoutCurrency: Partial<typeof NEW_VALUES> = { ...NEW_VALUES };
    delete withoutCurrency.currency;
    const res = await put(A.requester, draft.id, withoutCurrency);
    expect(res.status).toBe(200);
    expect(purchaseRequestSchema.parse(JSON.parse(res.text)).currency).toBe('EUR');
  });
});

describe('PUT /purchase-requests/:id, what the caller may not see: 404', () => {
  it('answers 404 to a non-UUID and an unknown id', async () => {
    for (const id of ['not-a-uuid', UNKNOWN]) {
      const res = await put(A.requester, id, NEW_VALUES);
      expect(res.status).toBe(404);
      expect(apiErrorSchema.parse(JSON.parse(res.text))).toEqual(NOT_FOUND);
    }
  });

  it('answers 404 to an approver editing a requester’s draft, and changes nothing', async () => {
    const draft = await createAs(A.requester);
    const before = await ownerRow(draft.id);
    const res = await put(A.approver, draft.id, NEW_VALUES);
    expect(res.status).toBe(404);
    expect(JSON.parse(res.text)).toEqual(NOT_FOUND);
    expect(await ownerRow(draft.id)).toEqual(before);
  });

  it('answers 404 to another requester of the same company, and changes nothing', async () => {
    const draft = await createAs(A.approver);
    const before = await ownerRow(draft.id);
    const res = await put(A.requester, draft.id, NEW_VALUES);
    expect(res.status).toBe(404);
    expect(JSON.parse(res.text)).toEqual(NOT_FOUND);
    expect(await ownerRow(draft.id)).toEqual(before);
  });

  it('answers a Globex user the same 404 as for an unknown id, and changes nothing', async () => {
    const draft = await createAs(A.requester);
    const before = await ownerRow(draft.id);
    const crafted = await put(B.requester, draft.id, { ...NEW_VALUES, supplierId: B.suppliers[0] });
    const unknown = await put(B.requester, UNKNOWN, { ...NEW_VALUES, supplierId: B.suppliers[0] });
    expect(crafted.status).toBe(404);
    expect(crafted.text).toBe(unknown.text);
    expect(await ownerRow(draft.id)).toEqual(before);
  });
});

describe('PUT /purchase-requests/:id, not a draft: 409', () => {
  it('answers 409 for a submitted, an approved and a rejected request, and changes nothing', async () => {
    const submitted = await createAs(A.requester);
    expect((await post(A.requester, `/${submitted.id}/submit`)).status).toBe(200);
    const approved = await createAs(A.requester);
    const rejected = await createAs(A.requester);
    for (const [r, body] of [
      [approved, { decision: 'approved', comment: '' }],
      [rejected, { decision: 'rejected', comment: 'no' }],
    ] as const) {
      expect((await post(A.requester, `/${r.id}/submit`)).status).toBe(200);
      expect((await post(A.approver, `/${r.id}/decision`, body)).status).toBe(200);
    }

    for (const r of [submitted, approved, rejected]) {
      const before = await ownerRow(r.id);
      const res = await put(A.requester, r.id, NEW_VALUES);
      expect(res.status).toBe(409);
      expect(apiErrorSchema.parse(JSON.parse(res.text)).statusCode).toBe(409);
      expect(await ownerRow(r.id)).toEqual(before);
    }
  });
});

describe('PUT /purchase-requests/:id, invalid body: 400', () => {
  it('rejects bad fields and forbidden keys, and changes nothing', async () => {
    const draft = await createAs(A.requester);
    const before = await ownerRow(draft.id);
    const bad = [
      { ...NEW_VALUES, title: '' },
      { ...NEW_VALUES, amountCents: -1 },
      { ...NEW_VALUES, currency: 'euro' },
      { ...NEW_VALUES, category: 'yachts' },
      { ...NEW_VALUES, status: 'approved' },
      { ...NEW_VALUES, id: UNKNOWN },
      { ...NEW_VALUES, tenantId: B.tenant },
      { ...NEW_VALUES, requesterId: A.approver },
    ];
    for (const body of bad) {
      const res = await put(A.requester, draft.id, body);
      expect(res.status).toBe(400);
      expect(apiErrorSchema.parse(JSON.parse(res.text)).issues?.length).toBeGreaterThan(0);
    }
    expect(await ownerRow(draft.id)).toEqual(before);
  });
});

describe('PUT /purchase-requests/:id, supplier: 404', () => {
  it('answers 404 for another company’s and an unknown supplier, and changes nothing', async () => {
    const draft = await createAs(A.requester);
    const before = await ownerRow(draft.id);
    for (const supplierId of [B.suppliers[0], UNKNOWN]) {
      const res = await put(A.requester, draft.id, { ...NEW_VALUES, supplierId });
      expect(res.status).toBe(404);
      expect(JSON.parse(res.text)).toEqual(NOT_FOUND);
    }
    expect(await ownerRow(draft.id)).toEqual(before);
  });
});

describe('PUT /purchase-requests/:id, no caller', () => {
  it('answers 401 without X-User-Id', async () => {
    const res = await put(undefined, A.purchaseRequests[0], NEW_VALUES);
    expect(res.status).toBe(401);
    expect(JSON.parse(res.text)).toEqual({ message: 'Unauthorized', statusCode: 401 });
  });
});

describe('the seed', () => {
  it('left the seeded requests unchanged', async () => {
    expect(await seededRequestsSnapshot(owner)).toEqual(seeded);
  });
});
