import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { fail, ID, me, mockFetch, purchaseRequest, supplier } from './test/fixtures';
import { USERS } from './users';

const ALICE = USERS[0].id;
const KEY = 'levelpath.userId';
const NORDIC = supplier({ id: ID(901), name: 'Nordic Laptops' });
const PUT = `PUT /purchase-requests/${ID(1)}`;

const draft = (over = {}) =>
  purchaseRequest({
    category: 'hardware',
    description: 'For the new hires',
    supplier: NORDIC,
    ...over,
  });

const routes = (extra: Record<string, unknown> = {}) => ({
  'GET /me': me(ALICE),
  'GET /suppliers': [supplier(), NORDIC],
  'GET /purchase-requests/mine': [draft()],
  ...extra,
});

async function openEdit(extra: Record<string, unknown> = {}) {
  const m = mockFetch(routes(extra));
  localStorage.setItem(KEY, ALICE);
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Edit Laptops' }));
  await screen.findByRole('form', { name: 'Edit request' });
  return m;
}
const fill = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const puts = (m: Awaited<ReturnType<typeof openEdit>>) => m.calls.filter((c) => c.method === 'PUT');

describe('edit a draft', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('shows Edit next to Submit on a draft, and neither on a submitted request', async () => {
    mockFetch(
      routes({
        'GET /purchase-requests/mine': [
          draft(),
          purchaseRequest({ id: ID(2), title: 'Chairs', status: 'submitted' }),
        ],
      }),
    );
    localStorage.setItem(KEY, ALICE);
    render(<App />);
    expect(await screen.findByRole('button', { name: 'Edit Laptops' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Submit Laptops' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Edit Chairs' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Submit Chairs' })).toBeNull();
  });

  it('opens the form pre-filled, without the New request button', async () => {
    await openEdit();
    const value = (label: string) => (screen.getByLabelText(label) as HTMLInputElement).value;
    expect(value('Title')).toBe('Laptops');
    expect(value('Category')).toBe('hardware');
    expect(value('Amount')).toBe('1250.00');
    expect(value('Currency')).toBe('EUR');
    expect(value('Supplier')).toBe(NORDIC.id);
    expect(value('Description')).toBe('For the new hires');
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'New request' })).toBeNull();
  });

  it('saves with one PUT, closes the form, re-fetches and shows the new title as Draft', async () => {
    let title = 'Laptops';
    const m = await openEdit({
      'GET /purchase-requests/mine': () => [draft({ title })],
      [PUT]: () => {
        title = 'Better laptops';
        return draft({ title });
      },
    });
    fill('Title', 'Better laptops');
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await screen.findByText('Better laptops');
    expect(screen.queryByRole('form')).toBeNull();
    expect(puts(m)).toHaveLength(1);
    expect(m.calls.filter((c) => c.method === 'POST')).toHaveLength(0);
    expect(puts(m)[0].url).toBe(`/api/purchase-requests/${ID(1)}`);
    expect(puts(m)[0].headers['X-User-Id']).toBe(ALICE);
    expect(puts(m)[0].body).toEqual({
      title: 'Better laptops',
      amountCents: 125000,
      currency: 'EUR',
      supplierId: NORDIC.id,
      category: 'hardware',
      description: 'For the new hires',
    });
    expect(m.count('GET', '/purchase-requests/mine')).toBe(2);
    expect(screen.getByText('Draft')).toBeTruthy();
  });

  it('shows the title error and sends nothing when the title is empty', async () => {
    const m = await openEdit({ [PUT]: draft() });
    fill('Title', '');
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(screen.getByLabelText('Title').getAttribute('aria-invalid')).toBe('true');
    expect(puts(m)).toHaveLength(0);
  });

  it('sends nothing on Cancel and keeps the old values', async () => {
    const m = await openEdit();
    fill('Title', 'Changed');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('form')).toBeNull();
    expect(screen.getByText('Laptops')).toBeTruthy();
    expect(m.calls.filter((c) => c.method !== 'GET')).toHaveLength(0);
  });

  it('runs Suggest fields in the edit form', async () => {
    const m = await openEdit({
      'POST /purchase-requests/suggestion': {
        suggestion: {
          title: 'Suggested title',
          category: 'software',
          quantity: null,
          amountCents: null,
          currency: null,
          supplierId: null,
        },
      },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Suggest fields' }));
    await waitFor(() => expect(m.count('POST', '/purchase-requests/suggestion')).toBe(1));
    await waitFor(() =>
      expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Suggested title'),
    );
    expect((screen.getByLabelText('Category') as HTMLSelectElement).value).toBe('software');
    expect(document.querySelectorAll('.suggested-tag')).toHaveLength(2);
  });

  it('shows the error alert on a 409 and keeps the form open', async () => {
    await openEdit({
      [PUT]: fail(409, { statusCode: 409, message: 'only a draft can be edited' }),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByRole('alert');
    expect(screen.getByRole('form', { name: 'Edit request' })).toBeTruthy();
  });
});
