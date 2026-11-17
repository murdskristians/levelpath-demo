import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

describe('App', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('renders the page heading', () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: /levelpath demo/i })).toBeTruthy();
  });

  it('renders the purchase requests section heading', () => {
    render(<App />);

    expect(screen.getByRole('heading', { level: 2, name: 'Purchase requests' })).toBeTruthy();
    expect(screen.queryByText(/coming soon/i)).toBeNull();
  });

  it('renders the empty state', () => {
    render(<App />);

    expect(screen.getByText('No purchase requests yet.')).toBeTruthy();
    expect(screen.getByText('Requesters will create purchase requests here.')).toBeTruthy();
  });

  it('renders a disabled New request button', () => {
    render(<App />);

    const button = screen.getByRole('button', { name: 'New request' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it('renders a footer with the app name and the current year', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2031, 5, 15));
    render(<App />);

    expect(screen.getByRole('contentinfo').textContent).toBe('Levelpath Demo · 2031');
  });
});
