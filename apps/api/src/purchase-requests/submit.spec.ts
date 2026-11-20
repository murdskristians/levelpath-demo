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

// Spec criteria 8, 9 and 10, over real HTTP against this run's database: POST
// /purchase-requests/:id/submit moves the caller's own draft to submitted. Anything
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

async function submit(userId: string | undefined, id: string) {
  const res = await fetch(`${url}/purchase-requests/${id}/submit`, {
    method: 'POST',
    headers: userId ? { 'X-User-Id': userId } : {},
  });
  return { status: res.status, text: await res.text() };
}

async function createAs(userId: string): Promise<PurchaseRequest> {
  const res = await fetch(`${url}/purchase-requests`, {
    method: 'POST',
    headers: { 'X-User-Id': userId, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Submit test', amountCents: 1000, supplierId: A.suppliers[0] }),
  });
  expect(res.status).toBe(201);
  return purchaseRequestSchema.parse(await res.json());
}

async function ownerRow(id: string) {
  const { rows } = await owner.query(
    'select status, updated_at from purchase_requests where id = $1',
    [id],
  );
  return rows[0];
}

const NOT_FOUND = { message: 'Not Found', statusCode: 404 };

describe('POST /purchase-requests/:id/submit, happy path (criterion 8)', () => {
  it("submits the caller's own draft", async () => {
    const draft = await createAs(A.requester);
    const res = await submit(A.requester, draft.id);
    expect(res.status).toBe(200);
    const submitted = purchaseRequestSchema.parse(JSON.parse(res.text));
    expect(submitted.id).toBe(draft.id);
    expect(submitted.status).toBe('submitted');
    expect(submitted.decision).toBeNull();

    // Compared in SQL, at microsecond precision.
    const { rows } = await owner.query(
      'select status, updated_at > created_at as later from purchase_requests where id = $1',
      [draft.id],
    );
    expect(rows).toEqual([{ status: 'submitted', later: true }]);
  });
});

describe('POST /purchase-requests/:id/submit, what the caller may not see: 404 (criterion 9)', () => {
  it('answers the same 404 for a non-UUID, an unknown id, a Globex draft and another requester’s draft', async () => {
    const amirsDraft = await createAs(A.approver);
    const globexBefore = await ownerRow(B.purchaseRequests[0]);
    const amirsBefore = await ownerRow(amirsDraft.id);

    const answers = [];
    for (const id of ['not-a-uuid', UNKNOWN, B.purchaseRequests[0], amirsDraft.id]) {
      answers.push(await submit(A.requester, id));
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
    const res = await submit(A.approver, A.purchaseRequests[0]);
    expect(res.status).toBe(404);
    expect(JSON.parse(res.text)).toEqual(NOT_FOUND);
    expect((await ownerRow(A.purchaseRequests[0])).status).toBe('draft');
  });
});

describe('POST /purchase-requests/:id/submit, not a draft: 409 (criterion 10)', () => {
  it('answers 409 for a submitted and an approved request', async () => {
    for (const id of [A.purchaseRequests[1], A.purchaseRequests[2]]) {
      const res = await submit(A.requester, id);
      expect(res.status).toBe(409);
      expect(apiErrorSchema.parse(JSON.parse(res.text)).statusCode).toBe(409);
    }
  });

  it('answers 200, then 409, for the same draft submitted twice', async () => {
    const draft = await createAs(A.requester);
    expect((await submit(A.requester, draft.id)).status).toBe(200);
    const updatedAt = (await ownerRow(draft.id)).updated_at;
    const again = await submit(A.requester, draft.id);
    expect(again.status).toBe(409);
    apiErrorSchema.parse(JSON.parse(again.text));
    expect(await ownerRow(draft.id)).toEqual({ status: 'submitted', updated_at: updatedAt });
  });
});

describe('POST /purchase-requests/:id/submit, no caller (criterion 2)', () => {
  it('answers 401 without X-User-Id', async () => {
    const res = await submit(undefined, A.purchaseRequests[0]);
    expect(res.status).toBe(401);
    expect(JSON.parse(res.text)).toEqual({ message: 'Unauthorized', statusCode: 401 });
  });
});

describe('the seed (criterion 18)', () => {
  it('left the seeded requests unchanged', async () => {
    expect(await seededRequestsSnapshot(owner)).toEqual(seeded);
  });
});
