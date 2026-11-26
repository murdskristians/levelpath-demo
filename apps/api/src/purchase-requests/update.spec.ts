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

// PATCH /purchase-requests/:id over real HTTP against this run's database: the caller's
// own draft gets the six create fields replaced. Anything the caller may not see is the
// same 404; a request that isn't a draft is a 409; a refused edit writes nothing.

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

const NEW_VALUES = {
  title: 'New title',
  amountCents: 2500,
  currency: 'USD',
  supplierId: A.suppliers[1],
  category: 'software',
  description: 'fixed',
};

async function edit(userId: string | undefined, id: string, body: unknown) {
  const res = await fetch(`${url}/purchase-requests/${id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...(userId ? { 'X-User-Id': userId } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, text: await res.text() };
}

async function createAs(userId: string, supplierId: string = A.suppliers[0]) {
  const res = await fetch(`${url}/purchase-requests`, {
    method: 'POST',
    headers: { 'X-User-Id': userId, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'Edit test',
      amountCents: 1000,
      supplierId,
      category: 'other',
      description: 'original',
    }),
  });
  expect(res.status).toBe(201);
  return purchaseRequestSchema.parse(await res.json());
}

/** Every column an edit could touch, as the owner sees it. */
async function ownerRow(id: string) {
  const { rows } = await owner.query(
    `select tenant_id, requester_id, supplier_id, title, amount_cents, currency, category,
            description, status, created_at, updated_at
     from purchase_requests where id = $1`,
    [id],
  );
  return rows[0];
}

describe('PATCH /purchase-requests/:id, happy path (criteria 1 and 2)', () => {
  it("replaces the six fields of the caller's own draft and keeps it a draft", async () => {
    const draft = await createAs(A.requester);
    const res = await edit(A.requester, draft.id, NEW_VALUES);
    expect(res.status).toBe(200);
    const edited: PurchaseRequest = purchaseRequestSchema.parse(JSON.parse(res.text));
    expect(edited).toMatchObject({
      id: draft.id,
      title: 'New title',
      amountCents: 2500,
      currency: 'USD',
      category: 'software',
      description: 'fixed',
      status: 'draft',
      supplier: { id: A.suppliers[1] },
      requester: draft.requester,
      createdAt: draft.createdAt,
    });
    expect(edited.updatedAt > draft.updatedAt).toBe(true);

    const mine = await fetch(`${url}/purchase-requests/mine`, {
      headers: { 'X-User-Id': A.requester },
    });
    const listed = purchaseRequestSchema.array().parse(await mine.json());
    expect(listed.find((r) => r.id === draft.id)).toEqual(edited);
  });

  it('stores create’s defaults when currency and description are left out', async () => {
    const draft = await createAs(A.requester);
    const bare = {
      title: NEW_VALUES.title,
      amountCents: NEW_VALUES.amountCents,
      supplierId: NEW_VALUES.supplierId,
      category: NEW_VALUES.category,
    };
    const res = await edit(A.requester, draft.id, bare);
    expect(res.status).toBe(200);
    expect(purchaseRequestSchema.parse(JSON.parse(res.text))).toMatchObject({
      currency: 'EUR',
      description: '',
    });
  });
});

describe('PATCH /purchase-requests/:id, what the caller may not see: 404 (criteria 3 and 8)', () => {
  it('answers the same 404 for another requester, an approver, Globex, an unknown id and a non-UUID', async () => {
    const alices = await createAs(A.requester);
    const amirs = await createAs(A.approver);
    const before = {
      alices: await ownerRow(alices.id),
      amirs: await ownerRow(amirs.id),
      globex: await ownerRow(B.purchaseRequests[0]),
    };

    const answers = [
      await edit(A.approver, alices.id, NEW_VALUES),
      await edit(A.requester, amirs.id, NEW_VALUES),
      await edit(A.requester, B.purchaseRequests[0], NEW_VALUES),
      await edit(A.requester, UNKNOWN, NEW_VALUES),
      await edit(A.requester, 'not-a-uuid', NEW_VALUES),
    ];
    for (const res of answers) {
      expect(res.status).toBe(404);
      expect(apiErrorSchema.parse(JSON.parse(res.text))).toEqual(NOT_FOUND);
    }
    expect(new Set(answers.map((res) => res.text)).size).toBe(1);

    expect(await ownerRow(alices.id)).toEqual(before.alices);
    expect(await ownerRow(amirs.id)).toEqual(before.amirs);
    expect(await ownerRow(B.purchaseRequests[0])).toEqual(before.globex);
  });

  it('answers the same 404 to a Globex requester sending an Acme draft id, and leaves the row alone', async () => {
    const draft = await createAs(A.requester);
    const before = await ownerRow(draft.id);
    const res = await edit(B.requester, draft.id, { ...NEW_VALUES, supplierId: B.suppliers[0] });
    expect(res.status).toBe(404);
    expect(JSON.parse(res.text)).toEqual(NOT_FOUND);
    expect(await ownerRow(draft.id)).toEqual(before);
  });
});

describe('PATCH /purchase-requests/:id, not a draft: 409 (criterion 4)', () => {
  it('answers 409 for a submitted and an approved request, and changes nothing', async () => {
    for (const id of [A.purchaseRequests[1], A.purchaseRequests[2]]) {
      const before = await ownerRow(id);
      const res = await edit(A.requester, id, NEW_VALUES);
      expect(res.status).toBe(409);
      expect(apiErrorSchema.parse(JSON.parse(res.text)).statusCode).toBe(409);
      expect(await ownerRow(id)).toEqual(before);
    }
  });
});

describe('PATCH /purchase-requests/:id, invalid bodies: 400 (criterion 5)', () => {
  it.each([
    ['an empty title', { title: '' }],
    ['a negative amount', { amountCents: -1 }],
    ['a lower-case currency', { currency: 'eur' }],
    ['a non-UUID supplier', { supplierId: 'nope' }],
    ['an unknown category', { category: 'yachts' }],
    ['a status', { status: 'submitted' }],
    ['an id', { id: UNKNOWN }],
    ['a tenantId', { tenantId: B.tenant }],
    ['a requesterId', { requesterId: A.approver }],
  ])('answers 400 for %s and changes nothing', async (_name, change) => {
    const draft = await createAs(A.requester);
    const before = await ownerRow(draft.id);
    const res = await edit(A.requester, draft.id, { ...NEW_VALUES, ...change });
    expect(res.status).toBe(400);
    expect(apiErrorSchema.parse(JSON.parse(res.text)).issues?.length).toBeGreaterThan(0);
    expect(await ownerRow(draft.id)).toEqual(before);
  });
});

describe('PATCH /purchase-requests/:id, an unknown or other-company supplier: 404 (criterion 6)', () => {
  it.each([
    ['a Globex supplier', B.suppliers[0]],
    ['an unknown supplier', UNKNOWN],
  ])('answers 404 for %s and changes nothing', async (_name, supplierId) => {
    const draft = await createAs(A.requester);
    const before = await ownerRow(draft.id);
    const res = await edit(A.requester, draft.id, { ...NEW_VALUES, supplierId });
    expect(res.status).toBe(404);
    expect(await ownerRow(draft.id)).toEqual(before);
  });
});

describe('PATCH /purchase-requests/:id, no caller (criterion 7)', () => {
  it('answers 401 without X-User-Id', async () => {
    const res = await edit(undefined, A.purchaseRequests[0], NEW_VALUES);
    expect(res.status).toBe(401);
    expect(JSON.parse(res.text)).toEqual({ message: 'Unauthorized', statusCode: 401 });
  });
});

describe('the seed (criterion 8)', () => {
  it('left the seeded requests unchanged', async () => {
    expect(await seededRequestsSnapshot(owner)).toEqual(seeded);
  });
});
