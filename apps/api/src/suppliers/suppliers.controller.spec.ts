import type { INestApplication } from '@nestjs/common';
import { apiErrorSchema, supplierSchema } from '@levelpath/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEED, startApp } from '../../test/helpers.js';

// Spec criteria 1 and 2, over real HTTP: GET /suppliers lists the caller's company
// suppliers by name, read through withTenant, and needs X-User-Id.

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

async function suppliers(userId: string) {
  const res = await fetch(`${url}/suppliers`, { headers: { 'X-User-Id': userId } });
  expect(res.status).toBe(200);
  return supplierSchema.array().parse(await res.json());
}

describe('GET /suppliers (criterion 1)', () => {
  it("returns Acme's two suppliers, by name, to Alice", async () => {
    expect(await suppliers(A.requester)).toEqual([
      { id: A.suppliers[0], name: 'Bright Office Supplies' },
      { id: A.suppliers[1], name: 'Nordic Laptops' },
    ]);
  });

  it("returns only Globex's two suppliers to Bella", async () => {
    expect(await suppliers(B.requester)).toEqual([
      { id: B.suppliers[0], name: 'Harbor Print Co' },
      { id: B.suppliers[1], name: 'Summit IT Hardware' },
    ]);
  });

  it('answers 401 without X-User-Id (criterion 2)', async () => {
    const res = await fetch(`${url}/suppliers`);
    expect(res.status).toBe(401);
    expect(apiErrorSchema.parse(await res.json())).toEqual({
      message: 'Unauthorized',
      statusCode: 401,
    });
  });
});
