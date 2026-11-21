import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PwaUpdateToast from '../components/PwaUpdateToast';
import { emitPwaEvent } from '../pwa/pwaEvents';
import { applyPwaUpdate } from '../pwa/update';

vi.mock('../pwa/update', () => ({ applyPwaUpdate: vi.fn() }));

describe('Admin PWA update toast', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('is hidden until a waiting worker is reported', () => {
    render(<PwaUpdateToast />);
    expect(screen.queryByText(/New version available/i)).toBeNull();
  });

  it('shows the update action and activates the waiting worker', () => {
    render(<PwaUpdateToast />);

    act(() => emitPwaEvent('need-refresh'));

    expect(screen.getByText(/New version available/i)).toBeInTheDocument();
    act(() => screen.getByRole('button', { name: /^update$/i }).click());
    expect(applyPwaUpdate).toHaveBeenCalledTimes(1);
  });

  it('can be dismissed', () => {
    render(<PwaUpdateToast />);
    act(() => emitPwaEvent('need-refresh'));

    act(() => screen.getByRole('button', { name: /dismiss update notice/i }).click());
    expect(screen.queryByText(/New version available/i)).toBeNull();
  });
});
