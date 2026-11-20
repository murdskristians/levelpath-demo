import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { fail, ID, me, mockFetch, purchaseRequest, supplier } from './test/fixtures';
import { USERS } from './users';

const [ALICE, AMIR, BELLA] = USERS.map((u) => u.id);
const KEY = 'levelpath.userId';

const base = (userId: string, extra: Record<string, unknown> = {}) => ({
  'GET /me': me(userId),
  'GET /suppliers': [supplier()],
  'GET /purchase-requests/mine': [],
  ...extra,
});

function renderAs(userId: string | null) {
  if (userId) localStorage.setItem(KEY, userId);
  return render(<App />);
}

describe('App', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('shell', () => {
    it('renders the headings and the footer with the current year', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2031, 5, 15));
      mockFetch({});
      render(<App />);

      expect(screen.getByRole('heading', { name: /levelpath demo/i })).toBeTruthy();
      expect(screen.getByRole('contentinfo').textContent).toBe('Levelpath Demo · 2031');
    });

    it('lists exactly the four users and says it is a development stub', () => {
      mockFetch({});
      render(<App />);

      const select = screen.getByLabelText('User') as HTMLSelectElement;
      const names = Array.from(select.options)
        .filter((o) => !o.disabled)
        .map((o) => o.textContent);
      expect(names).toEqual([
        'Alice (Acme Corp, requester)',
        'Amir (Acme Corp, approver)',
        'Bella (Globex Corp, requester)',
        'Boris (Globex Corp, approver)',
      ]);
      expect(screen.getByText(/development stub, not a login/i)).toBeTruthy();
    });

    it('asks to pick a user and calls nothing when storage is empty', () => {
      const m = mockFetch({});
      render(<App />);

      expect(screen.getByText(/pick a user/i, { selector: 'p' })).toBeTruthy();
      expect(m.fn).not.toHaveBeenCalled();
    });

    it('fetches as the stored user without a click, and stores a new choice', async () => {
      const m = mockFetch(base(AMIR, { 'GET /purchase-requests/to-decide': [] }));
      renderAs(AMIR);

      await screen.findByText('Amir');
      expect(m.calls.length).toBeGreaterThan(0);
      expect(m.calls.every((c) => c.headers['X-User-Id'] === AMIR)).toBe(true);

      fireEvent.change(screen.getByLabelText('User'), { target: { value: BELLA } });
      expect(localStorage.getItem(KEY)).toBe(BELLA);
    });

    it('sends the header on every call and re-fetches for the new user', async () => {
      const m = mockFetch({
        'GET /me': (c: { headers: Record<string, string> }) => me(c.headers['X-User-Id']),
        'GET /suppliers': [supplier()],
        'GET /purchase-requests/mine': (c: { headers: Record<string, string> }) =>
          c.headers['X-User-Id'] === ALICE
            ? [purchaseRequest({ title: 'Alice laptops' })]
            : [purchaseRequest({ id: ID(2), title: 'Bella chairs' })],
      });
      renderAs(ALICE);

      await screen.findByText('Alice laptops');
      expect(m.calls.every((c) => c.url.startsWith('/api/'))).toBe(true);
      expect(m.calls.every((c) => c.headers['X-User-Id'] === ALICE)).toBe(true);

      fireEvent.change(screen.getByLabelText('User'), { target: { value: BELLA } });
      await screen.findByText('Bella chairs');
      expect(screen.queryByText('Alice laptops')).toBeNull();
      for (const path of ['/me', '/suppliers', '/purchase-requests/mine']) {
        expect(
          m.calls.some((c) => c.url === `/api${path}` && c.headers['X-User-Id'] === BELLA),
        ).toBe(true);
      }
    });

    it('shows the name and company from /me', async () => {
      mockFetch(base(ALICE));
      renderAs(ALICE);

      const header = screen.getByRole('banner');
      await within(header).findByText('Alice');
      expect(within(header).getByText(/Acme Corp/, { selector: 'p' })).toBeTruthy();
    });
  });

  describe('my requests', () => {
    it('lists requests in order with amount, supplier, badge, decision and actions', async () => {
      const rejected = purchaseRequest({
        id: ID(2),
        title: 'Chairs',
        status: 'rejected',
        decision: {
          decision: 'rejected',
          comment: 'too dear',
          approver: { id: AMIR, name: 'Amir' },
          decidedAt: '2026-01-02T10:00:00.000Z',
        },
      });
      mockFetch(base(ALICE, { 'GET /purchase-requests/mine': [purchaseRequest(), rejected] }));
      renderAs(ALICE);

      await screen.findByText('Laptops');
      const items = screen.getAllByRole('listitem');
      expect(items).toHaveLength(2);
      expect(items[0].textContent).toContain('Laptops');
      expect(items[1].textContent).toContain('Chairs');

      const expected = new Intl.NumberFormat('en', { style: 'currency', currency: 'EUR' }).format(
        1250,
      );
      expect(within(items[0]).getByText(new RegExp(expected.replace('€', '\\€')))).toBeTruthy();
      expect(within(items[0]).getByText(/Dell/)).toBeTruthy();
      expect(within(items[0]).getByText('Draft')).toBeTruthy();
      expect(within(items[0]).getByRole('button', { name: 'Submit' })).toBeTruthy();
      expect(within(items[1]).getByText('Rejected')).toBeTruthy();
      expect(within(items[1]).getByText(/too dear/)).toBeTruthy();
      expect(within(items[1]).queryByRole('button', { name: 'Submit' })).toBeNull();
    });

    it('shows an empty state', async () => {
      mockFetch(base(ALICE));
      renderAs(ALICE);

      expect(await screen.findByText('No purchase requests yet.')).toBeTruthy();
    });

    it('submits a draft, then re-fetches and shows the new status', async () => {
      let status: 'draft' | 'submitted' = 'draft';
      const m = mockFetch(
        base(ALICE, {
          'GET /purchase-requests/mine': () => [purchaseRequest({ status })],
          [`POST /purchase-requests/${ID(1)}/submit`]: () => {
            status = 'submitted';
            return purchaseRequest({ status });
          },
        }),
      );
      renderAs(ALICE);

      fireEvent.click(await screen.findByRole('button', { name: 'Submit' }));
      await screen.findByText('Submitted');
      const post = m.calls.find((c) => c.method === 'POST')!;
      expect(post.url).toBe(`/api/purchase-requests/${ID(1)}/submit`);
      expect(post.headers['X-User-Id']).toBe(ALICE);
      expect(m.count('GET', '/purchase-requests/mine')).toBe(2);
      expect(screen.queryByRole('button', { name: 'Submit' })).toBeNull();
    });
  });

  describe('new request form', () => {
    async function openForm() {
      const m = mockFetch(
        base(ALICE, {
          'POST /purchase-requests': purchaseRequest({ title: 'Laptops' }),
        }),
      );
      renderAs(ALICE);
      await screen.findByText('No purchase requests yet.');
      fireEvent.click(screen.getByRole('button', { name: 'New request' }));
      return m;
    }
    const fill = (label: string, value: string) =>
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    const posts = (m: Awaited<ReturnType<typeof openForm>>) =>
      m.calls.filter((c) => c.method === 'POST');

    it('shows an error next to the title and sends nothing when submitted empty', async () => {
      const m = await openForm();
      fireEvent.click(screen.getByRole('button', { name: 'Create request' }));

      const title = screen.getByLabelText('Title');
      expect(title.getAttribute('aria-invalid')).toBe('true');
      expect(document.getElementById(title.getAttribute('aria-describedby')!)?.textContent).toMatch(
        /title/i,
      );
      expect(posts(m)).toHaveLength(0);
    });

    it.each([
      ['Amount', '-1', 'amount'],
      ['Amount', 'abc', 'amount'],
      ['Title', 'x'.repeat(201), 'title'],
      ['Currency', 'eur', 'currency'],
    ])('rejects %s = %s next to its own field', async (label, value, id) => {
      const m = await openForm();
      fill('Title', 'Laptops');
      fill('Amount', '12.34');
      fill('Supplier', supplier().id);
      fill(label, value);
      fireEvent.click(screen.getByRole('button', { name: 'Create request' }));

      expect(document.getElementById(`${id}-error`)).not.toBeNull();
      expect(document.querySelectorAll('.field-error')).toHaveLength(1);
      expect(posts(m)).toHaveLength(0);
    });

    it('posts the converted values, closes the form and re-fetches', async () => {
      const m = await openForm();
      fill('Title', 'Laptops');
      fill('Amount', '12.34');
      fill('Supplier', supplier().id);
      fireEvent.click(screen.getByRole('button', { name: 'Create request' }));

      await waitFor(() => expect(screen.queryByLabelText('Title')).toBeNull());
      expect(posts(m)).toHaveLength(1);
      expect(posts(m)[0].url).toBe('/api/purchase-requests');
      expect(JSON.stringify(posts(m)[0].body)).toBe(
        `{"title":"Laptops","amountCents":1234,"currency":"EUR","supplierId":"${supplier().id}"}`,
      );
      await waitFor(() => expect(m.count('GET', '/purchase-requests/mine')).toBe(2));
    });

    it.each([
      ['0.29', 29],
      ['1.15', 115],
    ])('sends %s as %i cents', async (text, cents) => {
      const m = await openForm();
      fill('Title', 'Pens');
      fill('Amount', text);
      fill('Supplier', supplier().id);
      fireEvent.click(screen.getByRole('button', { name: 'Create request' }));

      await waitFor(() => expect(posts(m)).toHaveLength(1));
      expect((posts(m)[0].body as { amountCents: number }).amountCents).toBe(cents);
    });

    it('closes on Cancel', async () => {
      await openForm();
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(screen.queryByLabelText('Title')).toBeNull();
    });
  });

  describe('approver queue', () => {
    const waiting = purchaseRequest({ id: ID(5), title: 'Monitors', status: 'submitted' });

    it('lists the to-decide items for an approver', async () => {
      mockFetch(base(AMIR, { 'GET /purchase-requests/to-decide': [waiting] }));
      renderAs(AMIR);

      expect(
        await screen.findByRole('heading', { name: 'Waiting for your decision' }),
      ).toBeTruthy();
      expect(await screen.findByText('Monitors')).toBeTruthy();
    });

    it('does not render or fetch the queue for a requester', async () => {
      const m = mockFetch(base(ALICE));
      renderAs(ALICE);

      await screen.findByText('Alice');
      expect(screen.queryByRole('heading', { name: 'Waiting for your decision' })).toBeNull();
      expect(m.calls.some((c) => c.url.includes('to-decide'))).toBe(false);
    });

    it('approves with an optional comment, then re-fetches the queue', async () => {
      const m = mockFetch(
        base(AMIR, {
          'GET /purchase-requests/to-decide': [waiting],
          [`POST /purchase-requests/${ID(5)}/decision`]: purchaseRequest({ status: 'approved' }),
        }),
      );
      renderAs(AMIR);

      fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
      await waitFor(() => expect(m.count('GET', '/purchase-requests/to-decide')).toBe(2));
      const post = m.calls.find((c) => c.method === 'POST')!;
      expect(post.url).toBe(`/api/purchase-requests/${ID(5)}/decision`);
      expect(post.body).toEqual({ decision: 'approved', comment: '' });
    });

    it('blocks a rejection without a comment, and sends one with a comment', async () => {
      const m = mockFetch(
        base(AMIR, {
          'GET /purchase-requests/to-decide': [waiting],
          [`POST /purchase-requests/${ID(5)}/decision`]: purchaseRequest({ status: 'rejected' }),
        }),
      );
      renderAs(AMIR);

      fireEvent.click(await screen.findByRole('button', { name: 'Reject' }));
      expect(screen.getByText('a rejection needs a comment')).toBeTruthy();
      expect(m.calls.some((c) => c.method === 'POST')).toBe(false);

      fireEvent.change(screen.getByLabelText('Comment on Monitors'), {
        target: { value: 'too dear' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
      await waitFor(() => expect(m.calls.some((c) => c.method === 'POST')).toBe(true));
      expect(m.calls.find((c) => c.method === 'POST')!.body).toEqual({
        decision: 'rejected',
        comment: 'too dear',
      });
    });
  });

  describe('errors', () => {
    it('shows the API message in an alert and keeps the lists', async () => {
      mockFetch(
        base(ALICE, {
          'GET /purchase-requests/mine': [purchaseRequest()],
          [`POST /purchase-requests/${ID(1)}/submit`]: fail(409, {
            statusCode: 409,
            message: 'not a draft',
          }),
        }),
      );
      renderAs(ALICE);

      fireEvent.click(await screen.findByRole('button', { name: 'Submit' }));
      expect((await screen.findByRole('alert')).textContent).toContain('not a draft');
      expect(screen.getByText('Laptops')).toBeTruthy();
    });

    it('lists the issues of a 400', async () => {
      mockFetch(
        base(ALICE, {
          'GET /purchase-requests/mine': [purchaseRequest()],
          [`POST /purchase-requests/${ID(1)}/submit`]: fail(400, {
            statusCode: 400,
            message: 'invalid',
            issues: [{ path: 'title', message: 'bad title' }],
          }),
        }),
      );
      renderAs(ALICE);

      fireEvent.click(await screen.findByRole('button', { name: 'Submit' }));
      expect((await screen.findByRole('alert')).textContent).toContain('title: bad title');
    });

    it('asks to pick a user on a 401', async () => {
      mockFetch({
        'GET /me': fail(401, { statusCode: 401, message: 'Unauthorized' }),
        'GET /suppliers': fail(401, { statusCode: 401, message: 'Unauthorized' }),
        'GET /purchase-requests/mine': fail(401, { statusCode: 401, message: 'Unauthorized' }),
      });
      renderAs(ALICE);

      expect((await screen.findByRole('alert')).textContent).toMatch(/pick a user/i);
    });

    it('shows an alert for a network failure', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => Promise.reject(new TypeError('offline'))),
      );
      renderAs(ALICE);

      expect((await screen.findByRole('alert')).textContent).toMatch(/could not reach/i);
    });

    it('shows an alert and no rows for a response that fails the schema', async () => {
      const broken = { ...purchaseRequest(), supplier: undefined };
      mockFetch(base(ALICE, { 'GET /purchase-requests/mine': [broken] }));
      renderAs(ALICE);

      await screen.findByRole('alert');
      expect(screen.queryByText('Laptops')).toBeNull();
      expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    });
  });

  describe('styles', () => {
    const css = readFileSync('src/App.css', 'utf8');

    it('makes form controls fill their container', () => {
      expect(css).toMatch(/input,\s*select,\s*textarea\s*{[^}]*width:\s*100%/);
    });

    it('has no fixed width above 320px', () => {
      const widths = [...css.matchAll(/(?<!-)\bwidth:\s*(\d+(?:\.\d+)?)(px|rem)/g)];
      for (const [, n, unit] of widths) {
        expect(Number(n) * (unit === 'rem' ? 16 : 1)).toBeLessThanOrEqual(320);
      }
    });
  });
});
