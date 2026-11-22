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

// Spec criteria 11 to 17, over real HTTP against this run's database: POST
// /purchase-requests/:id/decision. The checks run in order: 401, 403 for a requester,
// 400 for the body, 404 for what the approver may not see, 403 for their own request,
// 409 for a request that isn't submitted.

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

async function decide(userId: string | undefined, id: string, body?: unknown) {
  const headers: Record<string, string> = {};
  if (userId) headers['X-User-Id'] = userId;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${url}/purchase-requests/${id}/decision`, {
    method: 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, text: await res.text() };
}

/** A fresh submitted request by `userId` (Alice unless named), never a seeded one. */
async function submittedBy(userId: string = A.requester): Promise<PurchaseRequest> {
  const created = await fetch(`${url}/purchase-requests`, {
    method: 'POST',
    headers: { 'X-User-Id': userId, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'Decision test',
      amountCents: 1000,
      supplierId: A.suppliers[0],
      category: 'other',
    }),
  });
  expect(created.status).toBe(201);
  const { id } = purchaseRequestSchema.parse(await created.json());
  const submitted = await fetch(`${url}/purchase-requests/${id}/submit`, {
    method: 'POST',
    headers: { 'X-User-Id': userId },
  });
  expect(submitted.status).toBe(200);
  return purchaseRequestSchema.parse(await submitted.json());
}

async function status(id: string): Promise<string> {
  const { rows } = await owner.query('select status from purchase_requests where id = $1', [id]);
  return rows[0].status;
}

async function approvals(id: string) {
  const { rows } = await owner.query(
    'select tenant_id, approver_id, decision, comment from approvals where purchase_request_id = $1',
    [id],
  );
  return rows;
}

const FORBIDDEN = { message: 'Forbidden', statusCode: 403 };
const NOT_FOUND = { message: 'Not Found', statusCode: 404 };

describe('POST /purchase-requests/:id/decision, approve and reject (criterion 11)', () => {
  it('approves, with no comment stored as null', async () => {
    const p = await submittedBy();
    const res = await decide(A.approver, p.id, { decision: 'approved' });
    expect(res.status).toBe(200);
    const decided = purchaseRequestSchema.parse(JSON.parse(res.text));
    expect(decided.status).toBe('approved');
    expect(decided.decision).toEqual({
      decision: 'approved',
      comment: null,
      approver: { id: A.approver, name: 'Amir' },
      decidedAt: expect.any(String),
    });
    expect(await approvals(p.id)).toEqual([
      { tenant_id: A.tenant, approver_id: A.approver, decision: 'approved', comment: null },
    ]);
  });

  it('rejects, with the comment trimmed', async () => {
    const q = await submittedBy();
    const res = await decide(A.approver, q.id, {
      decision: 'rejected',
      comment: '  Over budget  ',
    });
    expect(res.status).toBe(200);
    const decided = purchaseRequestSchema.parse(JSON.parse(res.text));
    expect(decided.status).toBe('rejected');
    expect(decided.decision?.comment).toBe('Over budget');
    expect(decided.decision?.approver).toEqual({ id: A.approver, name: 'Amir' });
    expect(await approvals(q.id)).toEqual([
      {
        tenant_id: A.tenant,
        approver_id: A.approver,
        decision: 'rejected',
        comment: 'Over budget',
      },
    ]);
  });
});

describe('POST /purchase-requests/:id/decision, invalid body: 400 (criterion 12)', () => {
  const cases: [string, unknown, string?][] = [
    ['a rejection without a comment', { decision: 'rejected' }, 'comment'],
    ['a rejection with a blank comment', { decision: 'rejected', comment: '   ' }, 'comment'],
    ['an id', { decision: 'approved', id: 'a0000000-0000-4000-8000-000000000999' }, ''],
    ['a tenantId', { decision: 'approved', tenantId: B.tenant }, ''],
    ['an unknown decision', { decision: 'maybe' }, 'decision'],
    ['no body at all', undefined, ''],
  ];

  it.each(cases)('rejects %s, and leaves the request submitted', async (_name, body, path) => {
    const s = await submittedBy();
    const res = await decide(A.approver, s.id, body);
    expect(res.status).toBe(400);
    const error = apiErrorSchema.parse(JSON.parse(res.text));
    expect(error.statusCode).toBe(400);
    expect(error.issues?.length).toBeGreaterThan(0);
    expect(error.issues?.map((i) => i.path)).toContain(path);
    expect(await status(s.id)).toBe('submitted');
    expect(await approvals(s.id)).toEqual([]);
  });
});

describe('POST /purchase-requests/:id/decision by a requester: 403 first (criterion 13)', () => {
  it('answers the same 403 whatever the id or the body', async () => {
    const answers = [
      await decide(A.requester, A.purchaseRequests[1], { decision: 'approved' }),
      await decide(A.requester, 'not-a-uuid', { decision: 'approved' }),
      await decide(A.requester, B.purchaseRequests[1], { decision: 'approved' }),
      await decide(A.requester, A.purchaseRequests[1], { decision: 'maybe' }),
      await decide(A.requester, A.purchaseRequests[1]),
    ];
    for (const res of answers) {
      expect(res.status).toBe(403);
      expect(apiErrorSchema.parse(JSON.parse(res.text))).toEqual(FORBIDDEN);
    }
    expect(new Set(answers.map((res) => res.text)).size).toBe(1);
  });
});

describe('POST /purchase-requests/:id/decision, what the approver may not see: 404 (criterion 14)', () => {
  it("answers the same 404 for a non-UUID, an unknown id, Globex's request and Alice's draft", async () => {
    const answers = [];
    for (const id of ['not-a-uuid', UNKNOWN, B.purchaseRequests[1], A.purchaseRequests[0]]) {
      answers.push(await decide(A.approver, id, { decision: 'approved' }));
    }
    for (const res of answers) {
      expect(res.status).toBe(404);
      expect(apiErrorSchema.parse(JSON.parse(res.text))).toEqual(NOT_FOUND);
    }
    expect(new Set(answers.map((res) => res.text)).size).toBe(1);

    expect(await status(B.purchaseRequests[1])).toBe('submitted');
    expect(await approvals(B.purchaseRequests[1])).toEqual([]);
    expect(await status(A.purchaseRequests[0])).toBe('draft');
    expect(await approvals(A.purchaseRequests[0])).toEqual([]);
  });
});

describe('POST /purchase-requests/:id/decision, no self-approval: 403 (criterion 15)', () => {
  it("refuses Amir's decision on his own request", async () => {
    const r = await submittedBy(A.approver);
    const res = await decide(A.approver, r.id, { decision: 'approved' });
    expect(res.status).toBe(403);
    expect(apiErrorSchema.parse(JSON.parse(res.text))).toEqual(FORBIDDEN);
    expect(await status(r.id)).toBe('submitted');
    expect(await approvals(r.id)).toEqual([]);

    const toDecide = await fetch(`${url}/purchase-requests/to-decide`, {
      headers: { 'X-User-Id': A.approver },
    });
    const ids = purchaseRequestSchema
      .array()
      .parse(await toDecide.json())
      .map((p) => p.id);
    expect(ids).toContain(r.id);
  });
});

describe('POST /purchase-requests/:id/decision, not submitted: 409 (criterion 16)', () => {
  it('answers 409 for an approved and a rejected request', async () => {
    for (const id of [A.purchaseRequests[2], A.purchaseRequests[3]]) {
      const res = await decide(A.approver, id, { decision: 'approved' });
      expect(res.status).toBe(409);
      expect(apiErrorSchema.parse(JSON.parse(res.text)).statusCode).toBe(409);
    }
  });

  it('answers 409 to a second decision, and keeps the first', async () => {
    const p = await submittedBy();
    expect((await decide(A.approver, p.id, { decision: 'approved' })).status).toBe(200);
    const again = await decide(A.approver, p.id, { decision: 'rejected', comment: 'Changed' });
    expect(again.status).toBe(409);
    apiErrorSchema.parse(JSON.parse(again.text));
    expect(await status(p.id)).toBe('approved');
    expect(await approvals(p.id)).toHaveLength(1);
  });
});

describe('POST /purchase-requests/:id/decision, concurrent decisions (criterion 17)', () => {
  it('lets exactly one of two simultaneous decisions win', async () => {
    const p = await submittedBy();
    const answers = await Promise.all([
      decide(A.approver, p.id, { decision: 'approved' }),
      decide(A.approver, p.id, { decision: 'rejected', comment: 'Too late' }),
    ]);
    expect(answers.map((res) => res.status).sort()).toEqual([200, 409]);
    const rows = await approvals(p.id);
    expect(rows).toHaveLength(1);
    expect(await status(p.id)).toBe(rows[0].decision);
  });
});

describe('POST /purchase-requests/:id/decision, no caller (criterion 2)', () => {
  it('answers 401 without X-User-Id', async () => {
    const res = await decide(undefined, A.purchaseRequests[1], { decision: 'approved' });
    expect(res.status).toBe(401);
    expect(JSON.parse(res.text)).toEqual({ message: 'Unauthorized', statusCode: 401 });
  });
});

describe('the seed (criterion 18)', () => {
  it('left the seeded requests unchanged', async () => {
    expect(await seededRequestsSnapshot(owner)).toEqual(seeded);
  });
});
