import {
  purchaseRequestSchema,
  supplierSchema,
  type PurchaseRequest,
  type Supplier,
} from '@levelpath/shared';
import { vi } from 'vitest';
import type { Me } from '../api';
import { USERS } from '../users';

export const ID = (n: number) => `c0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export const supplier = (over: Partial<Supplier> = {}): Supplier =>
  supplierSchema.parse({ id: ID(900), name: 'Dell', ...over });

export function purchaseRequest(over: Partial<PurchaseRequest> = {}): PurchaseRequest {
  return purchaseRequestSchema.parse({
    id: ID(1),
    title: 'Laptops',
    amountCents: 125000,
    currency: 'EUR',
    status: 'draft',
    category: 'other',
    description: '',
    supplier: supplier(),
    requester: { id: USERS[0].id, name: 'Alice' },
    createdAt: '2026-01-01T10:00:00.000Z',
    updatedAt: '2026-01-01T10:00:00.000Z',
    decision: null,
    ...over,
  });
}

export function me(userId: string): Me {
  const u = USERS.find((x) => x.id === userId)!;
  return {
    user: { id: u.id, name: u.name, role: u.role },
    tenant: { id: `tenant-${u.company}`, name: u.company },
  };
}

export type Call = {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
};

class Failure {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {}
}
/** A route reply with a non-200 status. */
export const fail = (status: number, body: unknown) => new Failure(status, body);

type Handler = unknown | ((call: Call) => unknown);

/** Mocks global fetch by "METHOD /path" (without /api). Records every call. */
export function mockFetch(routes: Record<string, Handler>) {
  const calls: Call[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const call: Call = {
      method,
      url,
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    const handler = routes[`${method} ${url.replace(/^\/api/, '')}`];
    if (handler === undefined) {
      return new Response(JSON.stringify({ statusCode: 404, message: 'no route' }), {
        status: 404,
      });
    }
    // A handler may return a promise, so a test can hold a reply until it resolves it.
    const reply: unknown = await (typeof handler === 'function' ? handler(call) : handler);
    if (reply instanceof Failure) {
      return new Response(JSON.stringify(reply.body), { status: reply.status });
    }
    return new Response(JSON.stringify(reply), { status: 200 });
  });
  vi.stubGlobal('fetch', fn);
  return {
    calls,
    fn,
    /** Calls to one route, e.g. count('GET', '/purchase-requests/mine'). */
    count: (method: string, path: string) =>
      calls.filter((c) => c.method === method && c.url === `/api${path}`).length,
  };
}
