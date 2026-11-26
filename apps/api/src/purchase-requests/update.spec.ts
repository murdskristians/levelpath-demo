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

// Issue #32, spec criteria 1 to 8, over real HTTP against this run's database: PUT
// /purchase-requests/:id replaces the six fields of the caller's own draft. Anything the
// caller may not see is the same 404; a request that isn't a draft is a 409; a refused
// edit writes nothing. Every successful edit is on a draft this file created.

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

/** Every field an edit could touch, read as the owner, so "unchanged" means all of them. */
async function ownerRow(id: string) {
  const { rows } = await owner.query(
    `select title, amount_cents, currency, supplier_id, category, description, status, updated_at
       from purchase_requests where id = $1`,
    [id],
  );
  return rows[0];
}

const valid = {
  title: 'Desks',
  amountCents: 25000,
  currency: 'USD',
  supplierId: A.suppliers[1],
  category: 'office_supplies',
  description: 'For room 2',
};

describe('PUT /purchase-requests/:id, happy path (criterion 1)', () => {
  it("replaces the fields of the caller's own draft, which stays a draft", async () => {
    const draft = await createAs(A.requester);
    const res = await put(A.requester, draft.id, { ...valid, title: '  Desks  ' });
    expect(res.status).toBe(200);
    const edited = purchaseRequestSchema.parse(JSON.parse(res.text));
    expect(edited).toEqual({
      id: draft.id,
      title: 'Desks',
      amountCents: 25000,
      currency: 'USD',
      status: 'draft',
      category: 'office_supplies',
      description: 'For room 2',
      supplier: { id: A.suppliers[1], name: 'Nordic Laptops' },
      requester: { id: A.requester, name: 'Alice' },
      createdAt: draft.createdAt,
      updatedAt: expect.any(String),
      decision: null,
    });

    // Compared in SQL, at microsecond precision.
    const { rows } = await owner.query(
      `select tenant_id, requester_id, title, amount_cents, currency, supplier_id, category,
              description, status, updated_at > created_at as later
         from purchase_requests where id = $1`,
      [draft.id],
    );
    expect(rows).toEqual([
      {
        tenant_id: A.tenant,
        requester_id: A.requester,
        title: 'Desks',
        amount_cents: '25000',
        currency: 'USD',
        supplier_id: A.suppliers[1],
        category: 'office_supplies',
        description: 'For room 2',
        status: 'draft',
        later: true,
      },
    ]);

    const mine = await fetch(`${url}/purchase-requests/mine`, {
      headers: { 'X-User-Id': A.requester },
    });
    const listed = (await mine.json()) as PurchaseRequest[];
    expect(listed.find((r) => r.id === draft.id)).toEqual(edited);
  });

  it('gives a left-out currency and description their defaults, as create does (criterion 2)', async () => {
    const draft = await createAs(A.requester);
    expect((await put(A.requester, draft.id, valid)).status).toBe(200);
    const res = await put(A.requester, draft.id, {
      title: 'Desks',
      amountCents: 25000,
      supplierId: A.suppliers[1],
      category: 'office_supplies',
    });
    expect(res.status).toBe(200);
    expect(purchaseRequestSchema.parse(JSON.parse(res.text))).toMatchObject({
      currency: 'EUR',
      description: '',
    });
  });

  it('lets an approver edit a draft he created himself', async () => {
    const draft = await createAs(A.approver);
    const res = await put(A.approver, draft.id, valid);
    expect(res.status).toBe(200);
    expect(purchaseRequestSchema.parse(JSON.parse(res.text)).requester).toEqual({
      id: A.approver,
      name: 'Amir',
    });
  });
});

