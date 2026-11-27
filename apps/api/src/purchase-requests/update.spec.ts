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
// own draft gets new field values. Anything the caller may not see is the same 404;
// a request that isn't a draft is a 409; a refused edit changes nothing.

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

const NEW_BODY = {
  title: 'Edited title',
  amountCents: 4321,
  currency: 'USD',
  supplierId: A.suppliers[1],
  category: 'software',
  description: 'Edited description',
};

async function put(userId: string | undefined, id: string, body: unknown) {
  const res = await fetch(`${url}/purchase-requests/${id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...(userId ? { 'X-User-Id': userId } : {}),
    },
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
      supplierId: A.suppliers[0],
      category: 'other',
      description: 'Before',
    }),
  });
  expect(res.status).toBe(201);
  return purchaseRequestSchema.parse(await res.json());
}

async function ownerRow(id: string) {
  const { rows } = await owner.query('select * from purchase_requests where id = $1', [id]);
  return rows[0];
}

const NOT_FOUND = { message: 'Not Found', statusCode: 404 };

describe('PUT /purchase-requests/:id, happy path (criteria 1, 2, 10)', () => {
  it('replaces every field of the caller’s own draft', async () => {
    const draft = await createAs(A.requester);
    const before = await ownerRow(draft.id);
    const res = await put(A.requester, draft.id, NEW_BODY);
    expect(res.status).toBe(200);
    const edited = purchaseRequestSchema.parse(JSON.parse(res.text));
    expect(edited).toMatchObject({
      id: draft.id,
      status: 'draft',
      title: 'Edited title',
      amountCents: 4321,
      currency: 'USD',
      category: 'software',
      description: 'Edited description',
      supplier: { id: A.suppliers[1] },
    });
    expect(new Date(edited.updatedAt).getTime()).toBeGreaterThan(
      new Date(draft.updatedAt).getTime(),
    );

    const after = await ownerRow(draft.id);
    expect(after.tenant_id).toBe(before.tenant_id);
    expect(after.requester_id).toBe(before.requester_id);
    expect(after.created_at).toEqual(before.created_at);

    const mine = await fetch(`${url}/purchase-requests/mine`, {
      headers: { 'X-User-Id': A.requester },
    });
    const list = (await mine.json()) as PurchaseRequest[];
    expect(list.find((r) => r.id === draft.id)?.title).toBe('Edited title');
  });

  it('defaults the description and the currency, as create does', async () => {
    const draft = await createAs(A.requester);
    const res = await put(A.requester, draft.id, {
      title: NEW_BODY.title,
      amountCents: NEW_BODY.amountCents,
      supplierId: NEW_BODY.supplierId,
      category: NEW_BODY.category,
    });
    expect(res.status).toBe(200);
    const edited = purchaseRequestSchema.parse(JSON.parse(res.text));
    expect(edited.description).toBe('');
    expect(edited.currency).toBe('EUR');
  });
});

describe('PUT /purchase-requests/:id, what the caller may not see: 404 (criteria 3, 4, 5)', () => {
  it('answers 404 to another requester and to an approver, and changes nothing', async () => {
    const draft = await createAs(A.requester);
    const before = await ownerRow(draft.id);
    for (const user of [A.approver, B.requester]) {
      const res = await put(user, draft.id, NEW_BODY);
      expect(res.status).toBe(404);
      expect(JSON.parse(res.text)).toEqual(NOT_FOUND);
    }
    expect(await ownerRow(draft.id)).toEqual(before);
  });

  it('answers the same 404 for a Globex caller with a real id, an unknown id and a non-UUID', async () => {
    const draft = await createAs(A.requester);
    const before = await ownerRow(draft.id);
    const globexBody = { ...NEW_BODY, supplierId: B.suppliers[0] };
    const answers = [];
    for (const id of [draft.id, UNKNOWN, 'not-a-uuid']) {
      answers.push(await put(B.requester, id, globexBody));
    }
    for (const res of answers) {
      expect(res.status).toBe(404);
      expect(apiErrorSchema.parse(JSON.parse(res.text))).toEqual(NOT_FOUND);
    }
    expect(new Set(answers.map((res) => res.text)).size).toBe(1);
    expect(await ownerRow(draft.id)).toEqual(before);
  });
});

describe('PUT /purchase-requests/:id, not a draft: 409 (criterion 6)', () => {
  it.each(['submitted', 'approved', 'rejected'])('answers 409 for a %s request', async (status) => {
    const draft = await createAs(A.requester);
    await owner.query('update purchase_requests set status = $2 where id = $1', [draft.id, status]);
    const before = await ownerRow(draft.id);
    const res = await put(A.requester, draft.id, NEW_BODY);
    expect(res.status).toBe(409);
    expect(apiErrorSchema.parse(JSON.parse(res.text)).statusCode).toBe(409);
    expect(await ownerRow(draft.id)).toEqual(before);
  });
});

describe('PUT /purchase-requests/:id, invalid bodies: 400 (criterion 7)', () => {
  it.each([
    ['an empty title', { ...NEW_BODY, title: '  ' }],
    ['a negative amount', { ...NEW_BODY, amountCents: -1 }],
    ['a bad currency', { ...NEW_BODY, currency: 'euro' }],
    ['a bad category', { ...NEW_BODY, category: 'furniture' }],
    ['a bad supplier id', { ...NEW_BODY, supplierId: 'nope' }],
    ['a status', { ...NEW_BODY, status: 'approved' }],
    ['an id', { ...NEW_BODY, id: UNKNOWN }],
    ['a tenantId', { ...NEW_BODY, tenantId: B.tenant }],
  ])('answers 400 for %s', async (_what, body) => {
    const draft = await createAs(A.requester);
    const before = await ownerRow(draft.id);
    const res = await put(A.requester, draft.id, body);
    expect(res.status).toBe(400);
    expect(await ownerRow(draft.id)).toEqual(before);
  });
});

describe('PUT /purchase-requests/:id, supplier (criterion 8)', () => {
  it('answers 404 for a Globex supplier and changes nothing', async () => {
    const draft = await createAs(A.requester);
    const before = await ownerRow(draft.id);
    const res = await put(A.requester, draft.id, { ...NEW_BODY, supplierId: B.suppliers[0] });
    expect(res.status).toBe(404);
    expect(JSON.parse(res.text)).toEqual(NOT_FOUND);
    expect(await ownerRow(draft.id)).toEqual(before);
  });
});

describe('PUT /purchase-requests/:id, no caller (criterion 9)', () => {
  it('answers 401 without X-User-Id', async () => {
    const res = await put(undefined, A.purchaseRequests[0], NEW_BODY);
    expect(res.status).toBe(401);
    expect(JSON.parse(res.text)).toEqual({ message: 'Unauthorized', statusCode: 401 });
  });
});

describe('the seed', () => {
  it('left the seeded requests unchanged', async () => {
    expect(await seededRequestsSnapshot(owner)).toEqual(seeded);
  });
});
