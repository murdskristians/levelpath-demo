import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEED, startApp } from '../../test/helpers.js';

// Spec criteria 14 and 15, over real HTTP: GET /me answers for the caller the guard
// resolved, read through withTenant, and the client can't pick another tenant.

const A = SEED.acme;
const B = SEED.globex;
let app: INestApplication;
let url: string;
beforeAll(async () => {
  ({ app, url } = await startApp());
});
afterAll(async () => {
  await app.close();
});

const me = (userId: string, path = '/me', headers: Record<string, string> = {}) =>
  fetch(`${url}${path}`, { headers: { 'X-User-Id': userId, ...headers } });

describe('GET /me (criterion 14)', () => {
  it('returns Alice, requester at Acme Corp', async () => {
    const res = await me(A.requester);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      user: { id: A.requester, name: 'Alice', role: 'requester' },
      tenant: { id: A.tenant, name: 'Acme Corp' },
    });
  });

  it('returns Boris, approver at Globex Corp', async () => {
    const res = await me(B.approver);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      user: { id: B.approver, name: 'Boris', role: 'approver' },
      tenant: { id: B.tenant, name: 'Globex Corp' },
    });
  });
});

describe('the client can’t choose the tenant (criterion 15)', () => {
  it('ignores a tenant in the query string and in an X-Tenant-Id header', async () => {
    const res = await me(A.requester, `/me?tenantId=${B.tenant}`, { 'X-Tenant-Id': B.tenant });
    expect(res.status).toBe(200);
    expect((await res.json()).tenant).toEqual({ id: A.tenant, name: 'Acme Corp' });
  });
});
