import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import InstallAdminButton from '../components/InstallAdminButton';
import { resetInstallPromptState } from '../pwa/installPrompt';

const INSTALL_LABEL = /install the cricall admin app/i;
const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

const originalMatchMedia = window.matchMedia;

function setUserAgent(userAgent) {
  Object.defineProperty(window.navigator, 'userAgent', { value: userAgent, configurable: true });
}

function fireBeforeInstallPrompt() {
  const event = new Event('beforeinstallprompt');
  event.prompt = vi.fn();
  event.userChoice = Promise.resolve({ outcome: 'accepted' });
  act(() => window.dispatchEvent(event));
  return event;
}

describe('Admin install button', () => {
  beforeEach(() => {
    resetInstallPromptState();
    setUserAgent(DESKTOP_UA);
    window.matchMedia = originalMatchMedia;
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it('renders nothing when no install prompt is available', () => {
    render(<InstallAdminButton />);
    expect(screen.queryByRole('button', { name: INSTALL_LABEL })).toBeNull();
    expect(screen.queryByText(/Add to Home Screen/i)).toBeNull();
  });

  it('appears on beforeinstallprompt, prompts once and hides after install', async () => {
    const event = fireBeforeInstallPrompt();
    render(<InstallAdminButton />);

    const button = await screen.findByRole('button', { name: INSTALL_LABEL });
    act(() => button.click());
    expect(event.prompt).toHaveBeenCalledTimes(1);

    act(() => window.dispatchEvent(new Event('appinstalled')));
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: INSTALL_LABEL })).toBeNull();
    });
  });

  it('stays hidden when the app is already running standalone', () => {
    window.matchMedia = (query) => ({
      matches: query.includes('standalone'),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    fireBeforeInstallPrompt();

    render(<InstallAdminButton />);
    expect(screen.queryByRole('button', { name: INSTALL_LABEL })).toBeNull();
  });

  it('shows only the Share hint on iOS Safari, which has no install prompt', () => {
    setUserAgent(IPHONE_UA);
    resetInstallPromptState();

    render(<InstallAdminButton />);
    expect(screen.getByText(/Share > Add to Home Screen/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: INSTALL_LABEL })).toBeNull();
  });
});