describe('PUT /purchase-requests/:id, what the caller may not see: one 404 (criterion 3)', () => {
  it('answers the same 404 to every caller but the creator, and changes no row', async () => {
    const alicesDraft = await createAs(A.requester);
    const amirsDraft = await createAs(A.approver);
    const targets = [alicesDraft.id, amirsDraft.id, B.purchaseRequests[0]];
    const rowsOf = async () => {
      const rows = [];
      for (const id of targets) rows.push(await ownerRow(id));
      return rows;
    };
    const before = await rowsOf();

    const answers = [
      await put(A.approver, alicesDraft.id, valid), // an approver of the same company
      await put(A.requester, amirsDraft.id, valid), // another user of the same company
      await put(B.requester, alicesDraft.id, valid), // another company
      await put(A.requester, B.purchaseRequests[0], valid), // a crafted id from another tenant
      await put(A.requester, UNKNOWN, valid),
      await put(A.requester, 'not-a-uuid', valid),
    ];
    for (const res of answers) {
      expect(res.status).toBe(404);
      expect(apiErrorSchema.parse(JSON.parse(res.text))).toEqual(NOT_FOUND);
    }
    expect(new Set(answers.map((res) => res.text)).size).toBe(1);

    expect(await rowsOf()).toEqual(before);
  });
});

describe('PUT /purchase-requests/:id, not a draft: 409 (criterion 4)', () => {
  it('answers 409 for a submitted, an approved and a rejected request', async () => {
    for (const id of [A.purchaseRequests[1], A.purchaseRequests[2], A.purchaseRequests[3]]) {
      const before = await ownerRow(id);
      const res = await put(A.requester, id, valid);
      expect(res.status).toBe(409);
      expect(apiErrorSchema.parse(JSON.parse(res.text)).message).toBe('only a draft can be edited');
      expect(await ownerRow(id)).toEqual(before);
    }
  });

  it('answers 409 for a draft once it is submitted, and leaves it as submitted', async () => {
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
    expect(apiErrorSchema.parse(JSON.parse(res.text)).message).toBe('only a draft can be edited');
    expect(await ownerRow(draft.id)).toEqual(before);
  });
});

describe('PUT /purchase-requests/:id, invalid body: 400 with issues (criterion 5)', () => {
  let draft: PurchaseRequest;
  beforeAll(async () => {
    draft = await createAs(A.requester);
  });

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
    ['no category', { ...valid, category: undefined }, 'category'],
    ['a category not in the list', { ...valid, category: 'furniture' }, 'category'],
    [
      'a description over the cap',
      { ...valid, description: 'x'.repeat(MAX_DESCRIPTION_LENGTH + 1) },
      'description',
    ],
  ];

  it.each(cases)('rejects %s, and changes nothing', async (_name, body, path) => {
    const before = await ownerRow(draft.id);
    const res = await put(A.requester, draft.id, body);
    expect(res.status).toBe(400);
    const error = apiErrorSchema.parse(JSON.parse(res.text));
    expect(error.statusCode).toBe(400);
    expect(error.issues?.length).toBeGreaterThan(0);
    if (path !== undefined) expect(error.issues?.map((i) => i.path)).toContain(path);
    expect(await ownerRow(draft.id)).toEqual(before);
  });
});

describe('PUT /purchase-requests/:id, a supplier the company lacks: 404 (criterion 6)', () => {
  it("answers 404 for Globex's supplier and for an unknown one, the same way", async () => {
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

describe('PUT /purchase-requests/:id, no caller (criterion 7)', () => {
  it('answers 401 without X-User-Id, and changes nothing', async () => {
    const draft = await createAs(A.requester);
    const before = await ownerRow(draft.id);
    const res = await put(undefined, draft.id, valid);
    expect(res.status).toBe(401);
    expect(JSON.parse(res.text)).toEqual({ message: 'Unauthorized', statusCode: 401 });
    expect(await ownerRow(draft.id)).toEqual(before);
  });
});

describe('the seed (criterion 8)', () => {
  it('left the seeded requests unchanged', async () => {
    expect(await seededRequestsSnapshot(owner)).toEqual(seeded);
  });
});
