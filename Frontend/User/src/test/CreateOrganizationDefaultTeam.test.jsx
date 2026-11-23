import React from 'react';
import { beforeEach, describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import CreateOrganization from '../pages/organization/CreateOrganization';
import { api } from '../services/api';

const ORG_ID = '65b100000000000000000001';
const calls = [];

function mockApi({ team = null, failure = '' } = {}) {
  calls.length = 0;
  api.defaults.adapter = async (config) => {
    const url = String(config.url || '');
    const method = String(config.method || 'get').toLowerCase();
    let data;
    if (url.includes('/team-categories')) data = [];
    else if (url.includes('/organizations/my')) data = [];
    else if (url.includes('/teams') && method === 'post') {
      data = { team: { _id: '65b100000000000000000002', name: 'Riverside Cricket Club', teamRole: '1st XI' } };
    } else if (url.endsWith('/organizations') && method === 'post') {
      data = {
        organization: { _id: ORG_ID, name: 'Riverside Cricket Club' },
        defaultTeam: team,
        defaultTeamError: failure,
      };
    } else data = { organization: {} };
    calls.push({ url, method, data: config.data ? JSON.parse(config.data) : undefined });
    return { data, status: 200, statusText: 'OK', headers: {}, config };
  };
}

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/organization/new?orgType=registered_club']}>
      <CreateOrganization />
    </MemoryRouter>
  );

describe('automatic first team on organization creation', () => {
  beforeEach(() => {
    localStorage.setItem('bq_user', JSON.stringify({ _id: '65b1000000000000000000aa', emailVerified: true }));
    localStorage.setItem('bq_token', 'test-token');
  });

  it('shows the notice and name preview, and sends the opt-out flag', async () => {
    mockApi();
    renderPage();

    expect(screen.getByText('A first team will be created automatically')).toBeTruthy();
    expect(screen.getByText(/“Your organization” · 1st XI/)).toBeTruthy();
    const optOut = screen.getByLabelText('Create the first team automatically (recommended)');
    expect(optOut).toBeChecked();

    fireEvent.change(screen.getByLabelText('Name *'), { target: { value: 'Riverside Cricket Club' } });
    expect(screen.getByText(/“Riverside Cricket Club” · 1st XI/)).toBeTruthy();
    fireEvent.click(optOut);
    fireEvent.click(screen.getByRole('button', { name: 'Create organization' }));

    await waitFor(() => {
      const create = calls.find((call) => call.method === 'post' && call.url === '/organizations');
      expect(create?.data.createDefaultTeam).toBe(false);
    });
  });

  it('shows org + team success with the next actions', async () => {
    mockApi({ team: { _id: '65b100000000000000000002', name: 'Riverside Cricket Club', teamRole: '1st XI' } });
    renderPage();

    fireEvent.change(screen.getByLabelText('Name *'), { target: { value: 'Riverside Cricket Club' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create organization' }));

    expect(await screen.findByText(/First team “Riverside Cricket Club” \(1st XI\) is ready/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add players' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add another team' })).toBeTruthy();
  });

  it('explains a default-team failure and offers one-click retry', async () => {
    mockApi({ failure: 'Default team was not created' });
    renderPage();

    fireEvent.change(screen.getByLabelText('Name *'), { target: { value: 'Riverside Cricket Club' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create organization' }));

    expect(await screen.findByText('Default team was not created')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Create team now' }));
    await waitFor(() => {
      expect(calls.some((call) => call.url.includes('/teams') && call.method === 'post')).toBe(true);
    });
    expect(await screen.findByText(/First team “Riverside Cricket Club” \(1st XI\) is ready/)).toBeTruthy();
  });
});
