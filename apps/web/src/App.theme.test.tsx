import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { me, mockFetch, supplier } from './test/fixtures';
import { THEME_KEY } from './theme';
import { USERS } from './users';

const [ALICE, , BELLA] = USERS.map((u) => u.id);

const stubOs = (dark: boolean) =>
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: dark })),
  );
const html = () => document.documentElement;
const toDark = () => screen.getByRole('button', { name: 'Switch to dark theme' });
const toLight = () => screen.getByRole('button', { name: 'Switch to light theme' });

describe('theme toggle', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockFetch({
      'GET /me': (c: { headers: Record<string, string> }) => me(c.headers['X-User-Id']),
      'GET /suppliers': [supplier()],
      'GET /purchase-requests/mine': [],
    });
  });
  afterEach(() => {
    cleanup();
    localStorage.clear();
    delete html().dataset.theme;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('follows the OS when nothing is stored', () => {
    stubOs(true);
    render(<App />);
    expect(html().dataset.theme).toBe('dark');
    expect(toLight()).toBeTruthy();
    cleanup();

    stubOs(false);
    render(<App />);
    expect(html().dataset.theme).toBe('light');
    expect(toDark()).toBeTruthy();
  });

  it('lets the stored choice win over the OS, both ways', () => {
    stubOs(true);
    localStorage.setItem(THEME_KEY, 'light');
    render(<App />);
    expect(html().dataset.theme).toBe('light');
    cleanup();

    stubOs(false);
    localStorage.setItem(THEME_KEY, 'dark');
    render(<App />);
    expect(html().dataset.theme).toBe('dark');
  });

  it('flips on click and stores the choice only then', () => {
    stubOs(false);
    render(<App />);
    expect(localStorage.getItem(THEME_KEY)).toBeNull();

    fireEvent.click(toDark());
    expect(html().dataset.theme).toBe('dark');
    expect(localStorage.getItem(THEME_KEY)).toBe('dark');
    expect(toLight()).toBeTruthy();

    fireEvent.click(toLight());
    expect(html().dataset.theme).toBe('light');
    expect(localStorage.getItem(THEME_KEY)).toBe('light');
  });

  it('keeps the theme when the user is switched', async () => {
    stubOs(false);
    localStorage.setItem('levelpath.userId', ALICE);
    render(<App />);
    await screen.findByText('Alice');

    fireEvent.click(toDark());
    fireEvent.change(screen.getByLabelText('User'), { target: { value: BELLA } });
    await screen.findByText('Bella');

    expect(html().dataset.theme).toBe('dark');
    expect(localStorage.getItem(THEME_KEY)).toBe('dark');
    expect(toLight()).toBeTruthy();
  });

  it('is in the header with no user picked and with a user', async () => {
    stubOs(false);
    render(<App />);
    expect(toDark().getAttribute('type')).toBe('button');
    cleanup();

    localStorage.setItem('levelpath.userId', ALICE);
    render(<App />);
    await screen.findByText('Alice');
    expect(toDark()).toBeTruthy();
  });
});
