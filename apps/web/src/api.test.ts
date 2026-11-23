import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError, createApi } from './api';
import { fail, mockFetch, purchaseRequest } from './test/fixtures';

const ALICE = 'a0000000-0000-4000-8000-000000000101';

describe('createApi', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('sends X-User-Id to /api/…', async () => {
    const m = mockFetch({ 'GET /purchase-requests/mine': [purchaseRequest()] });
    const list = await createApi(ALICE).getMine();
    expect(list).toHaveLength(1);
    expect(m.calls[0].url).toBe('/api/purchase-requests/mine');
    expect(m.calls[0].headers['X-User-Id']).toBe(ALICE);
  });

  it('throws when a response does not parse', async () => {
    mockFetch({ 'GET /purchase-requests/mine': [{ ...purchaseRequest(), supplier: undefined }] });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(createApi(ALICE).getMine()).rejects.toBeInstanceOf(ApiRequestError);
  });

  it('surfaces the error body message and issues', async () => {
    mockFetch({
      'POST /purchase-requests': fail(400, {
        statusCode: 400,
        message: 'bad',
        issues: [{ path: 'title', message: 'too short' }],
      }),
    });
    const err = await createApi(ALICE)
      .createRequest({ title: 'x', amountCents: 1, supplierId: ALICE, category: 'other' })
      .then(
        () => null,
        (e: unknown) => e as ApiRequestError,
      );
    expect(err?.status).toBe(400);
    expect(err?.message).toBe('bad');
    expect(err?.issues).toEqual([{ path: 'title', message: 'too short' }]);
  });

  it('falls back to the status text for a non-JSON error body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('not json', { status: 502, statusText: 'Bad Gateway' })),
    );
    const err = await createApi(ALICE)
      .getMine()
      .then(
        () => null,
        (e: unknown) => e as ApiRequestError,
      );
    expect(err?.status).toBe(502);
    expect(err?.message).toBe('Bad Gateway');
  });

  it('posts the description for a suggestion and parses the answer (Phase 4)', async () => {
    const m = mockFetch({ 'POST /purchase-requests/suggestion': { suggestion: null } });
    expect(await createApi(ALICE).suggest('need pens')).toEqual({ suggestion: null });
    expect(m.calls[0]).toMatchObject({
      method: 'POST',
      url: '/api/purchase-requests/suggestion',
      body: { description: 'need pens' },
    });
  });

  it('rejects a suggestion answer with extra keys: the schema is strict', async () => {
    mockFetch({ 'POST /purchase-requests/suggestion': { suggestion: null, debug: 'x' } });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(createApi(ALICE).suggest('need pens')).rejects.toBeInstanceOf(ApiRequestError);
  });

  it('wraps a network failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('offline'))),
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const err = await createApi(ALICE)
      .getMine()
      .then(
        () => null,
        (e: unknown) => e as ApiRequestError,
      );
    expect(err).toBeInstanceOf(ApiRequestError);
    expect(err?.status).toBe(0);
  });
});
