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

// PUT /purchase-requests/:id over real HTTP against this run's database: the requester
// replaces the fields of their own draft. Anything else the caller may not edit is the
// same 404; a request that isn't a draft is a 409; a refused edit changes nothing.

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
  supplierId: A.suppliers[1] ?? A.suppliers[0],
  category: 'hardware',
  description: 'Edited description',
};

async function edit(userId: string | undefined, id: string, body: unknown = NEW_VALUES) {
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

async function post(userId: string, path: string, body?: unknown) {
  return fetch(`${url}${path}`, {
    method: 'POST',
    headers: { 'X-User-Id': userId, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function createAs(userId: string): Promise<PurchaseRequest> {
  const res = await post(userId, '/purchase-requests', {
    title: 'Edit test',
    amountCents: 1000,
    supplierId: A.suppliers[0],
    category: 'other',
    description: 'original',
  });
  expect(res.status).toBe(201);
  return purchaseRequestSchema.parse(await res.json());
}

async function ownerRow(id: string) {
  const { rows } = await owner.query(
    `select title, amount_cents::text, currency, supplier_id, category, description, status,
            requester_id, tenant_id, created_at, updated_at
     from purchase_requests where id = $1`,
    [id],
  );
  return rows[0];
}

const NOT_FOUND = { message: 'Not Found', statusCode: 404 };

describe('PUT /purchase-requests/:id, happy path', () => {
  it("replaces the fields of the caller's own draft", async () => {
    const draft = await createAs(A.requester);
    const res = await edit(A.requester, draft.id);
    expect(res.status).toBe(200);
    const updated = purchaseRequestSchema.parse(JSON.parse(res.text));
    expect(updated).toMatchObject({
      id: draft.id,
      title: 'Edited title',
      amountCents: 4200,
      currency: 'USD',
      category: 'hardware',
      description: 'Edited description',
      status: 'draft',
      createdAt: draft.createdAt,
    });
    expect(updated.supplier.id).toBe(NEW_VALUES.supplierId);
    expect(updated.requester.id).toBe(A.requester);

    const { rows } = await owner.query(
      'select status, updated_at > created_at as later from purchase_requests where id = $1',
      [draft.id],
    );
    expect(rows).toEqual([{ status: 'draft', later: true }]);

    const mine = await fetch(`${url}/purchase-requests/mine`, {
      headers: { 'X-User-Id': A.requester },
    });
    const list = (await mine.json()) as PurchaseRequest[];
    expect(list.find((r) => r.id === draft.id)).toEqual(updated);
  });

  it('stores the defaults when currency and description are left out', async () => {
    const draft = await createAs(A.requester);
    const body = {
      title: NEW_VALUES.title,
      amountCents: NEW_VALUES.amountCents,
      supplierId: NEW_VALUES.supplierId,
      category: NEW_VALUES.category,
    };
    const res = await edit(A.requester, draft.id, body);
    expect(res.status).toBe(200);
    const updated = purchaseRequestSchema.parse(JSON.parse(res.text));
    expect(updated.currency).toBe('EUR');
    expect(updated.description).toBe('');
  });

  it('lets an approver edit their own draft', async () => {
    const draft = await createAs(A.approver);
    const res = await edit(A.approver, draft.id);
    expect(res.status).toBe(200);
    expect(purchaseRequestSchema.parse(JSON.parse(res.text)).title).toBe('Edited title');
  });
});

describe('PUT /purchase-requests/:id, what the caller may not edit: 404', () => {
  it('answers the same 404 and changes nothing', async () => {
    const alices = await createAs(A.requester);
    const amirs = await createAs(A.approver);
    const alicesBefore = await ownerRow(alices.id);
    const amirsBefore = await ownerRow(amirs.id);
    const globexBefore = await ownerRow(B.purchaseRequests[0]);

    const answers = [
      await edit(A.approver, alices.id),
      await edit(A.requester, amirs.id),
      await edit(B.requester, alices.id),
      await edit(A.requester, UNKNOWN),
      await edit(A.requester, 'not-a-uuid'),
    ];
    for (const res of answers) {
      expect(res.status).toBe(404);
      expect(apiErrorSchema.parse(JSON.parse(res.text))).toEqual(NOT_FOUND);
    }
    expect(new Set(answers.map((res) => res.text)).size).toBe(1);

    expect(await ownerRow(alices.id)).toEqual(alicesBefore);
    expect(await ownerRow(amirs.id)).toEqual(amirsBefore);
    expect(await ownerRow(B.purchaseRequests[0])).toEqual(globexBefore);
  });

  it('answers 404 for an unknown supplier and for another tenant’s supplier', async () => {
    const draft = await createAs(A.requester);
    const before = await ownerRow(draft.id);
    for (const supplierId of [UNKNOWN, B.suppliers[0]]) {
      const res = await edit(A.requester, draft.id, { ...NEW_VALUES, supplierId });
      expect(res.status).toBe(404);
      expect(JSON.parse(res.text)).toEqual(NOT_FOUND);
    }
    expect(await ownerRow(draft.id)).toEqual(before);
  });
});

describe('PUT /purchase-requests/:id, not a draft: 409', () => {
  it('answers 409 for a submitted and an approved request', async () => {
    for (const id of [A.purchaseRequests[1], A.purchaseRequests[2]]) {
      const before = await ownerRow(id);
      const res = await edit(A.requester, id);
      expect(res.status).toBe(409);
      expect(apiErrorSchema.parse(JSON.parse(res.text)).statusCode).toBe(409);
      expect(await ownerRow(id)).toEqual(before);
    }
  });

  it('answers 409 for a draft that was submitted', async () => {
    const draft = await createAs(A.requester);
    expect((await post(A.requester, `/purchase-requests/${draft.id}/submit`)).status).toBe(200);
    const before = await ownerRow(draft.id);
    expect((await edit(A.requester, draft.id)).status).toBe(409);
    expect(await ownerRow(draft.id)).toEqual(before);
  });
});

describe('PUT /purchase-requests/:id, invalid bodies: 400', () => {
  const invalid: Record<string, Record<string, unknown>> = {
    'empty title': { title: '' },
    'negative amount': { amountCents: -1 },
    'amount over the maximum': { amountCents: 100_000_000_01 },
    'lowercase currency': { currency: 'eur' },
    'unknown category': { category: 'nope' },
    'non-UUID supplier': { supplierId: 'x' },
    'extra status': { status: 'approved' },
    'extra id': { id: UNKNOWN },
    'extra tenantId': { tenantId: B.tenant },
    'extra requesterId': { requesterId: A.approver },
  };
  it.each(Object.entries(invalid))('rejects %s and changes nothing', async (_name, patch) => {
    const draft = await createAs(A.requester);
    const before = await ownerRow(draft.id);
    const res = await edit(A.requester, draft.id, { ...NEW_VALUES, ...patch });
    expect(res.status).toBe(400);
    expect(apiErrorSchema.parse(JSON.parse(res.text)).issues?.length).toBeGreaterThan(0);
    expect(await ownerRow(draft.id)).toEqual(before);
    expect(before.status).toBe('draft');
  });
});

describe('PUT /purchase-requests/:id, no caller', () => {
  it('answers 401 without X-User-Id', async () => {
    const res = await edit(undefined, A.purchaseRequests[0]);
    expect(res.status).toBe(401);
  });
});

describe('the seed', () => {
  it('left the seeded requests unchanged', async () => {
    expect(await seededRequestsSnapshot(owner)).toEqual(seeded);
  });
});
