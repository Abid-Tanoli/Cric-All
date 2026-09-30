import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import Account from '../pages/Account';
import { api } from '../services/api';

function mockDelete(status, body) {
  const calls = [];
  api.defaults.adapter = async (config) => {
    calls.push({ method: config.method, url: config.url });
    if (status >= 400) {
      const error = new Error(body?.message || 'failed');
      error.response = { status, data: body };
      error.config = config;
      throw error;
    }
    return { data: body, status, statusText: 'OK', headers: {}, config };
  };
  return calls;
}

function renderAccount() {
  return render(
    <MemoryRouter initialEntries={['/account']}>
      <Routes>
        <Route path="/" element={<p>Signed out landing page</p>} />
        <Route path="/account" element={<Account />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('Account deletion', () => {
  beforeEach(() => {
    localStorage.setItem('bq_token', 'test-token');
    localStorage.setItem('bq_user', JSON.stringify({ _id: '65b1000000000000000000aa', name: 'Test' }));
  });

  it('does not call the API until the dialog is confirmed', async () => {
    const calls = mockDelete(200, { message: 'Account deleted' });
    renderAccount();

    fireEvent.click(screen.getByRole('button', { name: /delete my account/i }));
    expect(calls).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: /delete permanently/i }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ method: 'delete', url: '/auth/account' });
  });

  it('can be cancelled without deleting anything', async () => {
    const calls = mockDelete(200, { message: 'Account deleted' });
    renderAccount();

    fireEvent.click(screen.getByRole('button', { name: /delete my account/i }));
    fireEvent.click(screen.getByRole('button', { name: /keep it/i }));

    expect(screen.queryByRole('button', { name: /delete permanently/i })).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('clears the session and lands on the public page after a 200', async () => {
    mockDelete(200, { message: 'Account deleted' });
    renderAccount();

    fireEvent.click(screen.getByRole('button', { name: /delete my account/i }));
    fireEvent.click(screen.getByRole('button', { name: /delete permanently/i }));

    await waitFor(() => {
      expect(localStorage.getItem('bq_token')).toBeNull();
      expect(localStorage.getItem('bq_user')).toBeNull();
    });
    expect(await screen.findByText('Signed out landing page')).toBeTruthy();
  });

  it('surfaces the blocked-organization error and stays on the page', async () => {
    mockDelete(409, {
      message: 'Promote another member to owner of your organization before deleting the account.',
      code: 'ACCOUNT_OWNS_ORGANIZATION',
      organizations: [{ _id: '1', name: 'Sole Owner Club' }],
    });
    renderAccount();

    fireEvent.click(screen.getByRole('button', { name: /delete my account/i }));
    fireEvent.click(screen.getByRole('button', { name: /delete permanently/i }));

    const alert = await screen.findByText(/Sole Owner Club/);
    expect(alert.textContent).toMatch(/Promote another member to owner/);
    // Session must survive a refused deletion.
    expect(localStorage.getItem('bq_token')).toBe('test-token');
  });

  it('reports a generic failure without signing the person out', async () => {
    mockDelete(500, { message: 'Could not delete the account' });
    renderAccount();

    fireEvent.click(screen.getByRole('button', { name: /delete my account/i }));
    fireEvent.click(screen.getByRole('button', { name: /delete permanently/i }));

    expect(await screen.findByText(/Could not delete the account/)).toBeTruthy();
    expect(localStorage.getItem('bq_token')).toBe('test-token');
  });
});
