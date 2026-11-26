import type { INestApplication } from '@nestjs/common';
import {
  apiErrorSchema,
  MAX_AMOUNT_CENTS,
  MAX_DESCRIPTION_LENGTH,
  type PurchaseRequest,
  purchaseRequestSchema,
} from '@levelpath/shared';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  deleteRowsTestsCreated,
  ownerClient,
  SEED,
  seededRequestsSnapshot,
  startApp,
} from '../../test/helpers.js';

// Edit a draft (spec criteria 2 to 10), over real HTTP against this run's database:
// PUT /purchase-requests/:id replaces the six fields of the caller's own draft. Anything
// else the caller may not see is the same 404; a request that isn't a draft is a 409; an
// invalid body is a 400 before any lookup. Every refusal leaves the row as it was.

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

async function put(userId: string | undefined, id: string, body?: unknown) {
  const headers: Record<string, string> = {};
  if (userId) headers['X-User-Id'] = userId;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${url}/purchase-requests/${id}`, {
    method: 'PUT',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, text: await res.text() };
}

async function createAs(
  userId: string,
  body: Record<string, unknown> = {
    title: 'Edit test',
    amountCents: 1000,
    supplierId: A.suppliers[0],
    category: 'other',
  },
): Promise<PurchaseRequest> {
  const res = await fetch(`${url}/purchase-requests`, {
    method: 'POST',
    headers: { 'X-User-Id': userId, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(201);
  return purchaseRequestSchema.parse(await res.json());
}

async function ownerRow(id: string) {
  const { rows } = await owner.query(
    `select status, title, amount_cents, currency, supplier_id, category, description, updated_at
       from purchase_requests where id = $1`,
    [id],
  );
  return rows[0];
}

const valid = {
  title: 'Edited',
  amountCents: 2000,
  supplierId: A.suppliers[1],
  category: 'hardware',
};
const NOT_FOUND = { message: 'Not Found', statusCode: 404 };

describe('PUT /purchase-requests/:id, happy path (criteria 2 to 4)', () => {
  it("replaces the fields of the caller's own draft, which stays a draft", async () => {
    const draft = await createAs(A.requester);
    const res = await put(A.requester, draft.id, {
      title: '  Ergonomic chairs  ',
      amountCents: 45000,
      currency: 'USD',
      supplierId: A.suppliers[1],
      category: 'office_supplies',
      description: '  For the support team  ',
    });
    expect(res.status).toBe(200);
    expect(purchaseRequestSchema.parse(JSON.parse(res.text))).toEqual({
      id: draft.id,
      title: 'Ergonomic chairs',
      amountCents: 45000,
      currency: 'USD',
      status: 'draft',
      category: 'office_supplies',
      description: 'For the support team',
      supplier: { id: A.suppliers[1], name: 'Nordic Laptops' },
      requester: { id: A.requester, name: 'Alice' },
      createdAt: draft.createdAt,
      updatedAt: expect.any(String),
      decision: null,
    });

    // Compared in SQL, at microsecond precision.
    const { rows } = await owner.query(
      `select status, title, amount_cents, currency, supplier_id, category, description,
              updated_at > created_at as later
         from purchase_requests where id = $1`,
      [draft.id],
    );
    expect(rows).toEqual([
      {
        status: 'draft',
        title: 'Ergonomic chairs',
        amount_cents: '45000',
        currency: 'USD',
        supplier_id: A.suppliers[1],
        category: 'office_supplies',
        description: 'For the support team',
        later: true,
      },
    ]);
  });

  it('gives a left-out field its default: a full replacement', async () => {
    const draft = await createAs(A.requester, {
      title: 'Edit test',
      amountCents: 1000,
      currency: 'USD',
      supplierId: A.suppliers[0],
      category: 'other',
      description: 'Something',
    });
    const res = await put(A.requester, draft.id, valid);
    expect(res.status).toBe(200);
    expect(purchaseRequestSchema.parse(JSON.parse(res.text))).toMatchObject({
      currency: 'EUR',
      description: '',
    });
    expect(await ownerRow(draft.id)).toMatchObject({ currency: 'EUR', description: '' });
  });

  it('lets an approver edit a draft they created', async () => {
    const draft = await createAs(A.approver);
    const res = await put(A.approver, draft.id, valid);
    expect(res.status).toBe(200);
    const edited = purchaseRequestSchema.parse(JSON.parse(res.text));
    expect(edited.status).toBe('draft');
    expect(edited.requester).toEqual({ id: A.approver, name: 'Amir' });
    expect(edited.title).toBe('Edited');
  });
});

describe('PUT /purchase-requests/:id, what the caller may not see: 404 (criteria 5 to 7)', () => {
  it('answers the same 404 for a non-UUID, an unknown id, a Globex draft and another requester’s draft', async () => {
    const amirsDraft = await createAs(A.approver);
    const globexBefore = await ownerRow(B.purchaseRequests[0]);
    const amirsBefore = await ownerRow(amirsDraft.id);

    const answers = [];
    for (const id of ['not-a-uuid', UNKNOWN, B.purchaseRequests[0], amirsDraft.id]) {
      answers.push(await put(A.requester, id, valid));
    }
    for (const res of answers) {
      expect(res.status).toBe(404);
      expect(apiErrorSchema.parse(JSON.parse(res.text))).toEqual(NOT_FOUND);
    }
    expect(new Set(answers.map((res) => res.text)).size).toBe(1);

    expect(await ownerRow(B.purchaseRequests[0])).toEqual(globexBefore);
    expect(await ownerRow(amirsDraft.id)).toEqual(amirsBefore);
  });

  it("answers 404 to Amir, Bella and Boris for Alice's draft", async () => {
    const draft = await createAs(A.requester);
    const before = await ownerRow(draft.id);
    const answers = [];
    for (const userId of [A.approver, B.requester, B.approver]) {
      answers.push(await put(userId, draft.id, valid));
    }
    for (const res of answers) {
      expect(res.status).toBe(404);
      expect(apiErrorSchema.parse(JSON.parse(res.text))).toEqual(NOT_FOUND);
    }
    expect(new Set(answers.map((res) => res.text)).size).toBe(1);
    expect(await ownerRow(draft.id)).toEqual(before);
  });

  it("answers the same 404 for Globex's supplier and for an unknown one", async () => {
    const draft = await createAs(A.requester);
    const before = await ownerRow(draft.id);
    const globex = await put(A.requester, draft.id, { ...valid, supplierId: B.suppliers[0] });
    const unknown = await put(A.requester, draft.id, { ...valid, supplierId: UNKNOWN });
    for (const res of [globex, unknown]) {
      expect(res.status).toBe(404);
      expect(apiErrorSchema.parse(JSON.parse(res.text))).toEqual(NOT_FOUND);
    }
    expect(globex.text).toBe(unknown.text);
    expect(await ownerRow(draft.id)).toEqual(before);
  });
});

describe('PUT /purchase-requests/:id, not a draft: 409 (criterion 8)', () => {
  it('answers 409 for a submitted, an approved and a rejected request', async () => {
    for (const id of [A.purchaseRequests[1], A.purchaseRequests[2], A.purchaseRequests[3]]) {
      const before = await ownerRow(id);
      const res = await put(A.requester, id, valid);
      expect(res.status).toBe(409);
      expect(apiErrorSchema.parse(JSON.parse(res.text)).statusCode).toBe(409);
      expect(await ownerRow(id)).toEqual(before);
    }
  });

  it('answers 409 for a draft that was submitted, and leaves it as submitted', async () => {
    const draft = await createAs(A.requester);
    const submitted = await fetch(`${url}/purchase-requests/${draft.id}/submit`, {
      method: 'POST',
      headers: { 'X-User-Id': A.requester },
    });
    expect(submitted.status).toBe(200);
    const before = await ownerRow(draft.id);
    expect(before.status).toBe('submitted');

    const res = await put(A.requester, draft.id, valid);
    expect(res.status).toBe(409);
    expect(apiErrorSchema.parse(JSON.parse(res.text)).statusCode).toBe(409);
    expect(await ownerRow(draft.id)).toEqual(before);
  });
});

describe('PUT /purchase-requests/:id, invalid body: 400 with issues (criterion 9)', () => {
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
    ['no category', { title: 'x', amountCents: 100, supplierId: A.suppliers[0] }, 'category'],
    ['a category not in the list', { ...valid, category: 'furniture' }, 'category'],
    [
      'a description over the cap',
      { ...valid, description: 'x'.repeat(MAX_DESCRIPTION_LENGTH + 1) },
      'description',
    ],
  ];

  it.each(cases)('rejects %s, and changes nothing', async (_name, body, path) => {
    const draft = await createAs(A.requester);
    const before = await ownerRow(draft.id);
    const res = await put(A.requester, draft.id, body);
    expect(res.status).toBe(400);
    const error = apiErrorSchema.parse(JSON.parse(res.text));
    expect(error.statusCode).toBe(400);
    expect(error.message).not.toBe('');
    expect(error.issues?.length).toBeGreaterThan(0);
    if (path !== undefined) expect(error.issues?.map((i) => i.path)).toContain(path);
    expect(await ownerRow(draft.id)).toEqual(before);
  });

  it("answers the same 400 on another tenant's id as on the caller's own draft", async () => {
    const draft = await createAs(A.requester);
    const own = await put(A.requester, draft.id, { ...valid, title: '' });
    const globex = await put(A.requester, B.purchaseRequests[0], { ...valid, title: '' });
    expect(own.status).toBe(400);
    expect(globex.status).toBe(400);
    expect(globex.text).toBe(own.text);
  });
});

describe('PUT /purchase-requests/:id, no caller (criterion 10)', () => {
  it('answers 401 without X-User-Id, and changes nothing', async () => {
    const draft = await createAs(A.requester);
    const before = await ownerRow(draft.id);
    const res = await put(undefined, draft.id, valid);
    expect(res.status).toBe(401);
    expect(JSON.parse(res.text)).toEqual({ message: 'Unauthorized', statusCode: 401 });
    expect(await ownerRow(draft.id)).toEqual(before);
  });
});

describe('the seed (criterion 10)', () => {
  it('left the seeded requests unchanged', async () => {
    expect(await seededRequestsSnapshot(owner)).toEqual(seeded);
  });
});
