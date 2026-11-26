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
        category: 'office_supplies',
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
      expect(within(items[0]).getByText(/Other/)).toBeTruthy();
      expect(within(items[1]).getByText(/Office supplies/)).toBeTruthy();
      expect(within(items[0]).getByText('Draft')).toBeTruthy();
      expect(within(items[0]).getByRole('button', { name: 'Submit Laptops' })).toBeTruthy();
      expect(within(items[1]).getByText('Rejected')).toBeTruthy();
      expect(within(items[1]).getByText(/too dear/)).toBeTruthy();
      expect(within(items[1]).queryByRole('button', { name: 'Submit Chairs' })).toBeNull();
    });

    it('names the Submit button after its request, keeping the visible text', async () => {
      mockFetch(base(ALICE, { 'GET /purchase-requests/mine': [purchaseRequest()] }));
      renderAs(ALICE);

      const button = await screen.findByRole('button', { name: 'Submit Laptops' });
      expect(button.textContent).toBe('Submit');
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

      fireEvent.click(await screen.findByRole('button', { name: 'Submit Laptops' }));
      await screen.findByText('Submitted');
      const post = m.calls.find((c) => c.method === 'POST')!;
      expect(post.url).toBe(`/api/purchase-requests/${ID(1)}/submit`);
      expect(post.headers['X-User-Id']).toBe(ALICE);
      expect(m.count('GET', '/purchase-requests/mine')).toBe(2);
      expect(screen.queryByRole('button', { name: 'Submit Laptops' })).toBeNull();
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
    it('puts the form above the list and focuses Title', async () => {
      mockFetch(base(ALICE, { 'GET /purchase-requests/mine': [purchaseRequest()] }));
      renderAs(ALICE);
      await screen.findByText('Laptops');
      fireEvent.click(screen.getByRole('button', { name: 'New request' }));

      const title = screen.getByLabelText('Title');
      expect(document.activeElement).toBe(title);
      const form = screen.getByRole('form', { name: 'New request' });
      const list = screen.getByRole('list');
      expect(form.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

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
      ['Description', 'x'.repeat(2001), 'description'],
    ])('rejects %s = %s next to its own field', async (label, value, id) => {
      const m = await openForm();
      fill('Title', 'Laptops');
      fill('Category', 'hardware');
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
      fill('Description', '  For the new sales hires  ');
      fill('Title', 'Laptops');
      fill('Category', 'hardware');
      fill('Amount', '12.34');
      fill('Supplier', supplier().id);
      fireEvent.click(screen.getByRole('button', { name: 'Create request' }));

      await waitFor(() => expect(screen.queryByLabelText('Title')).toBeNull());
      expect(posts(m)).toHaveLength(1);
      expect(posts(m)[0].url).toBe('/api/purchase-requests');
      expect(JSON.stringify(posts(m)[0].body)).toBe(
        `{"title":"Laptops","amountCents":1234,"currency":"EUR","supplierId":"${supplier().id}",` +
          `"category":"hardware","description":"For the new sales hires"}`,
      );
      await waitFor(() => expect(m.count('GET', '/purchase-requests/mine')).toBe(2));
    });

    it.each([
      ['0.29', 29],
      ['1.15', 115],
    ])('sends %s as %i cents', async (text, cents) => {
      const m = await openForm();
      fill('Title', 'Pens');
      fill('Category', 'office_supplies');
      fill('Amount', text);
      fill('Supplier', supplier().id);
      fireEvent.click(screen.getByRole('button', { name: 'Create request' }));

      await waitFor(() => expect(posts(m)).toHaveLength(1));
      expect((posts(m)[0].body as { amountCents: number }).amountCents).toBe(cents);
    });

    it('shows Description, Title, Category, Amount, Currency and Supplier, in that order (Phase 4 criterion 16)', async () => {
      await openForm();
      const form = screen.getByRole('form', { name: 'New request' });
      expect([...form.querySelectorAll('label')].map((l) => l.textContent)).toEqual([
        'Description',
        'Title',
        'Category',
        'Amount',
        'Currency',
        'Supplier',
      ]);
      const options = within(screen.getByLabelText('Category')).getAllByRole('option');
      expect(options.map((o) => o.textContent)).toEqual([
        'Choose a category',
        'Hardware',
        'Software',
        'Office supplies',
        'Services',
        'Travel',
        'Other',
      ]);
      expect(screen.getByLabelText('Description').getAttribute('maxlength')).toBe('2000');
    });

    it('asks for a category and sends nothing without one (Phase 4 criterion 16)', async () => {
      const m = await openForm();
      fill('Title', 'Laptops');
      fill('Amount', '12.34');
      fill('Supplier', supplier().id);
      fireEvent.click(screen.getByRole('button', { name: 'Create request' }));

      const category = screen.getByLabelText('Category');
      expect(category.getAttribute('aria-invalid')).toBe('true');
      expect(document.getElementById(category.getAttribute('aria-describedby')!)?.textContent).toBe(
        'Choose a category.',
      );
      expect(document.querySelectorAll('.field-error')).toHaveLength(1);
      expect(posts(m)).toHaveLength(0);
    });

    it('closes on Cancel', async () => {
      await openForm();
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(screen.queryByLabelText('Title')).toBeNull();
    });
  });

  describe('suggest fields (Phase 4)', () => {
    const HAPPY = 'need 20 laptops for new sales hires, ~€1,200 each, prefer Nordic Laptops';
    const NORDIC = supplier({ id: ID(901), name: 'Nordic Laptops' });
    const SUGGESTION = {
      title: 'Laptops for new sales hires',
      category: 'hardware',
      quantity: 20,
      amountCents: 2_400_000,
      currency: 'EUR',
      supplierId: NORDIC.id,
    };
    const ROUTE = 'POST /purchase-requests/suggestion';
    const FIELDS = ['title', 'category', 'amount', 'currency', 'supplier'];

    async function openForm(reply: unknown) {
      const m = mockFetch(
        base(ALICE, {
          'GET /suppliers': [supplier(), NORDIC],
          [ROUTE]: reply,
          'POST /purchase-requests': purchaseRequest({ category: 'hardware' }),
        }),
      );
      renderAs(ALICE);
      await screen.findByText('No purchase requests yet.');
      fireEvent.click(screen.getByRole('button', { name: 'New request' }));
      await screen.findByRole('option', { name: 'Nordic Laptops' });
      return m;
    }
    const fill = (label: string, value: string) =>
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    const value = (label: string) => (screen.getByLabelText(label) as HTMLInputElement).value;
    const button = () => screen.getByRole('button', { name: /Suggest/ }) as HTMLButtonElement;
    const suggestions = (m: Awaited<ReturnType<typeof openForm>>) =>
      m.count('POST', '/purchase-requests/suggestion');
    const tagged = () =>
      [...document.querySelectorAll('.suggested-tag')].map((t) => t.id.replace('-suggested', ''));

    it('is disabled until the description has text, and typing calls nothing (criteria 16, 17)', async () => {
      const m = await openForm({ suggestion: SUGGESTION });
      expect(button().type).toBe('button');
      expect(button().textContent).toBe('Suggest fields');
      expect(button().disabled).toBe(true);
      fill('Description', '   ');
      expect(button().disabled).toBe(true);
      fill('Description', HAPPY);
      expect(button().disabled).toBe(false);
      expect(suggestions(m)).toBe(0);
    });

    it('fills and tags five fields with one POST, and creates nothing (criterion 17)', async () => {
      let release: (v: unknown) => void = () => {};
      const m = await openForm(() => new Promise((resolve) => (release = resolve)));
      fill('Description', HAPPY);
      fireEvent.click(button());

      // In flight: one call, and a disabled button that says so.
      await waitFor(() => expect(suggestions(m)).toBe(1));
      expect(button().textContent).toBe('Suggesting…');
      expect(button().disabled).toBe(true);
      const post = m.calls.find((c) => c.url === '/api/purchase-requests/suggestion')!;
      expect(post.body).toEqual({ description: HAPPY });
      expect(post.headers['X-User-Id']).toBe(ALICE);

      release({ suggestion: SUGGESTION });
      await screen.findByText('Suggested', { selector: '#title-suggested' });
      expect(value('Title')).toBe('Laptops for new sales hires');
      expect(value('Category')).toBe('hardware');
      expect(value('Amount')).toBe('24000.00');
      expect(value('Currency')).toBe('EUR');
      expect(value('Supplier')).toBe(NORDIC.id);
      expect(tagged()).toEqual(FIELDS);
      expect(screen.getAllByText('Suggested')).toHaveLength(5);
      expect(screen.getByLabelText('Title').getAttribute('aria-describedby')).toBe(
        'title-suggested',
      );
      expect(button().textContent).toBe('Suggest fields');
      expect(screen.getByRole('status').textContent).toBe('');

      // Nothing is created, and the list is not re-fetched, until Create request.
      expect(suggestions(m)).toBe(1);
      expect(m.count('POST', '/purchase-requests')).toBe(0);
      expect(m.count('GET', '/purchase-requests/mine')).toBe(1);
      expect(screen.getByText('No purchase requests yet.')).toBeTruthy();

      // Editing Title removes only its tag.
      fill('Title', 'Sales laptops');
      expect(tagged()).toEqual(['category', 'amount', 'currency', 'supplier']);
      expect(screen.getByLabelText('Title').getAttribute('aria-describedby')).toBeNull();

      fireEvent.click(screen.getByRole('button', { name: 'Create request' }));
      await waitFor(() => expect(m.count('POST', '/purchase-requests')).toBe(1));
      expect(m.calls.find((c) => c.url === '/api/purchase-requests')!.body).toEqual({
        title: 'Sales laptops',
        amountCents: 2_400_000,
        currency: 'EUR',
        supplierId: NORDIC.id,
        category: 'hardware',
        description: HAPPY,
      });
      expect(suggestions(m)).toBe(1);
    });

    it('leaves null fields and an unknown supplier as the user had them (A7)', async () => {
      await openForm({
        suggestion: { ...SUGGESTION, amountCents: null, currency: null, supplierId: ID(999) },
      });
      fill('Amount', '5');
      fill('Currency', 'USD');
      fill('Supplier', supplier().id);
      fill('Description', 'a box of pens');
      fireEvent.click(button());

      await screen.findByText('Suggested', { selector: '#title-suggested' });
      expect(tagged()).toEqual(['title', 'category']);
      expect([value('Amount'), value('Currency'), value('Supplier')]).toEqual([
        '5',
        'USD',
        supplier().id,
      ]);
    });

    const networkFailure = () => {
      throw new TypeError('offline');
    };
    it.each([
      ['{ suggestion: null }', { suggestion: null }],
      ['a 500', fail(500, { statusCode: 500, message: 'Internal server error' })],
      ['a body that fails the schema', { suggestion: { title: '' } }],
      ['a network failure', networkFailure],
    ])(
      'shows the note for %s, keeps every value and shows no alert (criterion 18)',
      async (_name, reply) => {
        const m = await openForm(reply);
        fill('Title', 'Mine');
        fill('Amount', '5');
        fill('Description', 'mock:invalid laptops');
        expect(screen.getByRole('status').textContent).toBe('');
        fireEvent.click(button());

        await waitFor(() =>
          expect(screen.getByRole('status').textContent).toBe(
            'No suggestion this time. Fill in the fields yourself.',
          ),
        );
        expect([value('Title'), value('Category'), value('Amount'), value('Currency')]).toEqual([
          'Mine',
          '',
          '5',
          'EUR',
        ]);
        expect(tagged()).toEqual([]);
        expect(screen.queryByRole('alert')).toBeNull();
        expect(button().disabled).toBe(false);
        expect(suggestions(m)).toBe(1);
      },
    );
  });

  describe('edit a draft', () => {
    const NORDIC = supplier({ id: ID(901), name: 'Nordic Laptops' });
    const draft = purchaseRequest({
      supplier: supplier(),
      category: 'hardware',
      description: 'For sales',
    });
    const fill = (label: string, value: string) =>
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    const value = (label: string) =>
      (screen.getByLabelText(label) as HTMLInputElement | HTMLSelectElement).value;

    async function openEdit(extra: Record<string, unknown> = {}) {
      let current = draft;
      const m = mockFetch(
        base(ALICE, {
          'GET /suppliers': [supplier(), NORDIC],
          'GET /purchase-requests/mine': () => [current],
          [`PUT /purchase-requests/${draft.id}`]: (call: { body: unknown }) => {
            const { title } = call.body as { title: string };
            current = purchaseRequest({ ...draft, title, supplier: NORDIC });
            return current;
          },
          ...extra,
        }),
      );
      renderAs(ALICE);
      await screen.findByText('Laptops');
      fireEvent.click(screen.getByRole('button', { name: 'Edit Laptops' }));
      await screen.findByRole('form', { name: 'Edit request' });
      return m;
    }
    const puts = (m: Awaited<ReturnType<typeof openEdit>>) =>
      m.calls.filter((c) => c.method === 'PUT');

    it('shows Edit next to Submit on a draft only', async () => {
      mockFetch(
        base(ALICE, {
          'GET /purchase-requests/mine': [
            draft,
            purchaseRequest({ id: ID(2), title: 'Chairs', status: 'submitted' }),
            purchaseRequest({ id: ID(3), title: 'Desks', status: 'approved' }),
          ],
        }),
      );
      renderAs(ALICE);
      await screen.findByText('Laptops');
      const edit = screen.getByRole('button', { name: 'Edit Laptops' });
      expect(edit.textContent).toBe('Edit');
      expect(edit.nextElementSibling).toBe(screen.getByRole('button', { name: 'Submit Laptops' }));
      expect(screen.getAllByRole('button', { name: /^Edit / })).toHaveLength(1);
    });

    it('opens the form pre-filled, then Save sends one PUT, closes and re-fetches', async () => {
      const m = await openEdit();
      expect(value('Title')).toBe('Laptops');
      expect(value('Amount')).toBe('1250.00');
      expect(value('Currency')).toBe('EUR');
      expect(value('Supplier')).toBe(draft.supplier.id);
      expect(value('Category')).toBe('hardware');
      expect(value('Description')).toBe('For sales');

      fill('Title', 'Better laptops');
      fill('Supplier', NORDIC.id);
      fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

      await screen.findByText('Better laptops');
      expect(screen.queryByRole('form')).toBeNull();
      expect(puts(m)).toHaveLength(1);
      expect(puts(m)[0].url).toBe(`/api/purchase-requests/${draft.id}`);
      expect(puts(m)[0].body).toEqual({
        title: 'Better laptops',
        amountCents: 125000,
        currency: 'EUR',
        supplierId: NORDIC.id,
        category: 'hardware',
        description: 'For sales',
      });
      expect(m.count('GET', '/purchase-requests/mine')).toBe(2);
      expect(screen.getByText('Draft')).toBeTruthy();
    });

    it('Cancel closes the form and sends nothing', async () => {
      const m = await openEdit();
      fill('Title', 'Changed');
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(screen.queryByRole('form')).toBeNull();
      expect(screen.getByText('Laptops')).toBeTruthy();
      expect(m.calls.filter((c) => c.method !== 'GET')).toHaveLength(0);
      expect(m.count('GET', '/purchase-requests/mine')).toBe(1);
    });

    it('shows the title error and sends nothing for an empty title', async () => {
      const m = await openEdit();
      fill('Title', '');
      fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
      expect(screen.getByLabelText('Title').getAttribute('aria-invalid')).toBe('true');
      expect(puts(m)).toHaveLength(0);
    });

    it('Suggest fields works in the edit form', async () => {
      const m = await openEdit({
        'POST /purchase-requests/suggestion': {
          suggestion: {
            title: 'Suggested laptops',
            category: 'hardware',
            quantity: 2,
            amountCents: 240000,
            currency: 'EUR',
            supplierId: NORDIC.id,
          },
        },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Suggest fields' }));
      await waitFor(() => expect(value('Title')).toBe('Suggested laptops'));
      expect(m.count('POST', '/purchase-requests/suggestion')).toBe(1);
      expect(value('Amount')).toBe('2400.00');
      expect(value('Supplier')).toBe(NORDIC.id);
      expect(document.querySelectorAll('.suggested-tag').length).toBe(5);
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

    it('shows the category and the description, as text (Phase 4 criterion 19)', async () => {
      const described = purchaseRequest({
        id: ID(6),
        title: 'Seats',
        status: 'submitted',
        category: 'software',
        description: 'Design tool seats <b>x</b>',
      });
      mockFetch(base(AMIR, { 'GET /purchase-requests/to-decide': [waiting, described] }));
      renderAs(AMIR);

      const item = (await screen.findByText('Seats')).closest('li')!;
      expect(within(item).getByText(/Software/)).toBeTruthy();
      expect(within(item).getByText('Design tool seats <b>x</b>')).toBeTruthy();
      expect(item.querySelector('b')).toBeNull();
      // An empty description adds no paragraph.
      const plain = screen.getByText('Monitors').closest('li')!;
      expect(plain.querySelectorAll('p')).toHaveLength(1);
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

      fireEvent.click(await screen.findByRole('button', { name: 'Approve Monitors' }));
      await waitFor(() => expect(m.count('GET', '/purchase-requests/to-decide')).toBe(2));
      const post = m.calls.find((c) => c.method === 'POST')!;
      expect(post.url).toBe(`/api/purchase-requests/${ID(5)}/decision`);
      expect(post.body).toEqual({ decision: 'approved', comment: '' });
    });

    it('names each decision button after its request', async () => {
      const second = purchaseRequest({ id: ID(6), title: 'Chairs', status: 'submitted' });
      mockFetch(base(AMIR, { 'GET /purchase-requests/to-decide': [waiting, second] }));
      renderAs(AMIR);

      const approve = await screen.findByRole('button', { name: 'Approve Monitors' });
      const reject = screen.getByRole('button', { name: 'Reject Monitors' });
      expect(approve.textContent).toBe('Approve');
      expect(reject.textContent).toBe('Reject');
      expect(screen.getByRole('button', { name: 'Approve Chairs' })).not.toBe(approve);
      expect(screen.getByRole('button', { name: 'Reject Chairs' })).not.toBe(reject);
    });

    it('does not show the old lowercase rejection message', async () => {
      mockFetch(base(AMIR, { 'GET /purchase-requests/to-decide': [waiting] }));
      renderAs(AMIR);

      fireEvent.click(await screen.findByRole('button', { name: 'Reject Monitors' }));
      expect(screen.queryByText('a rejection needs a comment')).toBeNull();
    });

    it('blocks a rejection without a comment, and sends one with a comment', async () => {
      const m = mockFetch(
        base(AMIR, {
          'GET /purchase-requests/to-decide': [waiting],
          [`POST /purchase-requests/${ID(5)}/decision`]: purchaseRequest({ status: 'rejected' }),
        }),
      );
      renderAs(AMIR);

      fireEvent.click(await screen.findByRole('button', { name: 'Reject Monitors' }));
      expect(screen.getByText('A rejection needs a comment.')).toBeTruthy();
      expect(m.calls.some((c) => c.method === 'POST')).toBe(false);

      fireEvent.change(screen.getByLabelText('Comment on Monitors'), {
        target: { value: 'too dear' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Reject Monitors' }));
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

      fireEvent.click(await screen.findByRole('button', { name: 'Submit Laptops' }));
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

      fireEvent.click(await screen.findByRole('button', { name: 'Submit Laptops' }));
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
