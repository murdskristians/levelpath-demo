import {
  apiErrorSchema,
  purchaseRequestSchema,
  supplierSchema,
  type CreatePurchaseRequestInput,
  type DecisionInput,
} from '@levelpath/shared';
import { z } from 'zod';

// GET /me has no shared schema (packages/shared stays as it is), so it is read here.
export const meSchema = z.object({
  user: z.object({ id: z.string(), name: z.string(), role: z.enum(['requester', 'approver']) }),
  tenant: z.object({ id: z.string(), name: z.string() }),
});
export type Me = z.infer<typeof meSchema>;

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly issues: { path: string; message: string }[] = [],
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

/** Every call goes to /api/… with X-User-Id; every response is parsed before use. */
export function createApi(userId: string) {
  async function call<T>(
    method: 'GET' | 'POST',
    path: string,
    schema: z.ZodType<T>,
    body?: unknown,
  ): Promise<T> {
    const headers: Record<string, string> = { 'X-User-Id': userId };
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    let res: Response;
    try {
      res = await fetch(`/api${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      console.error('network failure', err);
      throw new ApiRequestError(0, 'Could not reach the server. Check your connection.');
    }

    if (!res.ok) {
      const parsed = apiErrorSchema.safeParse(await res.json().catch(() => null));
      if (parsed.success) {
        throw new ApiRequestError(res.status, parsed.data.message, parsed.data.issues);
      }
      throw new ApiRequestError(res.status, res.statusText || `Request failed (${res.status})`);
    }

    const parsed = schema.safeParse(await res.json().catch(() => null));
    if (!parsed.success) {
      console.error('unexpected response', path, parsed.error);
      throw new ApiRequestError(
        res.status,
        'The server sent a response this page does not understand.',
      );
    }
    return parsed.data;
  }

  const requests = z.array(purchaseRequestSchema);
  return {
    getMe: () => call('GET', '/me', meSchema),
    getSuppliers: () => call('GET', '/suppliers', z.array(supplierSchema)),
    getMine: () => call('GET', '/purchase-requests/mine', requests),
    getToDecide: () => call('GET', '/purchase-requests/to-decide', requests),
    createRequest: (input: CreatePurchaseRequestInput) =>
      call('POST', '/purchase-requests', purchaseRequestSchema, input),
    submit: (id: string) => call('POST', `/purchase-requests/${id}/submit`, purchaseRequestSchema),
    decide: (id: string, input: DecisionInput) =>
      call('POST', `/purchase-requests/${id}/decision`, purchaseRequestSchema, input),
  };
}
export type Api = ReturnType<typeof createApi>;
