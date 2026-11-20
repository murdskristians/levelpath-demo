import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEED, startApp } from '../../test/helpers.js';

// Spec criteria 13 and 17, over real HTTP: the global guard turns away every request
// without a known X-User-Id the same way, and leaves the public routes open.

let app: INestApplication;
let url: string;
beforeAll(async () => {
  ({ app, url } = await startApp());
});
afterAll(async () => {
  await app.close();
});

async function getMe(headers: Record<string, string> = {}) {
  const res = await fetch(`${url}/me`, { headers });
  return { status: res.status, body: await res.text() };
}

describe('AuthGuard rejects (criterion 13)', () => {
  it('a request without X-User-Id', async () => {
    expect((await getMe()).status).toBe(401);
  });

  it('a malformed X-User-Id', async () => {
    expect((await getMe({ 'X-User-Id': 'not-a-uuid' })).status).toBe(401);
    expect((await getMe({ 'X-User-Id': `${SEED.acme.requester}' or '1'='1` })).status).toBe(401);
  });

  it('a well-formed id that matches no user', async () => {
    expect((await getMe({ 'X-User-Id': 'c0000000-0000-4000-8000-000000000999' })).status).toBe(401);
  });

  it('all with the same body, so a response never tells whether a user exists', async () => {
    const bodies = await Promise.all([
      getMe(),
      getMe({ 'X-User-Id': 'not-a-uuid' }),
      getMe({ 'X-User-Id': 'c0000000-0000-4000-8000-000000000999' }),
    ]);
    expect(new Set(bodies.map((b) => b.body)).size).toBe(1);
    expect(JSON.parse(bodies[0].body)).toEqual({ message: 'Unauthorized', statusCode: 401 });
  });
});

describe('public routes stay public (criterion 17)', () => {
  it('GET /health answers without X-User-Id', async () => {
    const res = await fetch(`${url}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('GET /version answers without X-User-Id', async () => {
    const res = await fetch(`${url}/version`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ version: expect.any(String) });
  });
});
