import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { RequestList } from './components/RequestList';
import { ID, me, mockFetch, purchaseRequest, supplier } from './test/fixtures';
import { USERS } from './users';

const ALICE = USERS[0].id;
const KEY = 'levelpath.userId';
const NORDIC = supplier({ id: ID(901), name: 'Nordic Laptops' });
const DRAFT = purchaseRequest({
  title: 'Laptops',
  amountCents: 1250,
  category: 'hardware',
  description: 'For sales',
});

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('RequestList Edit button (criterion 9)', () => {
  it('shows Edit for a draft only, and calls onEdit with the request', () => {
    const onEdit = vi.fn();
    const others = (['submitted', 'approved', 'rejected'] as const).map((status, i) =>
      purchaseRequest({ id: ID(10 + i), title: `Other ${status}`, status }),
    );
    render(<RequestList requests={[DRAFT, ...others]} onSubmit={() => {}} onEdit={onEdit} />);

    expect(screen.getAllByRole('button', { name: /^Edit / })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Laptops' }));
    expect(onEdit).toHaveBeenCalledWith(DRAFT);
  });
});

describe('editing a draft in App (criteria 10 to 13)', () => {
  const routes = (extra: Record<string, unknown> = {}) => ({
    'GET /me': me(ALICE),
    'GET /suppliers': [supplier(), NORDIC],
    'GET /purchase-requests/mine': [DRAFT],
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
  const value = (label: string) => (screen.getByLabelText(label) as HTMLInputElement).value;
  const puts = (m: Awaited<ReturnType<typeof openEdit>>) =>
    m.calls.filter((c) => c.method === 'PUT');

  it('opens a pre-filled form with Save changes and no Create request', async () => {
    await openEdit();
    expect(value('Description')).toBe('For sales');
    expect(value('Title')).toBe('Laptops');
    expect(value('Category')).toBe('hardware');
    expect(value('Amount')).toBe('12.50');
    expect(value('Currency')).toBe('EUR');
    expect(value('Supplier')).toBe(supplier().id);
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Create request' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'New request' })).toBeNull();
  });

  it('sends the PUT with the full body, closes and shows the new title', async () => {
    let mine = [DRAFT];
    const m = await openEdit({
      'GET /purchase-requests/mine': () => mine,
      [`PUT /purchase-requests/${DRAFT.id}`]: () => {
        mine = [{ ...DRAFT, title: 'Better laptops' }];
        return mine[0];
      },
    });
    fill('Title', 'Better laptops');
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(screen.queryByRole('form')).toBeNull());
    expect(puts(m)).toHaveLength(1);
    expect(puts(m)[0].url).toBe(`/api/purchase-requests/${DRAFT.id}`);
    expect(puts(m)[0].headers['X-User-Id']).toBe(ALICE);
    expect(puts(m)[0].body).toEqual({
      title: 'Better laptops',
      amountCents: 1250,
      currency: 'EUR',
      supplierId: supplier().id,
      category: 'hardware',
      description: 'For sales',
    });
    await screen.findByText('Better laptops');
  });

  it('shows the field error and sends nothing for an invalid title', async () => {
    const m = await openEdit();
    fill('Title', '');
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(document.getElementById('title-error')).not.toBeNull();
    expect(puts(m)).toHaveLength(0);
  });

  it('closes on Cancel without a PUT and keeps the old values', async () => {
    const m = await openEdit();
    fill('Title', 'Changed');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('form')).toBeNull();
    expect(puts(m)).toHaveLength(0);
    expect(screen.getByText('Laptops')).toBeTruthy();
  });

  it('fills the fields from a suggestion', async () => {
    await openEdit({
      'POST /purchase-requests/suggestion': {
        suggestion: {
          title: 'Nordic laptops',
          category: 'hardware',
          quantity: 2,
          amountCents: 240000,
          currency: 'EUR',
          supplierId: NORDIC.id,
        },
      },
    });
    fill('Description', 'two laptops from Nordic');
    fireEvent.click(screen.getByRole('button', { name: 'Suggest fields' }));
    await screen.findByText('Suggested', { selector: '#title-suggested' });
    expect(value('Title')).toBe('Nordic laptops');
    expect(value('Amount')).toBe('2400.00');
    expect(value('Supplier')).toBe(NORDIC.id);
  });
});
